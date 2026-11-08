import type { GoodsItem } from './goods';

export type GoodsRow = Record<string, unknown>;
export const isFragment = (gid: number) => gid > 100000 && gid < 110000;
export const isWuhun = (gid: number) => gid > 110000 && gid < 160000;
export const isPortrait = (tid: number) => tid >= 20001 && tid < 21027;
export const cardQuality = (gid: number) => Math.trunc((gid - 200000) / 10000);

/** Reserve one copy per filled slot, including the original card. */
export function availableCards(
  cards: GoodsItem[],
  slots: (GoodsItem | null)[],
  target: number,
): GoodsItem[] {
  const original = slots[0];
  return cards.filter((card) => {
    if (card.gid < 220000 || card.count <= 0) return false;
    if (target !== 0 && (!original || cardQuality(card.gid) !== cardQuality(original.gid)))
      return false;
    const reserved =
      target === 0
        ? 0
        : slots.filter((slot, index) => index !== target && slot?.gid === card.gid).length;
    return card.count > reserved;
  });
}

export function wuhunHeroes(heroes: GoodsRow[]): GoodsRow[] {
  return heroes.filter((hero) => Number(hero.state) === 0 && Number(hero.hero_health) === 0);
}

export interface Question {
  question: string;
  options: string[];
  answer: number;
  info: string;
}
export function parseQuestion(value: unknown): Question | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as GoodsRow;
  return {
    question: String(row.question ?? ''),
    options: [1, 2, 3, 4].map((i) => String(row[`option${i}`] ?? '')),
    answer: Number(row.answer),
    info: String(row.info ?? ''),
  };
}
export function correctAnswer(question: Question, selected: number): boolean {
  return selected >= 1 && selected <= 4 && selected === question.answer;
}

/** GoodsFunc.useGoods shifts gid and useCount before reading the soul's target hid. */
export function wuhunUseArgs(gid: number, hid: number): [number, 1, number] {
  return [gid, 1, hid];
}

/** multiUseCard derives min(100, owned gid-250 count) on the server; no count argument. */
export function multiUseCardArgs(): [] {
  return [];
}

/** mixCard consumes a flat list: original first, then one gid per occupied material slot. */
export function mixCardArgs(slots: (GoodsItem | null)[]): number[] | null {
  if (!slots[0] || slots.length > 7) return null;
  const cards = slots.filter((item): item is GoodsItem => item !== null);
  if (cards.length < 2) return null;
  return cards.map((item) => item.gid);
}
