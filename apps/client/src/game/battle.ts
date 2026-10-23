import { i18n } from '../i18n';

/**
 * Troop.BattleDialog logic: decoding the `getBattleData` snapshot and the `getBattleReport`
 * rounds / tactics, and the per-round HTML / result-line the 战斗 view appends. Side-effect free
 * for PHP-shaped fixture tests; the Vue dialog keeps only layout and command dispatch.
 *
 * The decode order mirrors `BattleDialog.onLoadBattleData` exactly (which matches TroopFunc.php's
 * getBattleData return array), including the quirk that the 战场战 (type 4) branch always reads a
 * resist-user row even when resistuid is 0.
 */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null || v === false ? '' : String(v));
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** sys_battle.type 4: 战场战. */
export const BATTLE_TYPE_FIELD = 4;

/** One side's `mem_battle_tactics` orders, keyed by soldier type (`stype`). */
export interface BattleTactic {
  stype: number;
  action: number;
  target: number;
  action2: number;
  target2: number;
}

/** The decoded `getBattleReport` reply: battle state, rounds and both sides' tactics. */
export interface BattleReport {
  /** `sys_battle` state/result row. */
  sysbattle: Row | null;
  /** `mem_battle` row (wall hp, cids, hids, type). */
  membattle: Row | null;
  rounds: { round: number; report: string }[];
  attackTactics: BattleTactic[];
  resistTactics: BattleTactic[];
}

/** `ReportParser.parseRound`: the client wraps each round's HTML with a round header. */
export function parseRoundHtml(round: unknown, report: unknown): string {
  const header = i18n('Report_ReportParser_round') || `第${int(round)}回合`;
  return `<p><b>${header.replace('%d', String(int(round)))}</b></p>${str(report)}`;
}

function parseTactic(row: Row): BattleTactic {
  return {
    stype: int(row.stype),
    action: int(row.action),
    target: int(row.target),
    action2: int(row.action2),
    target2: int(row.target2),
  };
}

/** `BattleDialog.onLoadBattleReport`: decode `[sysbattle, membattle, rounds, atkTac, resTac]`. */
export function parseBattleReport(data: unknown): BattleReport {
  const arr = Array.isArray(data) ? [...(data as unknown[])] : [];
  const sb = arr.shift();
  const mb = arr.shift();
  const roundsRaw = arr.shift();
  const atk = arr.shift();
  const res = arr.shift();
  const rounds = (Array.isArray(roundsRaw) ? (roundsRaw as Row[]) : []).map((r) => ({
    round: int(r.round),
    report: str(r.report),
  }));
  return {
    sysbattle: isRow(sb) ? sb : null,
    membattle: isRow(mb) ? mb : null,
    rounds,
    attackTactics: (Array.isArray(atk) ? (atk as Row[]) : []).map(parseTactic),
    resistTactics: (Array.isArray(res) ? (res as Row[]) : []).map(parseTactic),
  };
}

/** The decoded `getBattleData` snapshot the BattleDialog opens on. */
export interface BattleData {
  battleType: number;
  attackUser: Row | null;
  resistUser: Row | null;
  attackCity: Row | null;
  resistCid: number;
  resistCity: Row | null;
  attackHid: number;
  attackHero: Row | null;
  resistHid: number;
  resistHero: Row | null;
  /** The first `getBattleReport` batch bundled at the tail of the reply. */
  report: BattleReport;
}

/**
 * `BattleDialog.onLoadBattleData`: decode the positional `getBattleData` reply. The 战场战 branch
 * always consumes a resist-user row (`_loc3_ > 0 || mBattleType == 4`); the attacker hero slot is
 * `[hid, heroRow]` with a `-1` sentinel folded into "no hero" as the original treated it.
 */
export function parseBattleData(data: unknown): BattleData {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const battleType = int(d.shift());

  const attackUid = int(d.shift());
  const attackUser = attackUid > 0 ? asRow(d.shift()) : null;

  const resistUid = int(d.shift());
  const resistUser = resistUid > 0 || battleType === BATTLE_TYPE_FIELD ? asRow(d.shift()) : null;

  const attackCidFlag = int(d.shift());
  const attackCity = attackCidFlag > 0 ? asRow(d.shift()) : null;

  const resistCid = int(d.shift());
  const resistCity = resistCid > 0 ? asRow(d.shift()) : null;

  const attackHid = int(d.shift());
  const attackHero = attackHid > 0 ? asRow(d.shift()) : null;

  const resistHid = int(d.shift());
  const resistHero = resistHid > 0 ? asRow(d.shift()) : null;

  return {
    battleType,
    attackUser,
    resistUser,
    attackCity,
    resistCid,
    resistCity,
    attackHid,
    attackHero,
    resistHid,
    resistHero,
    report: parseBattleReport(d.shift()),
  };
}

function asRow(v: unknown): Row | null {
  return isRow(v) ? v : null;
}

/**
 * `BattleDialog.onLoadBattleReport` result line: when `sys_battle.state == 1` the viewer sees
 * win / lose / draw from their own side. Returns the i18n body suffix, or '' while in progress.
 */
export function battleResultLine(sysbattle: Row | null, userIsAttack: boolean): string {
  if (!sysbattle || int(sysbattle.state) !== 1) return '';
  const result = str(sysbattle.result);
  if ((result === '0' && userIsAttack) || (result === '1' && !userIsAttack)) {
    return i18n('Troop_BattleDialogSrc_40'); // 胜
  }
  if ((result === '1' && userIsAttack) || (result === '0' && !userIsAttack)) {
    return i18n('Troop_BattleDialogSrc_41'); // 败
  }
  if (result === '2') return i18n('Troop_BattleDialogSrc_42'); // 平
  return '';
}

/** Whether a battle has finished (`sys_battle.state == 1`), for stopping the round poll. */
export function battleFinished(sysbattle: Row | null): boolean {
  return !!sysbattle && int(sysbattle.state) === 1;
}

/** The highest round number in a report batch (`mLastRound` bookkeeping). */
export function maxRound(rounds: { round: number }[]): number {
  return rounds.reduce((m, r) => Math.max(m, r.round), 0);
}
