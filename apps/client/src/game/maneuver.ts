import { i18n } from '../i18n';

type Row = Record<string, unknown>;

export interface ManeuverSoldier {
  sid: number;
  name: string;
  count: number;
  diecount: number;
}

export function normalizeManeuverCount(raw: unknown): number {
  const count = parseInt(String(raw), 10);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(count, 200000);
}

export function serializeManeuverSoldiers(soldiers: ManeuverSoldier[]): string {
  return `${soldiers.length},${soldiers.map((s) => `${s.sid},${s.count},`).join('')}`;
}

export function parseManeuverLosses(value: unknown): Map<number, number> {
  const parts = String(value ?? '').split(',');
  const count = parseInt(parts[0] ?? '', 10) || 0;
  const losses = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const sid = parseInt(parts[i * 2 + 1] ?? '', 10) || 0;
    const lost = parseInt(parts[i * 2 + 2] ?? '', 10) || 0;
    losses.set(sid, lost);
  }
  return losses;
}

export function formatManeuverResult(row: Row): string {
  const result = Number(row.result);
  const outcomeKey =
    result === 0
      ? 'Ground_ManeuverDialogSrc_2'
      : result === 1
        ? 'Ground_ManeuverDialogSrc_3'
        : 'Ground_ManeuverDialogSrc_4';
  const outcomeFallback = result === 0 ? '进攻方胜' : result === 1 ? '防守方胜' : '双方战平';
  return `${i18n('Ground_ManeuverDialogSrc_5') || '战斗持续'}${Number(row.round) || 0}${i18n('Ground_ManeuverDialogSrc_6') || '回合，'}${i18n(outcomeKey) || outcomeFallback}${i18n('Ground_ManeuverDialogSrc_7') || '。'}`;
}
