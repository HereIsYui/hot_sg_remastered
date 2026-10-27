import { parseTroopRow, type TroopRow } from './troop';

type Row = Record<string, unknown>;

export interface HongluTroop extends TroopRow {
  hero: string;
  herolevel: number;
  staytime: number;
  command: number;
}

export interface HongluInfo {
  unionName: string;
  troops: HongluTroop[];
  allowUnionTroop: boolean;
  allowAntiPlunder: boolean;
  allowAntiInvade: boolean;
}

const int = (value: unknown) => parseInt(String(value), 10) || 0;

export function parseHongluBuildingInfo(data: unknown): HongluInfo {
  const arr = Array.isArray(data) ? data : [];
  const union = Array.isArray(arr[2]) ? arr[2] : [];
  const troops = (Array.isArray(union[1]) ? union[1] : []).map((value) => {
    const row = (value ?? {}) as Row;
    return {
      ...parseTroopRow(row),
      hero: String(row.hero ?? ''),
      herolevel: int(row.herolevel),
      staytime: 0,
      command: 0,
    };
  });
  return {
    unionName: String(union[0] ?? ''),
    troops,
    allowUnionTroop: int(arr[3]) === 1,
    allowAntiPlunder: int(arr[4]) === 1,
    allowAntiInvade: int(arr[5]) === 1,
  };
}
