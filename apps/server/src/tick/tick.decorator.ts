import { SetMetadata } from '@nestjs/common';

export const TICK_HANDLER = 'hot:tick-handler';

/** Slots of the original `cfg_js.php` loop, which ran these handlers in this order. */
export const TickOrder = {
  /** HandleTroop：出征及返回处理 */
  Troop: 10,
  /** HandleBattle：战斗处理 */
  Battle: 20,
  /** HandleHeroHexprs：将领历练 */
  HeroExpr: 30,
  /** UpdateUsersCurse：天灾、人祸、排行 */
  Curse: 40,
  /** UpdateUsersTechnic：科技更新 */
  Technic: 50,
  /** UpdateUsersSoldier：军队更新 */
  Soldier: 60,
  /** UpdateUsersDeinforce：城防更新 */
  Defence: 70,
  /** HandleAutoTrans：自动运输 */
  AutoTrans: 80,
  /** HandleTrade：商场交易 */
  Trade: 90,
} as const;

export interface TickHandlerMeta {
  order: number;
}

/**
 * Runs the decorated method (may be async) on every settlement tick; it receives a `TickClock`
 * only when the debug endpoint runs its slot.
 */
export const TickHandler = (order: number) =>
  SetMetadata<string, TickHandlerMeta>(TICK_HANDLER, { order });
