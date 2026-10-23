import { i18n } from '../i18n';
import { makeCid } from './world';

/**
 * Report.ReportListPanel / ReportDetailPanel logic: decoding the `getReport` / `getUnreadReport` /
 * `delReport` list replies and the `getReportDetail` battle rounds, plus the title / city / time
 * decoration the DataGrid showed. Side-effect free so it can be unit-tested against PHP-shaped
 * fixtures; the Vue panels keep only layout and command dispatch.
 */

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null || v === false ? '' : String(v));

/** `ReportListPanel.REPORT_TITLE[title]`: the 战报标题 for a `sys_report.title` id. */
export function reportTitleName(title: number): string {
  return i18n(`Report_ReportListPanelSrc_${title + 1}`);
}

/** `ReportListPanel.getColor(title)`: title 50 is red; otherwise the per-title colour table. */
export function reportColor(title: number): number {
  if (title === 50) return 0xff0000;
  return REPORT_COLOR[title] ?? 0xffffff;
}

/** `ReportListPanelSrc_47` / `_48` / `_49`: the "野外"/"未知"/"系统" fallbacks for blank cities. */
const FALLBACK = {
  origin: 'Report_ReportListPanelSrc_47',
  happen: 'Report_ReportListPanelSrc_48',
  system: 'Report_ReportListPanelSrc_49',
} as const;

/** `Utils.MakeEndTimeString`: a unix time as `YYYY-MM-DD HH:MM:SS` (what the report list showed). */
export function makeEndTimeString(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** One decorated report row, as `ReportListPanel.onLoadData` built it from the server row. */
export interface ReportItem {
  id: number;
  title: number;
  titleName: string;
  type: number;
  read: number;
  bold: boolean;
  color: number;
  battleid: number;
  fromBattlenet: number;
  /** Raw origin/happen cids kept for the detail header. */
  origincid: number;
  happencid: number;
  /** Decorated: a blank origin/happen city falls back to the 野外/未知 label. */
  origincity: string;
  happencity: string;
  /** `Utils.makeCid`, or the 系统 label when origincid is 0. */
  fromcid: string;
  happencidLabel: string;
  happentime: string;
  /** The HTML body of a non-battle report (present on the row the server sends). */
  content: string;
  selected: boolean;
}

/** `ReportListPanel.onLoadData`: a server report row -> a decorated list item. */
export function parseReportItem(row: Row): ReportItem {
  const title = int(row.title);
  const read = int(row.read);
  const origincid = int(row.origincid);
  const origincity = str(row.origincity) || i18n(FALLBACK.origin);
  const happencity = str(row.happencity) || i18n(FALLBACK.happen);
  return {
    id: int(row.id),
    title,
    titleName: reportTitleName(title),
    type: int(row.type),
    read,
    bold: read === 0,
    color: reportColor(title),
    battleid: int(row.battleid),
    fromBattlenet: int(row.from_battlenet),
    origincid,
    happencid: int(row.happencid),
    origincity,
    happencity,
    fromcid: origincid === 0 ? i18n(FALLBACK.system) : makeCid(origincid),
    happencidLabel: makeCid(int(row.happencid)),
    happentime: makeEndTimeString(int(row.time)),
    content: str(row.content),
    selected: false,
  };
}

/** The decoded `[pageCount, page, rows]` of a getReport / getUnreadReport / delReport reply. */
export interface ReportListReply {
  pageCount: number;
  page: number;
  items: ReportItem[];
}

/** `ReportDialog.onCommand` -> `ReportListPanel.onLoadData`: decode a list reply. */
export function parseReportList(data: unknown): ReportListReply {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const pageCount = int(d.shift());
  const page = int(d.shift());
  const rowsRaw = d.shift();
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as Row[]) : [];
  return { pageCount, page, items: rows.map(parseReportItem) };
}

/** One `sys_battle_report` round: its number and its already-formed HTML body. */
export interface ReportRound {
  round: number;
  report: string;
}

/**
 * `ReportDetailPanel.onData`: shift the rounds array out of the `getReportDetail` reply and
 * concatenate the per-round HTML into the body the InternetTextArea showed. Rounds come ordered.
 */
export function parseReportDetail(data: unknown): { rounds: ReportRound[]; html: string } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  const rowsRaw = d.shift();
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as Row[]) : [];
  const rounds = rows.map((r) => ({ round: int(r.round), report: str(r.report) }));
  return { rounds, html: rounds.map((r) => r.report).join('') };
}

/** `ReportListPanel.pageLabel` equivalent (`page+1/pageCount`, `0/0` when empty). */
export function reportPageLabel(pageCount: number, page: number): string {
  return pageCount > 0 ? `${page + 1}/${pageCount}` : '0/0';
}

/** `ReportListPanel.REPORT_COLOR`: the per-title text colour table (indexed by title). */
const REPORT_COLOR = [
  0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffff00, 0xffffff, 0xffff00, 0xffffff,
  0xffff00, 0xffffff, 0xffff00, 0xff0000, 0xff0000, 0xff0000, 0x00d9ff, 0xff0000, 0xff0000,
  0x00ff00, 0x00d9ff, 0x00d9ff, 0x00d9ff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xff0000,
  0xffff00, 0xff0000, 0xffff00, 0xffff00, 0xffff00, 0xffff00, 0xffff00, 0xffff00, 0xffff00,
  0xffff00, 0xffff00, 0xffff00, 0xffff00, 0xffff00, 0xffffff, 0xffffff, 0xffffff, 0xffffff,
  0xffffff, 0xffffff, 0xffff00, 0xffffff, 0xffffff, 0xffffff, 0xffff00, 0xffffff,
];
