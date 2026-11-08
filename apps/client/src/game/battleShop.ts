import { i18n } from '../i18n';

export type Row = Record<string, unknown>;

/**
 * `Battle.BattleChoiceDialog` 战场商城 + `Shop.BattleMedalChangeDialog` / `BattleMetalRecord`:
 * the reply shapes of `getUserBattleShopInfo`, `getMedalExchangeInfo`, `getMedalRecord`, the
 * goods naming / description decoration `initBattleShop` applied, the `initBattleGroups` shop
 * list and the `createGoodsTip` tooltip of `Tooltip.BattleShopGoodsTip`.
 */

const int = (v: unknown) => parseInt(String(v), 10) || 0;

/** One 战场商城 row (a `cfg_shop` line joined with its medal currency). */
export interface BattleShopGood {
  id: number;
  gid: number;
  name: string;
  description: string;
  /** `item_<gid>` / `pack_<image>`; armors and heroes use their own prefixes. */
  imageName: string;
  /** 0 宝物 / 1 战场装备 / 2 战场将领. */
  battleGoodsType: number;
  battleBelong: string;
  medalName: string;
  creditPrice: number;
  medalPrice: number;
  /** `cfg_shop.medalTypeId` — the `medal_<id>_goods.png` icon beside the medal price. */
  medalTypeId: number;
  /** `cfg_shop.pack` — how many items one purchase contains. */
  pack: number;
  /** `cfg_shop.group` — 7 rows price in 功勋 / 勋绩 instead of 荣誉. */
  group: number;
  /** `totalCount < 2000000000` — the cell shows the `mall_special` corner mark. */
  hasLeftImage: boolean;
  /** The description decorations `initBattleShop` appended (limits / time left). */
  limit: string;
}

/** `getUserBattleShopInfo` → the parts the local shop tab shows. */
export interface BattleShopState {
  /** The nobility gate: 1 blocks the 剧情战场 / 据点战场 tabs. */
  flag: number;
  battles: Row[];
  gongxun: number;
  /** `mUserBattleArea` — the net-battle level the group-7 armor tooltip compares against. */
  battleArea: number;
  todayWarCount: number;
  maxDayCount: number;
  goods: BattleShopGood[];
  /** The raw `cfg_armor` rows of the reply — `initArmorAndHeroGoods`'s mArmorMap source. */
  armorAry: Row[];
  /** The raw `cfg_hero` rows — `mHeroMap`'s source. */
  heroAry: Row[];
  honour: number;
  /** `mMenghuoAchievementLevel` (getUserPVENetLevel) — the 孟获 achievement gate. */
  pveLevel: number;
  /** `shachangescore`. */
  shachangScore: number;
}

/** `initBattleShop`'s per-good naming and description limits. */
export function parseBattleShopGood(item: Row): BattleShopGood {
  const image = String(item.image ?? '');
  const group = int(item.group);
  const type = int(item.battlegoodstype ?? item.battleGoodsType);
  let imageName: string;
  if (group === 6 || group === 7) {
    if (type === 1) {
      imageName = `armor/${image !== '0' && image !== '' ? image : item.gid}`;
    } else if (type === 2) {
      imageName = `battle_item_${item.gid}`;
    } else {
      imageName = image === '0' || image === '' ? `item_${item.gid}` : `pack_${image}`;
    }
  } else {
    imageName = image === '0' || image === '' ? `item_${item.gid}` : `pack_${image}`;
  }
  let limit = '';
  const total = int(item.totalCount);
  if (total < 2000000000) {
    limit += `限量销售，剩余${total}待售。`;
  } else if (int(item.userbuycnt) > 0) {
    limit += `限量销售，每人限购${int(item.userbuycnt)}件。`;
  } else if (int(item.daybuycnt) > 0) {
    limit += `限量销售，每天限购${int(item.daybuycnt)}件。`;
  }
  return {
    id: int(item.id),
    gid: int(item.gid),
    name: String(item.name ?? ''),
    description: `${item.description ?? ''}${limit}`,
    imageName,
    battleGoodsType: type,
    battleBelong: String(item.battleBelong ?? ''),
    medalName: String(item.medalName ?? ''),
    creditPrice: int(item.creditPrice),
    medalPrice: int(item.medalPrice),
    medalTypeId: int(item.medalTypeId),
    pack: int(item.pack),
    group,
    hasLeftImage: total < 2000000000,
    limit,
  };
}

/** The `[flag, battles, gongxun, area, todayWarCount, maxDayCount, goods, armor, hero, honour…]`. */
export function parseBattleShopInfo(d: unknown[], withShop: boolean): BattleShopState {
  let flag = 0;
  if (withShop) flag = int(d.shift());
  const battles = (Array.isArray(d[0]) ? d.shift() : []) as Row[];
  const gongxun = int(d.shift());
  const battleArea = int(d.shift()); // mUserBattleArea — the group-7 armor level gate
  const todayWarCount = int(d.shift());
  const maxDayCount = int(d.shift());
  let goods: Row[] = [];
  let armorAry: Row[] = [];
  let heroAry: Row[] = [];
  let honour = 0;
  if (withShop) {
    goods = (Array.isArray(d[0]) ? d.shift() : []) as Row[];
    armorAry = (Array.isArray(d[0]) ? d.shift() : []) as Row[];
    heroAry = (Array.isArray(d[0]) ? d.shift() : []) as Row[];
    honour = int(d.shift());
  }
  const pveLevel = int(d.shift()); // mMenghuoAchievementLevel (getUserPVENetLevel)
  const shachangScore = int(d.shift()); // shachangescore
  return {
    flag,
    battles,
    gongxun,
    battleArea,
    todayWarCount,
    maxDayCount,
    goods: goods.map(parseBattleShopGood),
    armorAry,
    heroAry,
    honour,
    pveLevel,
    shachangScore,
  };
}

// ──────────────────── the shop list + goods grouping (initBattleGroups) ────────────────────

/** One shop-tab list row (`initBattleGroups`'s mBattleShops entries). */
export interface BattleShopGroup {
  name: string;
  /** The `mBattleGoodsDict` key: the `battleBelong` of the goods this tab shows. */
  battleId: number;
  /** The battle's type; the 赤壁 / 孟获商城 entries use 1. */
  type: number;
}

/**
 * `initBattleGroups`'s shop list: 战场道具 first (battleId 1), then one entry per battle (a
 * 赤壁之战 row shows the 跨服 name), then 赤壁商城 (battleId 2) when battle 11000 is open
 * (`hasChibiBattle`) and 孟获商城 (battleId 3) when 9001 is (`hasMenhuoBattle`).
 */
export function parseBattleShopGroups(battles: Row[]): BattleShopGroup[] {
  const groups: BattleShopGroup[] = [
    { name: i18n('Battle_BattleChoiceDialog_4_2'), battleId: 1, type: 0 },
  ];
  let chibi = false;
  let menhuo = false;
  for (const battle of Array.isArray(battles) ? battles : []) {
    const name = String(battle.name ?? '');
    groups.push({
      name:
        name === i18n('Battle_BattleChoiceDialog_ChibiBattle')
          ? i18n('Battle_BattleChoiceDialog_ChibiBattleCross')
          : name,
      battleId: int(battle.id),
      type: int(battle.type),
    });
    if (int(battle.id) === 11000) chibi = true;
    if (int(battle.id) === 9001) menhuo = true;
  }
  if (chibi)
    groups.push({ name: i18n('Battle_BattleChoiceDialog_ChibiShop'), battleId: 2, type: 1 });
  if (menhuo)
    groups.push({ name: i18n('Battle_BattleChoiceDialog_MenhuoShop'), battleId: 3, type: 1 });
  return groups;
}

/**
 * `initBattleShop`'s `mBattleGoodsDict[item.battleBelong].push(item)`: the goods of each shop
 * tab, in the tab order of `parseBattleShopGroups`; goods of an unknown belong are dropped.
 */
export function groupBattleShopGoods(
  goods: BattleShopGood[],
  groups: BattleShopGroup[],
): BattleShopGood[][] {
  const buckets = groups.map(() => [] as BattleShopGood[]);
  const index = new Map(groups.map((g, i) => [g.battleId, i]));
  for (const good of goods) {
    const i = index.get(int(good.battleBelong));
    if (i !== undefined) buckets[i]!.push(good);
  }
  return buckets;
}

// ──────────────────── the goods tooltip (createGoodsTip → BattleShopGoodsTip) ────────────────────

/** `BattleShopGoodsTip.setArmorTip`'s `ARMOR_ATT_NAME` (lazily, after the lang table loads). */
function armorAttName(type: number): string {
  return i18n(`Tooltip_BattleShopGoodsTip_${type}_1`);
}

/** `BattleShopGoodsTip.setArmorTip`: the green attribute lines of a raw `cfg_armor` row. */
export function battleShopArmorTipText(armor: Row | undefined): string {
  if (!armor || armor.attribute == null) return '';
  const att = String(armor.attribute).split(',');
  const cnt = int(att[0]);
  let desc = "<font color='#00FF00'>";
  for (let i = 0; i < cnt; i++) {
    const value = att[i * 2 + 2] ?? '';
    const name = armorAttName(int(att[i * 2 + 1]));
    desc += (i === 0 ? `+${value}` : ` +${value}`) + ` ${name}`;
  }
  desc += ` \n ${i18n('Tooltip_ArmorTooltip_28_1')}${int(armor.hero_level)}`;
  return `${desc}</font>`;
}

/** `BattleShopGoodsTip.setHeroTip`: the green stats lines of a raw `cfg_hero` row. */
export function battleShopHeroTipText(hero: Row | undefined): string {
  if (!hero) return '';
  let desc = "<font color='#00FF00'>";
  desc += int(hero.level) + i18n('Tooltip_BattleShopGoodsTip_15_1');
  desc += int(hero.command_base) + i18n('Tooltip_BattleShopGoodsTip_17_1');
  desc += int(hero.affairs_base) + i18n('Tooltip_BattleShopGoodsTip_18_1');
  desc += int(hero.bravery_base) + i18n('Tooltip_BattleShopGoodsTip_19_1');
  desc += int(hero.wisdom_base) + i18n('Tooltip_BattleShopGoodsTip_20_1');
  return `${desc}</font>`;
}

/** `BattleBuyGoodsDialog.levelToAchievementName`: the 孟获 achievement of PVE level 1-4. */
export function levelToAchievementName(level: number): string {
  return (
    [
      '--',
      i18n('Battle_BattleChoiceDialogSrc_31_1'),
      i18n('Battle_BattleChoiceDialogSrc_31_2'),
      i18n('Battle_BattleChoiceDialogSrc_31_3'),
    ][level - 1] ?? ''
  );
}

/** `BattleShopGoodsTip.setPrice` / `setChiBiPrice`: the `creditPrice` line under the title. */
function battleShopCreditLine(good: BattleShopGood): string {
  if (good.battleGoodsType === 1 && good.battleBelong === '11000') {
    return `${good.creditPrice}${i18n('Shop_ShopDialog_9_3')}`;
  }
  if (good.group === 7) return ' ';
  return `${good.creditPrice}${i18n('Tooltip_BattleShopGoodsTip_26_1')}`;
}

/** `BattleShopGoodsTip.setPrice`'s `medalPrice` line (`setChiBiPrice` reuses it verbatim). */
function battleShopMedalLine(good: BattleShopGood): string {
  if (good.group !== 7) return `${good.medalPrice} ${good.medalName}`;
  if (int(good.battleBelong) === 9001)
    return `${good.medalPrice} ${i18n('Battle_BattleShopGoodsTip_2')}`;
  return `${good.medalPrice} ${i18n('Shop_ShopDialog_9_2')}`;
}

/** `BattleShopGoodsTip.moreArmorTip`: the red-when-unmet requirement line of group-7 armors. */
function battleShopArmorNeed(good: BattleShopGood, shop: BattleShopState): string {
  const red = (value: string) => `<font color='#FF0000'>${value}</font>`;
  if (int(good.battleBelong) === 9001) {
    const name = levelToAchievementName(good.creditPrice);
    const need = good.creditPrice > shop.pveLevel ? red(name) : name;
    return ` \n <font color='#00FF00'>${i18n('Battle_BattleShopGoodsTip_1')}${need}</font>`;
  }
  const level =
    good.creditPrice > shop.battleArea ? red(String(good.creditPrice)) : String(good.creditPrice);
  return ` \n <font color='#00FF00'>${i18n('Tooltip_ArmorTooltip_32_1')}${level}</font>`;
}

/** The `{title, text}` of ui/tooltip's goods tip (`createGoodsTip` + `setTipText`). */
export interface BattleShopGoodTip {
  title: string;
  text: string;
}

/**
 * `BattleChoiceDialog.createGoodsTip`: title, the two price lines, the decorated description and
 * the green armor / hero detail of the `mArmorMap[gid]` / `mHeroMap[gid]` row (group 7 armors
 * add the requirement line). The view renders it through ui/GoodsTip.vue.
 */
export function battleShopGoodTip(good: BattleShopGood, shop: BattleShopState): BattleShopGoodTip {
  let text = `${battleShopCreditLine(good)}\n${battleShopMedalLine(good)}\n${good.description}`;
  if (good.battleGoodsType === 1) {
    const armor = shop.armorAry.find((row) => int(row.id) === good.gid);
    const armorTip = battleShopArmorTipText(armor);
    if (armorTip) text += `\n${armorTip}`;
    if (good.group === 7) text += battleShopArmorNeed(good, shop);
  } else if (good.battleGoodsType === 2) {
    const hero = shop.heroAry.find((row) => int(row.id) === good.gid);
    const heroTip = battleShopHeroTipText(hero);
    if (heroTip) text += `\n${heroTip}`;
  }
  return { title: good.name, text };
}

/** One row of the 勋章兑换 dialog: `[name, tid, rate, count]`. */
export interface MedalExchangeRow {
  name: string;
  tid: number;
  rate: number;
  count: number;
}

/** `getMedalExchangeInfo` → `[name, tid, rate, count]` rows. */
export function parseMedalExchangeInfo(d: unknown[]): MedalExchangeRow[] {
  return (Array.isArray(d) ? d : []).map((row) => {
    const cells = Array.isArray(row) ? row : [];
    return {
      name: String(cells[0] ?? ''),
      tid: int(cells[1]),
      rate: int(cells[2]),
      count: int(cells[3]),
    };
  });
}

/** `Shop_BattleMedalChangeDialog.onChange`: `rate×name=1汉室勋章`. */
export function medalChangeRate(row: MedalExchangeRow): string {
  return `${row.rate}${row.name}=${'1汉室勋章'}`;
}

/** One row of the 勋章记录 dialog (`BattleMetalRecord.setData`). */
export interface MedalRecordRow {
  name: string;
  count: number;
}

/** `getMedalRecord` → the `sys_things × cfg_things` rows of tids 30000-30010. */
export function parseMedalRecord(d: unknown[]): MedalRecordRow[] {
  return (Array.isArray(d[0]) ? (d[0] as Row[]) : Array.isArray(d) ? (d as Row[]) : []).map(
    (row) => ({ name: String(row.name ?? ''), count: int(row.count) }),
  );
}
