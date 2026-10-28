import { i18n } from '../i18n';

/**
 * Stat/StatDialog: pure helpers of the 幕僚统计 dialog. The read commands live in the `stats`
 * action (getStats, one argument 0-5); every reply is `[[], <tag>, ...rows]` with the rows of the
 * matching tab and each row's cid already rendered as "(x,y)". The column tables build lazily —
 * the client strings load after the module import.
 */

export type StatRow = Record<string, unknown>;

export interface StatColumn {
  header: string;
  field: string;
  width: number;
}

export interface StatTab {
  key: string;
  label: string;
  tabLabel: string;
  columns: StatColumn[];
}

/** A column helper: the header key is `Stat_StatDialog_<n>_1`. */
const col = (n: number, field: string, width: number): StatColumn => ({
  header: i18n(`Stat_StatDialog_${n}_1`),
  field,
  width,
});

/** The column key of a numbered binding like `Stat_StatDialog_61_2`. */
const colKey = (key: string, field: string, width: number): StatColumn => ({
  header: i18n(key),
  field,
  width,
});

/**
 * The six tabs of the dialog in getStats order (StatDialog.onCreate, AS3 2363-2373), with the
 * columns of StatDialog.txt: 城池 (DataGridColumn1-10), 资源 (11-17), 产量 (18-24), 将领 (25-34),
 * 军队 (35-54, the pinyin soldier counts), 城防 (55-63).
 */
export function statTabs(): StatTab[] {
  return [
    {
      key: 'city',
      label: i18n('Stat_StatDialog_2_1'),
      tabLabel: i18n('Stat_StatDialog_8_1'),
      columns: [
        col(9, 'name', 100),
        col(10, 'cid', 76),
        col(11, 'people', 100),
        col(12, 'tax', 50),
        col(13, 'morale', 50),
        col(14, 'complaint', 50),
        col(15, 'buildingCount', 50),
        col(16, 'tecCount', 50),
        col(17, 'draftCount', 50),
        col(18, 'defenceCount', 50),
      ],
    },
    {
      key: 'resource',
      label: i18n('Stat_StatDialog_3_1'),
      tabLabel: i18n('Stat_StatDialog_19_1'),
      columns: [
        col(20, 'name', 100),
        col(21, 'cid', 76),
        col(22, 'gold', 90),
        col(23, 'food', 90),
        col(24, 'wood', 90),
        col(25, 'rock', 90),
        col(26, 'iron', 90),
      ],
    },
    {
      key: 'product',
      label: i18n('Stat_StatDialog_4_1'),
      tabLabel: i18n('Stat_StatDialog_27_1'),
      columns: [
        col(28, 'name', 100),
        col(29, 'cid', 76),
        col(30, 'gold_add', 90),
        col(31, 'food_add', 90),
        col(32, 'wood_add', 90),
        col(33, 'rock_add', 90),
        col(34, 'iron_add', 90),
      ],
    },
    {
      key: 'hero',
      label: i18n('Stat_StatDialog_5_1'),
      tabLabel: i18n('Stat_StatDialog_35_1'),
      columns: [
        col(36, 'name', 100),
        col(37, 'cid', 76),
        col(38, 'hero', 65),
        col(40, 'level', 55),
        col(41, 'command', 55),
        col(42, 'affairs', 55),
        col(43, 'bravery', 55),
        col(44, 'wisdom', 55),
        col(45, 'loyalty', 55),
        col(46, 'state', 55),
      ],
    },
    {
      key: 'army',
      label: i18n('Stat_StatDialog_6_1'),
      tabLabel: i18n('Stat_StatDialog_47_1'),
      columns: [
        col(48, 'name', 60),
        col(49, 'cid', 70),
        col(50, 'minfuCount', 60),
        col(51, 'yibingCount', 60),
        col(52, 'chihouCount', 60),
        col(53, 'changqiangCount', 60),
        col(54, 'daodunCount', 60),
        col(55, 'gongjianCount', 60),
        col(56, 'qingqiCount', 60),
        col(57, 'tieqiCount', 60),
        col(58, 'zizhongCount', 60),
        col(59, 'chuangnuCount', 60),
        col(60, 'chongcheCount', 60),
        col(61, 'toushiCount', 60),
        colKey('Stat_StatDialog_61_2', 'bing45Count', 60),
        colKey('Stat_StatDialog_61_3', 'bing46Count', 60),
        colKey('Stat_StatDialog_61_4', 'bing47Count', 60),
        colKey('Stat_StatDialog_61_5', 'bing48Count', 60),
        colKey('Stat_StatDialog_61_6', 'bing49Count', 60),
        colKey('Stat_StatDialog_61_7', 'bing50Count', 60),
      ],
    },
    {
      key: 'defence',
      label: i18n('Stat_StatDialog_7_1'),
      tabLabel: i18n('Stat_StatDialog_62_1'),
      columns: [
        col(63, 'name', 100),
        col(64, 'cid', 76),
        col(65, 'level', 50),
        col(66, 'xianjingCount', 60),
        col(67, 'jumaCount', 60),
        col(68, 'jiantaCount', 60),
        col(69, 'gunmuCount', 60),
        col(70, 'leishiCount', 60),
        col(71, 'area', 100),
      ],
    },
  ];
}

/** The 将领 tab's 排列方式 combo (Stat_StatDialog_72..78). */
export function statHeroSorts(): { label: string; field: string }[] {
  return [
    { label: i18n('Stat_StatDialog_72'), field: 'cid' },
    { label: i18n('Stat_StatDialog_73'), field: 'level' },
    { label: i18n('Stat_StatDialog_74'), field: 'command' },
    { label: i18n('Stat_StatDialog_75'), field: 'affairs' },
    { label: i18n('Stat_StatDialog_76'), field: 'bravery' },
    { label: i18n('Stat_StatDialog_77'), field: 'wisdom' },
    { label: i18n('Stat_StatDialog_78'), field: 'loyalty' },
  ];
}

/**
 * `StatDialog.onCommand` (AS3 1106-1124): `[[], tag, ...rows]` — the tag selects the panel, the
 * rows fill it, and a herotype of 1000 (the king) shows `--` for the loyalty.
 */
export function parseStatsReply(data: unknown): { tag: number; rows: StatRow[] } {
  const arr = Array.isArray(data) ? [...data] : [];
  arr.shift();
  const tag = parseInt(String(arr.shift() ?? 0), 10) || 0;
  const rows: StatRow[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const out: StatRow = { ...(row as StatRow) };
    if (parseInt(String(out.herotype ?? 0), 10) === 1000) out.loyalty = '--';
    rows.push(out);
  }
  return { tag, rows };
}

/**
 * `StatDialog.compareXxxAdd` (AS3 698/863/1206/1266/1852/1978/2419) via `onChangeSort`: the hero
 * rows re-inserted in descending numeric order of the field (NaN rows keep their order, so the
 * 城池 sort is stable like the original's parseInt("(...")).
 */
export function sortHeroStats(rows: StatRow[], sort: number): StatRow[] {
  const field = statHeroSorts()[sort]?.field ?? 'cid';
  const out: StatRow[] = [];
  for (const row of rows) {
    const value = parseInt(String(row[field] ?? ''), 10);
    let inserted = false;
    for (let i = 0; i < out.length; i++) {
      const other = parseInt(String(out[i]![field] ?? ''), 10);
      if (!Number.isNaN(value) && (Number.isNaN(other) || value > other)) {
        out.splice(i, 0, row);
        inserted = true;
        break;
      }
    }
    if (!inserted) out.push(row);
  }
  return out;
}
