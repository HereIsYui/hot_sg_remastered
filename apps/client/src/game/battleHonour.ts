import { i18n } from '../i18n';

/**
 * `Battle.BattleHonourStatDialog` / `BattleHonourStatList` over `getBattleHonourStat`:
 * per-camp average honour and the per-player contribution floor(10·honour/avg).
 */

type Row = Record<string, unknown>;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => String(v ?? '');

/** One camp block (`BattleHonourStatList.resetData`). */
export interface HonourStatList {
  unionid: string;
  /** `unionName + 阵营`. */
  title: string;
  /** `unionName + 阵营所有玩家平均战斗荣誉 + avgHonour`. */
  avgHonourDesc: string;
  users: { name: string; honour: number; contribute: number }[];
}

/**
 * `getBattleHonourStat` → `[avgHonourData, datas]`, two maps keyed by unionid; the reply is
 * `undefined` (null) for non-field battlefields — the dialog stays closed then.
 */
export function parseBattleHonourStat(d: unknown[]): HonourStatList[] {
  const avgMap = (
    d[0] && typeof d[0] === 'object' && !Array.isArray(d[0]) ? (d[0] as Record<string, Row>) : {}
  ) as Record<string, Row>;
  const datas = (d[1] ?? {}) as Record<string, Row[]>;
  return Object.keys(datas).map((unionid) => {
    const camp = avgMap[unionid] ?? {};
    const name = str(camp.name);
    return {
      unionid,
      title: `${name}${i18n('Battle_BattleHonourStatList_4_1')}`,
      avgHonourDesc: `${name}${i18n('Battle_BattleHonourStatList_5_1')}${str(camp.avgHonour ?? 0)}`,
      users: (datas[unionid] ?? []).map((row) => ({
        name: str(row.name),
        honour: int(row.honour),
        contribute: int(row.contribute),
      })),
    };
  });
}
