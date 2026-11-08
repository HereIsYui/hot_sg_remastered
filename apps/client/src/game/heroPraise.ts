/** Hero.PraiseDialog preserves the original function-name prefix. */
export function praiseHeroArgs(
  cid: number,
  hid: number,
  gid: number,
): [string, number, number, number] {
  return ['praiseHero', cid, hid, gid];
}

const CONFIRMATIONS: Record<number, string> = {
  26: 'Hufu',
  27: 'WenQuXin',
  28: 'WuQuXin',
  29: 'ZhiDuoXin',
  19082: 'MaBian',
  19083: 'HanXueMaBIan',
  160026: 'bazhentu1',
  160027: 'bazhentu2',
  160029: 'xianzhenzhangu1',
  160030: 'xianzhenzhangu2',
  160041: 'hufu2',
  160042: 'hufu1',
  160043: 'tihutang1',
  160044: 'tihutang2',
  160046: 'xinshentang1',
  160047: 'xinshentang2',
  160049: 'hugutang1',
  160050: 'hugutang2',
};
export function praiseConfirmationKey(gid: number): string | null {
  const suffix = CONFIRMATIONS[gid];
  return suffix ? `Hero_PraiseDialog_Praise_${suffix}` : null;
}
export interface HeroPraiseGoods {
  gid: number;
  name: string;
  description: string;
}
export function parseHeroPraiseGoods(data: unknown): HeroPraiseGoods[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const gid = Number(row.gid);
    return Number.isSafeInteger(gid) && gid > 0
      ? [{ gid, name: String(row.name ?? ''), description: String(row.description ?? '') }]
      : [];
  });
}
export function parseKingTactic(data: unknown) {
  const d = Array.isArray(data) ? data : [];
  const book = parseHeroPraiseGoods([d[0]])[0];
  const raw = d[0] as Record<string, unknown> | undefined;
  return {
    book: book ?? { gid: 10961, name: '', description: '' },
    count: Math.max(0, Number(raw?.count) || 0),
    level: Math.max(0, Math.min(10, parseInt(String(d[1]), 10) || 0)),
    message: String(d[2] ?? ''),
  };
}
/** Public experience links contain exactly one positive reward id. */
export function commonExprRewardId(link: string): number | null {
  if (!/^\d+$/.test(link)) return null;
  const id = Number(link);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
