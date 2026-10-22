type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** `Define.ID_BUILDING_OFFICE`: the 官府 dialog that hosts 将领历练. */
export const ID_BUILDING_OFFICE = 11;

/** A 历练 type (cfg_hero_expr_types): 修身养性 (1) and 闯荡江湖 (2) are startable. */
export interface ExprType {
  type: number;
  name: string;
  intro: string;
  hour_expr: number;
  hour_gold: number;
  hour_money: number;
  min_hour: number;
  max_hour: number;
  min_carraymoney: number;
  max_carraymoney: number;
}

export function parseExprType(row: Row): ExprType {
  return {
    type: int(row.type),
    name: str(row.name),
    intro: str(row.intro),
    hour_expr: int(row.hour_expr),
    hour_gold: int(row.hour_gold),
    hour_money: int(row.hour_money),
    min_hour: int(row.min_hour),
    max_hour: int(row.max_hour),
    min_carraymoney: int(row.min_carraymoney),
    max_carraymoney: int(row.max_carraymoney),
  };
}

/** A row of the 历练 hero list (`HeroExprDialog.loadExprHeros`). */
export interface ExprHero {
  hid: number;
  cid: number;
  heroname: string;
  state: number;
  herotype: number;
  hero_health: number;
  level: number;
  exprname: string | null;
  starttime: number | null;
  endtime: number | null;
  /** Seconds until the expr ends (<= 0 once finished). */
  leftTime: number;
  /** Seconds the expr has already run. */
  onTime: number;
}

/**
 * HeroExprDialog.loadExprHeros: builds the display rows from the `[now, heros, types]` reply,
 * dropping the 君主将 (herotype 1000) and computing each running expr's elapsed / remaining time.
 */
export function parseExprHeros(reply: unknown[]): {
  now: number;
  heros: ExprHero[];
  types: ExprType[];
} {
  const now = int(reply[0]);
  const heroRows = Array.isArray(reply[1]) ? (reply[1] as Row[]) : [];
  const typeRows = Array.isArray(reply[2]) ? (reply[2] as Row[]) : [];
  const heros: ExprHero[] = [];
  for (const r of heroRows) {
    if (int(r.herotype) === 1000) continue;
    const starttime = r.starttime == null ? null : int(r.starttime);
    const endtime = r.endtime == null ? null : int(r.endtime);
    const leftTime = endtime == null ? 0 : endtime - now;
    const onTime =
      endtime == null || starttime == null ? 0 : (now > endtime ? endtime : now) - starttime;
    heros.push({
      hid: int(r.hid),
      cid: int(r.cid),
      heroname: str(r.heroname),
      state: int(r.state),
      herotype: int(r.herotype),
      hero_health: int(r.hero_health),
      level: int(r.level),
      exprname: r.exprname == null ? null : str(r.exprname),
      starttime,
      endtime,
      leftTime,
      onTime,
    });
  }
  return { now, heros, types: typeRows.map(parseExprType) };
}

/** `HeroExprDialog.getState`-style: only idle (state 0) heroes can start a new expr. */
export function startableHeros(heros: ExprHero[]): ExprHero[] {
  return heros.filter((h) => h.state === 0);
}

/**
 * BeginHeroExprDialog.updateExprDescription: substitutes the level-scaled 黄金 / 经验 numbers into
 * the type's `intro` text (the preview shown before starting).
 */
export function exprDescription(type: ExprType, heroLevel: number): string {
  const gold = int(type.hour_gold) * heroLevel;
  const exp = int(type.hour_expr) * heroLevel;
  return type.intro.replace(/黄\s*金\s*\d+/, `黄金${gold}`).replace(/经\s*验\s*\d+/, `经验${exp}`);
}

/** BeginHeroExprDialog.onBeginExpr: the `beginExprHero` argument tuple. */
export function beginExprArgs(
  hero: ExprHero,
  type: ExprType,
  hours: number,
  carrayMoney: number,
): [number, number, number, number, number] {
  return [hero.hid, hero.cid, type.type, hours, carrayMoney];
}

/**
 * BeginHeroExprDialog.onSubmit: the total 元宝 spent (`hours × hour_money` plus the carried gold),
 * used to decide whether a confirmation is needed. Returns 0 when nothing is spent.
 */
export function exprMoneyCost(type: ExprType, hours: number, carrayMoney: number): number {
  const base = type.hour_money > 0 ? hours * type.hour_money : 0;
  return base + Math.max(0, carrayMoney);
}

/** A 历练 reward awaiting purchase, surfaced to the player by a `event:<id>` link in the report. */
export function finishCommonExprArgs(rewardId: number): [number] {
  return [rewardId];
}
