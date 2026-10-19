import { defineStore } from 'pinia';

/** One entry of `User.cities` (sys_city row as sent by loadUserInfo / getUserCities). */
export interface UserCity {
  cid: number;
  name: string;
  type: number;
  /** `(x,y)` derived from cid, as in `BloodWar.parseCities`. */
  position: string;
  [key: string]: unknown;
}

export const SEX_NAME = ['female', 'male'] as const;

export function playerFace(sex: number, face: number): string {
  return `images/player/player_${SEX_NAME[sex] ?? SEX_NAME[0]}_${face + 1}.jpg`;
}

export function cityPosition(cid: number): string {
  return `(${cid % 1000},${Math.floor(cid / 1000)})`;
}

/** `BloodWar.parseCities`: sorted by type descending, position added. */
export function parseCities(rows: unknown): UserCity[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[])
    .map((r) => ({
      ...r,
      cid: Number(r.cid),
      name: String(r.name ?? ''),
      type: Number(r.type ?? 0),
    }))
    .sort((a, b) => b.type - a.type)
    .map((c) => ({ ...c, position: cityPosition(c.cid) }));
}

/** Port of the static `User` model. */
export const useUserStore = defineStore('user', {
  state: () => ({
    uid: 0,
    sid: 0,
    cid: 0,
    passport: '',
    username: '',
    honour: 0,
    prestige: 0,
    rank: 0,
    lastcid: 0,
    unionid: 0,
    unionname: '',
    unionpos: 0,
    /** Display name of the union position (`Utils.getUnionPos`). */
    unionPosName: '',
    userface: 0,
    usersex: 0,
    group: 0,
    /** 3 new account, 4 lost all cities, 5 back to login, 6 vacation, else playing. */
    ustate: 0,
    flagchar: '',
    officepos: '',
    nobility: '',
    nobilityPos: 0,
    curDesigName: '',
    curDesigId: 0,
    locked: false,
    isAdult: 0,
    userCardId: '',
    lastUpdateServerId: 0,
    cities: [] as UserCity[],
    kingLevel: 0,
    kingHeroLevel: 0,
    /** Luoyang campaign year shown in the top bar (`mCurYearStr`). */
    yearText: '',
  }),
  getters: {
    faceImage: (s) => playerFace(s.usersex, s.userface),
    cityIndex: (s) => s.cities.findIndex((c) => c.cid === s.cid),
  },
});
