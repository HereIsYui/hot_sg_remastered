import { i18n } from '../i18n';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** MyGoodsDialog: items per page, laid out 7 to a row. */
export const PAGE_ITEM_COUNT = 21;
const ROW_ITEMS = 7;
/** Tabs of the dialog: cfg_goods.group 0-4 and 6, and 5 for things (任务类). */
export const GOODS_TAB_COUNT = 7;
export const THINGS_TAB = 5;
/** cfg_goods.group of 名将卡. */
const CARD_GROUP = 6;
/** Items listed with the goods but shown on no tab. */
const HIDDEN_GROUP = 127;

/** A goods or things row of loadUserGoods, with what the dialog adds to it. */
export interface GoodsItem {
  gid: number;
  name: string;
  count: number;
  group: number;
  description: string;
  useguide: string;
  autouse: number;
  /** Gold a unit sells for (cfg_goods.value * 500). */
  sellvalue: number;
  imageName: string;
  isThing: boolean;
  row: Row;
}

/** An entry of a useGoods item list (TreasureGetDialog): goods, gear (1) or things (2). */
export interface TreasureItem {
  name: string;
  count: string;
  description: string;
  gtype: number;
  imageName: string;
}

/** `MyGoodsDialog.makeItemImageName` */
export function goodsImage(row: Row): string {
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

/** `MyGoodsDialog.makeThingImageName`: images 8001-14999 are hero portraits. */
export function thingImage(row: Row): string {
  const image = int(row.image);
  if (image <= 0) return `images/thing_${str(row.tid)}.png`;
  if (image > 8000 && image < 15000) {
    return image >= 10000
      ? `images/hero/hero_boy_${image - 10000}.jpg`
      : `images/hero/hero_girl_${image - 8000}.jpg`;
  }
  return `images/thing_${image}.png`;
}

/** `ArmorDialog.makeArmorImageName` */
export function armorImage(row: Row): string {
  return int(row.image) > 0
    ? `images/armor/${str(row.image)}.png`
    : `images/armor/${str(row.id)}.png`;
}

function goodsItem(row: Row, isThing: boolean): GoodsItem {
  return {
    gid: int(isThing ? row.tid : row.gid),
    name: str(row.name),
    count: int(row.count),
    group: int(row.group),
    description: str(row.description),
    useguide: str(row.useguide),
    autouse: int(row.autouse),
    sellvalue: int(row.value) * 500,
    imageName: isThing ? thingImage(row) : goodsImage(row),
    isThing,
    row,
  };
}

/** `onLoadUserGoods`: `[goods, things]` sorted onto the tabs; `firstGroup` is the lowest group owned. */
export function parseUserGoods(data: unknown): {
  goods: GoodsItem[];
  tabs: GoodsItem[][];
  firstGroup: number;
} {
  const tabs: GoodsItem[][] = Array.from({ length: GOODS_TAB_COUNT }, () => []);
  const goods: GoodsItem[] = [];
  let firstGroup = 100;
  const d = Array.isArray(data) ? data : [];
  for (const row of Array.isArray(d[0]) ? (d[0] as Row[]) : []) {
    const item = goodsItem(row, false);
    goods.push(item);
    if (item.group !== HIDDEN_GROUP) tabs[item.group]?.push(item);
    firstGroup = Math.min(firstGroup, item.group);
  }
  for (const row of Array.isArray(d[1]) ? (d[1] as Row[]) : []) {
    tabs[THINGS_TAB]!.push(goodsItem(row, true));
  }
  return { goods, tabs, firstGroup };
}

/** `mPageCount = (length - 1) / PAGE_ITEM_COUNT + 1` stored in an int: 0 for an empty tab. */
export function pageCount(length: number): number {
  return Math.trunc((length - 1) / PAGE_ITEM_COUNT + 1);
}

/** Position of the i-th item of a page inside the item container. */
export function itemPosition(i: number): { x: number; y: number } {
  return { x: (i % ROW_ITEMS) * 88, y: 5 + Math.floor(i / ROW_ITEMS) * 93 };
}

/** `ArmorTooltip.generateAttrTip`: the `attr` bonuses (`type,value,...`) and a mount's speed. */
export function attrTip(row: Row): string {
  const attr = str(row.attr);
  if (attr === '') return '';
  const parts = attr.split(',');
  let tip = '';
  for (let i = 0; i < parts.length; i += 2) {
    tip += `+${parts[i + 1]} ${i18n(`Tooltip_ArmorTooltip_${int(parts[i]) + 12}_1`)} `;
  }
  tip += '\n';
  if (int(row.zuoji_type) !== 0) {
    const gid = int(row.gid);
    const speed = gid >= 12178 && gid <= 12182 ? 100 : (((gid - 400) % 20) + 1) * 10;
    tip += `${i18n('Tooltip_ArmorTooltip_31_1')} ${speed}`;
  }
  return `${tip}\n`;
}

/** UseGoodsDialog types: 0 speeds the current building up, 1 the 书院's research. */
export const UseGoodsType = { Building: 0, Technic: 1 } as const;

/** An item of the UseGoodsDialog picker; a 鲁班传人 / 墨家弟子 not owned counts 立即完成. */
export interface TypeGoodsItem {
  gid: number;
  name: string;
  count: string;
  description: string;
  imageName: string;
}

/** `UseGoodsDialog.onGetGoods`: the getUserTypeGoods list, missing counts as 0. */
export function parseTypeGoods(list: unknown): TypeGoodsItem[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[])
    .filter((r): r is Row => !!r && typeof r === 'object')
    .map((row) => ({
      gid: int(row.gid),
      name: str(row.name),
      count: row.count ? str(row.count) : '0',
      description: str(row.description),
      imageName:
        int(row.imagetype) === 0
          ? `images/item_${str(row.gid)}.png`
          : `images/hero/hero_boy_${str(row.image)}.jpg`,
    }));
}

/** UseGoodsDialog: 80 wide items 13 apart, the dialog as wide as the stage from 7 on. */
export function typeGoodsDialogWidth(count: number): number {
  if (count <= 1) return 160;
  if (count < 7) return count * 80 + (count - 1) * 13 + 40;
  return 682;
}

/** `TreasureGetDialog.loadGoods`: the items of a useGoods reply. */
export function treasureItems(list: unknown): TreasureItem[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[])
    .filter((r): r is Row => !!r && typeof r === 'object')
    .map((row) => {
      const gtype = int(row.gtype);
      return {
        name: str(row.name),
        count: str(row.count),
        description: str(row.description),
        gtype,
        imageName: gtype === 1 ? armorImage(row) : gtype === 2 ? thingImage(row) : goodsImage(row),
      };
    });
}
