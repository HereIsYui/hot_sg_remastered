/**
 * Typed fetch client for the `api/gm` surface. Every request carries the shared token from
 * `VITE_GM_TOKEN` as the `x-gm-token` header; the Vite dev server proxies `/api` to the game
 * server (`HOT_SERVER_URL`, default http://localhost:3000).
 */

export type Row = Record<string, unknown>;

export const tokenConfigured = (import.meta.env.VITE_GM_TOKEN ?? '') !== '';
const GM_TOKEN = import.meta.env.VITE_GM_TOKEN ?? '';
/** The client dev server hosts the extracted assets (pnpm legacy:assets). */
export const ASSET_BASE = import.meta.env.VITE_ASSET_URL ?? 'http://localhost:5173/assets/';

export class GmApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/gm${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-gm-token': GM_TOKEN,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GmApiError('无法连接服务端（pnpm dev:server）', 0);
  }
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
    if (typeof data?.message === 'string') message = data.message;
    else if (Array.isArray(data?.message)) message = (data.message as unknown[]).join('; ');
    throw new GmApiError(message, res.status);
  }
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);

// ---------------------------------------------------------------- players

export interface PlayerRow extends Row {
  uid: number;
  name: string;
  passport: string;
  money: number;
  gift: number;
  prestige: number;
  nobility: number;
  officepos: number;
  state: number;
  union_name: string | null;
  officepos_name: string | null;
  nobility_name: string | null;
}

export const searchPlayers = (by: 'name' | 'passport', name: string) =>
  get<PlayerRow[]>(`/player/search?by=${by}&name=${encodeURIComponent(name)}`);

export const updatePlayer = (body: {
  uid: number;
  money?: number;
  gift?: number;
  prestige?: number;
  nobility?: number;
  officepos?: number;
}) => post<PlayerRow>('/player/property', body);

export const forbidList = () => get<PlayerRow[]>('/player/forbidden');

export const forbidUser = (uid: number, delemail: boolean) =>
  post<PlayerRow>('/player/forbid', { uid, delemail });

export const unforbidUser = (uid: number) => post<PlayerRow>('/player/unforbid', { uid });

// ---------------------------------------------------------------- cities

export interface CityRow extends Row {
  cid: number;
  x: number;
  y: number;
  name: string;
  type: number;
  state: number;
  uid: number;
  username: string | null;
}

export const searchCities = (query: { name?: string; x?: number; y?: number }) => {
  const params = new URLSearchParams();
  if (query.name !== undefined) params.set('name', query.name);
  if (query.x !== undefined) params.set('x', String(query.x));
  if (query.y !== undefined) params.set('y', String(query.y));
  return get<CityRow[]>(`/city/search?${params}`);
};

export const cityMaxLevel = (cid: number) =>
  post<{ buildings: number; technics: number }>('/city/max-level', { cid });

export const cleanupUser = (uid: number) =>
  post<{ ok: true }>('/city/clean', { uid, confirm: true });

// ---------------------------------------------------------------- heroes

export interface HeroRow extends Row {
  hid: number;
  uid: number;
  cid: number;
  name: string;
  level: number;
  exp: number;
  herotype: number;
  npcid: number;
  state: number;
  username: string | null;
}

export const searchHeroes = (name: string) =>
  get<{ heroes: HeroRow[]; npcHeroes: Row[] }>(`/hero/search?name=${encodeURIComponent(name)}`);

export const updateHero = (body: {
  hid: number;
  level?: number;
  exp?: number;
  command?: number;
  affairs?: number;
  bravery?: number;
  wisdom?: number;
}) => post<Row>('/hero/property', body);

export const placeHero = (hid: number, cid: number) => post<Row>('/hero/place', { hid, cid });

// ---------------------------------------------------------------- goods

export interface GoodsRow extends Row {
  gid?: number;
  id?: number;
  name: string;
  level: number | null;
  inuse: number;
  description: string;
  imageName: string;
}

export const searchGoods = (kind: 'goods' | 'armor', name: string) =>
  get<GoodsRow[]>(`/goods/search?kind=${kind}&name=${encodeURIComponent(name)}`);

export const grantGoods = (uid: number, gid: number, count: number) =>
  post<{ ok: true }>('/goods/grant', { uid, gid, count });

export const removeGoods = (uid: number, gid: number, count?: number) =>
  post<{ ok: true }>('/goods/remove', { uid, gid, count });

// ---------------------------------------------------------------- announce

export const sendInform = (body: { msg: string; color?: number; seconds?: number }) =>
  post<{ ok: true }>('/announce/inform', body);

export const speak = (msg: string, from?: string) => post<number>('/announce/speak', { msg, from });

// ---------------------------------------------------------------- world

export interface WorldStatus {
  online: number;
  onlineUids: number[];
  tables: Row[];
}

export const refreshWilds = () => post<{ touched: number }>('/world/refresh');

export const worldStatus = () => get<WorldStatus>('/world/status');
