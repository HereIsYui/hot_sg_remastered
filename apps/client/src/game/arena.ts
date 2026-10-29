type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v ?? 0), 10) || 0;
const row = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? ((v as unknown[]).filter(row) as Row[]) : [];

/**
 * PKFunc.php 竞技场半部 — the arena client helpers (Arena.ArenaDialog + AssembleHeroPanel +
 * RankRewardDialog). The fight itself reuses the shared PK engine (`startArenaChallenge`).
 */

/** `Utils.getNewKingName`: the king-tier colour of a name (Utils.as:191). */
export function kingName(level: number, name: string): string {
  const color =
    level <= 2
      ? 'ffffff'
      : level <= 4
        ? '33a800'
        : level <= 5
          ? '0090ff'
          : level <= 7
            ? '9933FF'
            : level <= 8
              ? 'FF9900'
              : level <= 9
                ? 'FF0033'
                : 'FFCC00';
  return `<font color='#${color}'>${name}</font>`;
}

/** `Utils.getYMDHMS`: `20yy年MM月dd日 hh:mm:ss` in the server clock. */
export function ymdhms(seconds: number, yearWord = '年'): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return (
    `20${pad(d.getFullYear() - 2000)}${yearWord}` +
    `${pad(d.getMonth() + 1)}${'月'}${pad(d.getDate())}${'日'} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** sys_user_assemble row + the display fields of ArenaDialog (onGetData, AS3:1060). */
export interface ArenaBase {
  rank: number;
  count: number;
  /** `countStr`: the count plus Arena_Battle_4_1 (次). */
  countStr: string;
  maxrank: number;
  maxwin: number;
  /** `leavingtime` seconds; 0 when not cooling. */
  leavingtime: number;
}

export function parseArenaBase(data: unknown): ArenaBase | null {
  const b = row(data);
  if (!b) return null;
  const base: Row = { ...b };
  return {
    rank: int(base.rank),
    count: int(base.count),
    countStr: `${int(base.count)}次`,
    maxrank: int(base.maxrank),
    maxwin: int(base.maxwin),
    leavingtime: Math.max(0, int(base.leavingtime)),
  };
}

/** One mem_assemble_record row rendered into the 战绩 textarea (dealWithOwnBattleInfo). */
export function ownBattleLine(rec: Row, uid: number, i18n: (k: string) => string): string {
  const fromuid = int(rec.fromuid);
  let attacker: string;
  let defender: string;
  let change = '';
  if (fromuid === uid) {
    attacker = kingName(int(rec.fromKingLevel), i18n('Arena_Battle_1_1'));
    defender = kingName(int(rec.toKingLevel), String(rec.toname ?? ''));
    if (int(rec.flag) === 1 && int(rec.ischange) > 0) {
      change =
        i18n('Arena_Battle_1_2') +
        `<font color='#F7E970'>${int(rec.attackrank)}</font>` +
        i18n('Arena_Battle_1_3');
    }
  } else {
    attacker = kingName(int(rec.fromKingLevel), String(rec.fromname ?? ''));
    defender = kingName(int(rec.toKingLevel), i18n('Arena_Battle_1_1'));
    if (int(rec.flag) === 1 && int(rec.ischange) > 0) {
      change =
        i18n('Arena_Battle_1_4') +
        `<font color='#F7E970'>${int(rec.resistrank)}</font>` +
        i18n('Arena_Battle_1_3');
    }
  }
  let verdict: string;
  let reward = '';
  if (int(rec.flag) === 1) {
    verdict = i18n('Arena_Battle_1_5');
    if (int(rec.rewardid) !== -99) {
      reward =
        i18n('Arena_Battle_1_7') +
        `<font color='#06FF00'>${String(rec.rewardname ?? '')}*${int(rec.rewardcount)}</font>` +
        i18n('Arena_Battle_1_11');
    }
  } else {
    verdict = i18n('Arena_Battle_1_6');
  }
  return (
    `<p align='left'>${ymdhms(int(rec.time))}</p>` +
    attacker +
    i18n('Arena_Battle_1_8') +
    defender +
    '，' +
    verdict +
    reward +
    change +
    '<br />'
  );
}

/** loadUserAssembleRecord → the 战绩 html (dealWithOwnBattleInfo). */
export function ownBattleHtml(list: unknown, uid: number, i18n: (k: string) => string): string {
  return rows(list)
    .map((rec) => ownBattleLine(rec, uid, i18n))
    .join('');
}

/** loadWinRecord → the 连胜公告 html (dealWithWinRecrod). */
export function winRecordHtml(list: unknown, i18n: (k: string) => string): string {
  return rows(list)
    .map((rec) => {
      const from = kingName(int(rec.fromKingLevel), String(rec.fromnameWin ?? ''));
      const to = kingName(int(rec.toKingLevel), String(rec.tonameWin ?? ''));
      return (
        from +
        i18n('Arena_Battle_1_9') +
        to +
        i18n('Arena_Battle_1_7') +
        `<font color='#F7E970'>${int(rec.times)}</font>` +
        i18n('Arena_Battle_1_10') +
        '<br />'
      );
    })
    .join('');
}

/** One rank list row after dealWithUserRankInfo (AS3:1233). */
export interface ArenaRankRow extends Row {
  userid: number;
  rank: number;
  username: string;
  kingLevel: number;
  rewardname: string;
  base: number;
  canGetRewardCount: string;
  /** `getRewardTime` seconds until the occupier's reward matures. */
  lefttimeInt: number;
  lefttimeStr: string;
  /** The row's own buttons: the occupier claims, others challenge. */
  butRewardIsShow: boolean;
  butChallengeIsShow: boolean;
}

export function parseRankList(data: unknown, uid: number): ArenaRankRow[] {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return rows(d.shift()).map((info) => {
    const r: Row = { ...info };
    r.lefttimeInt = int(r.getRewardTime);
    r.lefttimeStr = int(r.getRewardTime) <= 0 ? '--' : String(r.getRewardTime);
    r.butRewardIsShow = int(r.userid) === uid;
    r.butChallengeIsShow = int(r.userid) !== uid;
    return r as ArenaRankRow;
  });
}

/** The `loadArenaUserData` head: the "热血名将" NPC rank (dealWithUserRankInfo). */
export function npcPosOf(list: unknown): number {
  return int((Array.isArray(list) ? (list as unknown[])[0] : 0) ?? 0);
}

/** `Arena_Battle_7_8` substitute: 通告："热血名将"出现在第{0}名！ */
export function npcPosText(npcPos: number, i18n: (k: string) => string): string {
  return npcPos > 0 ? i18n('Arena_Battle_7_8').replace('{0}', String(npcPos)) : '';
}

/** `parseRewardTextTip` (AS3:726): the reward cell text of a rank row. */
export function rewardTip(r: ArenaRankRow, uid: number, i18n: (k: string) => string): string {
  const lefttime = r.lefttimeInt;
  if (int(r.userid) === uid) {
    return lefttime > 0
      ? i18n('Arena_Battle_reward_2_1') +
          r.lefttimeStr +
          i18n('Arena_Battle_reward_2_2') +
          r.rewardname +
          '】*' +
          r.canGetRewardCount
      : i18n('Arena_Battle_reward_1_13') + r.rewardname + '*' + r.canGetRewardCount;
  }
  if (int(r.userid) < 1000) {
    return i18n('Arena_Battle_reward_1_13') + r.rewardname + '*' + r.canGetRewardCount;
  }
  return lefttime > 0
    ? i18n('Arena_Battle_reward_2_4') + r.rewardname + '*' + r.canGetRewardCount
    : i18n('Arena_Battle_reward_2_3');
}

/** `getRowColor` (AS3:857): own row yellow, NPC rows grey. */
export function rowColor(userid: number, uid: number): number {
  if (userid === uid) return 16776960;
  if (userid < 1000) return 11309055;
  return 16777215;
}

/** The 排名跳转 combo entries (Arena_Battle_7_0..7_5) and their goto values. */
export const GOTO_RANKS: { label: string; goto: number }[] = [
  { label: 'Arena_Battle_7_0', goto: 0 },
  { label: 'Arena_Battle_7_1', goto: 100 },
  { label: 'Arena_Battle_7_2', goto: 300 },
  { label: 'Arena_Battle_7_3', goto: 600 },
  { label: 'Arena_Battle_7_4', goto: 1000 },
  { label: 'Arena_Battle_7_5', goto: 0 },
];

/** loadArenaBattleInitData reply → `[base, ownRecords, winRecords, rankList, battleHeroes]`. */
export interface ArenaInit {
  base: ArenaBase | null;
  ownRecords: Row[];
  winRecords: Row[];
  rankList: Row[];
  battleHeroes: Row[];
}

export function parseArenaInit(data: unknown): ArenaInit {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return {
    base: parseArenaBase(d.shift()),
    ownRecords: rows(d.shift()),
    winRecords: rows(d.shift()),
    rankList: rows(d.shift()),
    battleHeroes: rows(d.shift()),
  };
}

// ---- AssembleHeroPanel: the 3-slot hero config ----

/** The 六行 hero base info of startArenaChallenge (holdBattleHeroBaseInfo). */
export function parseBattleHeroInfos(data: unknown): Row[] {
  return rows(data);
}

// ---- RankRewardDialog ----

/** cfg_activity_rank_reward row parsed to its display name (doDealWithRewardGoods). */
export interface ArenaRewardConf {
  minrank: number;
  maxrank: number;
  reward: string;
}

export function parseRewardConfs(list: unknown): ArenaRewardConf[] {
  return rows(list).map((r) => ({
    minrank: int(r.minrank),
    maxrank: int(r.maxrank),
    reward: String(r.reward ?? ''),
  }));
}

/** The top-3 rows of log_assemble_reward (doDealWithBefore3). */
export function parseRankTop3(list: unknown): Row[] {
  return rows(list);
}

/** getArenaRankRewardInfo reply `[top3, confs, userRank]`. */
export function parseRankRewardInfo(data: unknown): {
  top3: Row[];
  confs: ArenaRewardConf[];
  userRank: Row | null;
} {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return {
    top3: rows(d.shift()),
    confs: rows(d.shift()).map((r) => ({
      minrank: int(r.minrank),
      maxrank: int(r.maxrank),
      reward: String(r.reward ?? ''),
    })),
    userRank: row(d.shift()),
  };
}

/** gotoSelectedRank reply `[userBase, rankList]` (AS3:1140). */
export function parseGotoRank(data: unknown): { base: Row | null; list: Row[] } {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  return { base: row(d.shift()), list: rows(d.shift()) };
}
