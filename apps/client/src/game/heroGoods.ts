import type { CommandArg } from '@hot/shared';

/** UseGoodsDialog.onUseGoods routes by gid, not by the picker type. */
export function isHeroLargessGoods(gid: number): boolean {
  return (
    (gid >= 26 && gid <= 29) ||
    gid === 116 ||
    (gid >= 10150 && gid <= 10155) ||
    (gid >= 160040 && gid <= 160051) ||
    (gid >= 160023 && gid <= 160031) ||
    (gid >= 19201 && gid <= 19205)
  );
}

/** PHP discards the function-name prefix, then reads cid/hid/gid; exactly one copy is used. */
export function heroLargessArgs(
  cid: number,
  hid: number,
  gid: number,
  param: CommandArg[],
): CommandArg[] {
  return ['largessHeroWithGid', cid, hid, gid, ...param];
}

/** The original warnings explain replacement/conflict rules before spending a buff. */
export function heroGoodsPromptKey(gid: number): string | null {
  const suffixes: Record<number, string> = {
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
    26: 'Hufu',
    27: 'WenQuXin',
    28: 'WuQuXin',
    29: 'ZhiDuoXin',
  };
  const suffix = suffixes[gid];
  return suffix ? `Goods_UseGoodsDialogSrc_${suffix}` : null;
}

export function heroLargessReply(data: unknown): {
  heroes: Record<string, unknown>[];
  tip: string;
} {
  const rows = Array.isArray(data) ? [...data] : [];
  const tip = typeof rows.at(-1) === 'string' ? String(rows.pop()) : '';
  return {
    heroes: rows.filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && !Array.isArray(row),
    ),
    tip,
  };
}
