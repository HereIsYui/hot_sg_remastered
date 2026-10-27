import { makeMailTime } from './mail';

export type RankRow = Record<string, unknown>;
export type RankPanelId =
  'king' | 'user' | 'union' | 'hero' | 'military' | 'rich' | 'battle' | 'activity';
export interface RankColumn {
  header: string;
  field: string;
  width: number;
  color?: (row: RankRow) => number;
}
export interface RankPanel {
  id: RankPanelId;
  label: string;
  types: readonly string[];
  sortLabels: readonly string[];
  columns: readonly RankColumn[];
}

const columns = (
  definitions: readonly (readonly [string, string, number])[],
): readonly RankColumn[] => definitions.map(([header, field, width]) => ({ header, field, width }));

export const RANK_PANELS: readonly RankPanel[] = [
  {
    id: 'king',
    label: '君主将',
    types: ['KingRankTotal'],
    sortLabels: [],
    columns: columns([
      ['排名', 'rank', 50],
      ['君主', 'name', 80],
      ['修为', 'levelname', 85],
      ['等级', 'level', 50],
      ['爵位', 'nobility', 70],
      ['战斗力', 'battle', 75],
      ['声望', 'prestige', 85],
      ['将领等级', 'hero_level', 80],
    ]),
  },
  {
    id: 'user',
    label: '玩家',
    types: ['user'],
    sortLabels: [],
    columns: columns([
      ['排名', 'rank', 50],
      ['君主', 'name', 100],
      ['联盟', 'union', 90],
      ['爵位', 'nobility', 65],
      ['声望', 'prestige', 90],
      ['城池', 'city', 55],
      ['人口', 'people', 80],
    ]),
  },
  {
    id: 'union',
    label: '联盟',
    types: ['union'],
    sortLabels: [],
    columns: columns([
      ['排名', 'rank', 50],
      ['联盟', 'name', 105],
      ['盟主', 'leader', 90],
      ['成员数', 'member', 65],
      ['名城数', 'famouscity', 65],
      ['声望', 'prestige', 90],
    ]),
  },
  {
    id: 'hero',
    label: '将领',
    types: ['hero_level', 'hero_affairs', 'hero_bravery', 'hero_wisdom', 'hero_command'],
    sortLabels: ['等级', '内政', '勇武', '智谋', '统率'],
    columns: columns([
      ['排名', 'rank', 50],
      ['将领', 'name', 85],
      ['君主', 'user', 85],
      ['等级', 'level', 55],
      ['统率', 'command', 65],
      ['内政', 'affairs', 65],
      ['勇武', 'bravery', 65],
      ['智谋', 'wisdom', 65],
    ]),
  },
  {
    id: 'military',
    label: '军事',
    types: ['military', 'military_attack', 'military_defence'],
    sortLabels: ['兵力', '攻击', '防御'],
    columns: columns([
      ['排名', 'rank', 60],
      ['君主', 'name', 110],
      ['联盟', 'unionname', 110],
      ['兵力', 'army', 100],
      ['攻击', 'attack', 100],
      ['防御', 'defence', 100],
    ]),
  },
  {
    id: 'rich',
    label: '财富',
    types: ['rich', 'rich_month', 'rich_day'],
    sortLabels: ['元宝消费', '月消费', '日消费'],
    columns: columns([
      ['排名', 'rank', 60],
      ['君主', 'name', 120],
      ['联盟', 'unionname', 110],
      ['元宝消费', 'total', 110],
      ['月消费', 'month', 110],
      ['日消费', 'day', 110],
    ]),
  },
  {
    id: 'battle',
    label: '战场',
    types: ['battle_total', 'battle_week', 'battle_day'],
    sortLabels: ['总荣誉', '周荣誉', '日荣誉'],
    columns: columns([
      ['排名', 'rank', 60],
      ['君主', 'name', 110],
      ['联盟', 'unionname', 110],
      ['总荣誉', 'total', 110],
      ['周荣誉', 'week', 110],
      ['日荣誉', 'day', 110],
    ]),
  },
  {
    id: 'activity',
    label: '活动',
    types: ['activity', 'activity_today', 'activity_yesterday'],
    sortLabels: ['总榜', '今日榜', '昨日榜'],
    columns: activityRankColumns(''),
  },
];

export function rankPanel(id: RankPanelId): RankPanel {
  return RANK_PANELS.find((panel) => panel.id === id) ?? RANK_PANELS[0]!;
}

export function rankType(id: RankPanelId, sort = 0): string {
  const panel = rankPanel(id);
  return panel.types[sort] ?? panel.types[0]!;
}

export interface RankReply {
  updateTime: number;
  pageCount: number;
  page: number;
  type: string;
  rows: RankRow[];
}

const int = (value: unknown) => parseInt(String(value), 10) || 0;

export function parseRankReply(data: unknown): RankReply {
  const arr = Array.isArray(data) ? data : [];
  return {
    updateTime: int(arr[0]),
    pageCount: int(arr[1]),
    page: int(arr[2]),
    type: String(arr[3] ?? ''),
    rows: Array.isArray(arr[4]) ? (arr[4] as RankRow[]) : [],
  };
}

export function rankPageLabel(reply: Pick<RankReply, 'page' | 'pageCount'>): string {
  return reply.pageCount > 0 ? `${reply.page + 1}/${reply.pageCount}` : '0/0';
}

export interface RankSearch {
  kind: 'rank' | 'name' | null;
  value: string | number;
}

export function rankCellColor(row: RankRow, search: RankSearch): number {
  if (
    (search.kind === 'rank' && int(row.rank) === int(search.value)) ||
    (search.kind === 'name' && String(row.name ?? '') === String(search.value))
  ) {
    return 0xffff00;
  }
  return 0xffffff;
}

export function rankColumns(panel: RankPanel, search: RankSearch): RankColumn[] {
  return panel.columns.map((column) => ({
    ...column,
    color: (row) => rankCellColor(row, search),
  }));
}

export function rankUpdateTime(seconds: number, unit: (key: string) => string): string {
  return makeMailTime(seconds, unit);
}

export function activityRankColumns(title: unknown): RankColumn[] {
  const custom = String(title ?? '').split(',');
  const labels = [0, 1, 2].map((index) => custom[index] || ['积分', '声望', '荣誉'][index]!);
  return [
    ...columns([
      ['排名', 'rank', 50],
      ['君主', 'name', 110],
      [labels[0]!, 'sort3', 110],
      [labels[1]!, 'sort4', 110],
      [labels[2]!, 'sort5', 110],
    ]),
  ];
}

export interface RankConfig {
  activity: RankRow | null;
  enabled: boolean;
}

export function parseRankConfig(data: unknown): RankConfig {
  const arr = Array.isArray(data) ? data : [];
  const first = arr[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return { activity: first as RankRow, enabled: int(arr[1]) !== 0 };
  }
  return { activity: null, enabled: int(first) !== 0 };
}

export interface RankRewardResult {
  ok: boolean;
  message: string;
  items: unknown[];
}

export function parseRankReward(data: unknown): RankRewardResult {
  const arr = Array.isArray(data) ? data : [];
  const ok = int(arr[0]) === 1;
  return {
    ok,
    message: ok ? '' : String(arr[1] ?? ''),
    items: ok && Array.isArray(arr[1]) ? arr[1] : [],
  };
}
