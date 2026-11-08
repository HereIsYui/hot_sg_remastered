export type Row = Record<string, unknown>;

/**
 * `Battle.BattleChoiceDialog` 战场商城 + `Shop.BattleMedalChangeDialog` / `BattleMetalRecord`:
 * the reply shapes of `getUserBattleShopInfo`, `getMedalExchangeInfo`, `getMedalRecord` and the
 * goods naming / description decoration `initBattleShop` applied.
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
  /** The description decorations `initBattleShop` appended (limits / time left). */
  limit: string;
}

/** `getUserBattleShopInfo` → the parts the local shop tab shows. */
export interface BattleShopState {
  /** The nobility gate: 1 blocks the 剧情战场 / 据点战场 tabs. */
  flag: number;
  battles: Row[];
  gongxun: number;
  todayWarCount: number;
  maxDayCount: number;
  goods: BattleShopGood[];
  honour: number;
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
    limit,
  };
}

/** The `[flag, battles, gongxun, area, todayWarCount, maxDayCount, goods, armor, hero, honour…]`. */
export function parseBattleShopInfo(d: unknown[], withShop: boolean): BattleShopState {
  let flag = 0;
  if (withShop) flag = int(d.shift());
  const battles = (Array.isArray(d[0]) ? d.shift() : []) as Row[];
  const gongxun = int(d.shift());
  void d.shift(); // mUserBattleArea (cross-server)
  const todayWarCount = int(d.shift());
  const maxDayCount = int(d.shift());
  let goods: Row[] = [];
  let honour = 0;
  if (withShop) {
    goods = (Array.isArray(d[0]) ? d.shift() : []) as Row[];
    void d.shift(); // armorAry — the 装备 list keeps its raw rows (not rendered this round)
    void d.shift(); // heroAry
    honour = int(d.shift());
  }
  return {
    flag,
    battles,
    gongxun,
    todayWarCount,
    maxDayCount,
    goods: goods.map(parseBattleShopGood),
    honour,
  };
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
