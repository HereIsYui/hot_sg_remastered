/**
 * Image file names for the GM 宝物 search, mirroring the client's
 * `apps/client/src/game/goods.ts` (goodsImage / armorImage) so the GM UI can preview
 * items from the client asset directory without shipping its own mapping.
 */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const str = (v: unknown) => String(v ?? '');

/** cfg_goods.group of 名将卡. */
const CARD_GROUP = 6;

/** `MyGoodsDialog.makeItemImageName` */
export function goodsImageName(row: Row): string {
  if (int(row.group) === CARD_GROUP) {
    const sex = int(row.gid) % 10000 >= 1000 ? 'girl' : 'boy';
    return `images/hero/hero_${sex}_${str(row.image)}.jpg`;
  }
  const imagetype = int(row.imagetype);
  if (imagetype === 0) {
    return int(row.image) > 0
      ? `images/pack_${str(row.image)}.png`
      : `images/item_${str(row.gid)}.png`;
  }
  if (imagetype === 2) return `images/hero/hero_boy_${str(row.image)}.jpg`;
  if (imagetype === 1) return `images/hero/hero_girl_${str(row.image)}.jpg`;
  return '';
}

/** `ArmorDialog.makeArmorImageName` */
export function armorImageName(row: Row): string {
  return int(row.image) > 0
    ? `images/armor/${str(row.image)}.png`
    : `images/armor/${str(row.id)}.png`;
}
