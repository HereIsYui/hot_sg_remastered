import { i18n } from '../i18n';

/**
 * Lottery/MainDialog + UItem: pure helpers of the 幸运宝盒 wheel. The whitelisted commands live in
 * the `lottery` action (startLottery / getLotteryReward / autoGetReward / restart / useMoney /
 * getTodayCount / ...); getGoods is NOT in the original openfunc — the original client's
 * MainDialog.onCreate call always answered command_exception, so the remade dialog does not send
 * it and fills the wheel from a getLotteryReward / autoGetReward reply instead.
 */

export type LotteryGood = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;

/** `MainDialog.TOTAL_GOODS`: the 8 wheel slots in a ring. */
export const LOTTERY_TOTAL_GOODS = 8;

/**
 * `MainDialog.newRound` (AS3 975-1025): `[8 档物品, winType, winId, winCnt, restartCount,
 * todayCount]`.
 */
export interface LotteryRound {
  /** One array per grade (LotteryFunc getAllLevelGoods order 1,2,3,7,8,4,5,6). */
  levels: LotteryGood[][];
  winType: number;
  winId: number;
  winCnt: number;
  restartCount: number;
  todayCount: number;
}

export function parseLotteryRound(data: unknown): LotteryRound {
  const arr = Array.isArray(data) ? [...data] : [];
  const rawLevels = arr.shift();
  const levels = Array.isArray(rawLevels) ? (rawLevels as LotteryGood[][]) : [];
  const winType = int(arr.shift());
  const winId = int(arr.shift());
  const winCnt = int(arr.shift());
  const restartCount = int(arr.shift());
  const todayCount = int(arr.shift());
  return { levels, winType, winId, winCnt, restartCount, todayCount };
}

/** `MainDialog.shuffle`: the grade arrays flatten into the 8 wheel slots, then Fisher-Yates. */
export function flattenGoods(
  round: LotteryRound,
  random: () => number = Math.random,
): LotteryGood[] {
  const goods: LotteryGood[] = [];
  for (const level of round.levels) {
    for (const good of Array.isArray(level) ? level : []) goods.push(good);
  }
  for (let i = 0; i < goods.length; i++) {
    const j = Math.floor(random() * goods.length);
    [goods[i], goods[j]] = [goods[j]!, goods[i]!];
  }
  return goods;
}

/**
 * `MainDialog.findWinItem` (AS3 435-449): the wheel slot whose gid (item) or id (armor) matches
 * the win and whose count equals the win count.
 */
export function findWinItemIndex(goods: LotteryGood[], winId: number, winCnt: number): number {
  for (let i = 0; i < goods.length; i++) {
    const good = goods[i]!;
    const id = good.gid != null ? int(good.gid) : int(good.id);
    if (id === winId && int(good.count) === winCnt) return i;
  }
  return -1;
}

/**
 * `UItem.makeItemImageName` (AS3 307-333): a goods row uses pack_/item_, an armor row uses
 * armor/<image or id>.
 */
export function lotteryItemImage(good: LotteryGood | null): string {
  if (!good) return '';
  if (good.gid != null) {
    return int(good.image) > 0
      ? `images/pack_${int(good.image)}.png`
      : `images/item_${int(good.gid)}.png`;
  }
  return int(good.image) > 0
    ? `images/armor/${int(good.image)}.png`
    : `images/armor/${int(good.id)}.png`;
}

/** `UItem.createGoodsTip`: armor rows have no description — the armor tip builds one. */
export function lotteryItemIsArmor(good: LotteryGood | null): boolean {
  return !!good && good.gid == null;
}

/**
 * `MainDialog.onCommand` for autoGetReward (AS3 691-707): `[win 行, fresh round]` — the win row's
 * gtype is 0 for a goods win (a gid) and 1 for an armor win.
 */
export function parseAutoGetReward(data: unknown): {
  win: LotteryGood;
  gtype: number;
  round: LotteryRound;
} {
  const arr = Array.isArray(data) ? [...data] : [];
  const win = (arr.shift() ?? {}) as LotteryGood;
  return {
    win,
    gtype: win.gid != null ? 0 : 1,
    round: parseLotteryRound(arr),
  };
}

/**
 * `MainDialog.onCommand` for startLottery / restart. startLottery replies
 * `[winType, winId, winCnt, todayCount]`; restart answers `[winType, winId, winCnt]` only (the
 * original never touched mTodayCount there), so the count is read when present.
 */
export function parseWinReply(data: unknown): {
  winType: number;
  winId: number;
  winCnt: number;
  todayCount: number | null;
} {
  const arr = Array.isArray(data) ? [...data] : [];
  const winType = int(arr.shift());
  const winId = int(arr.shift());
  const winCnt = int(arr.shift());
  const todayCount = arr.length > 0 ? int(arr.shift()) : null;
  return { winType, winId, winCnt, todayCount };
}

/** `MainDialog.start` texts: winType -1 fails, -1/-2 ids mean 元宝不足 / 已玩过. */
export function lotteryWinFailText(winId: number): string {
  if (winId === -1) return i18n('Lottery_NoMoney');
  if (winId === -2) return i18n('Lottery_FullPlayCount');
  return '';
}
