/** 校场 (Ground) client helpers: parse the 伤兵 / 俘虏 / 逃兵 lists the server returns. */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** One soldier row in a 伤兵 / 俘虏 / 逃兵 list. */
export interface GroundSoldier {
  sid: number;
  name: string;
  count: number;
}

/**
 * A `getWoundedSoldier` / `getCaptiveSoldier` / `getLamster` reply: `[rows, goldNeed]` where each
 * row is `{sid, name, count}`.
 */
export interface GroundSoldierList {
  soldiers: GroundSoldier[];
  goldNeed: number;
}

export function parseGroundSoldiers(data: unknown): GroundSoldierList {
  const arr = Array.isArray(data) ? data : [];
  const rows = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : [];
  return {
    soldiers: rows
      .filter((r): r is Row => !!r && typeof r === 'object')
      .map((r) => ({ sid: int(r.sid), name: str(r.name), count: int(r.count) })),
    goldNeed: int(arr[1]),
  };
}
