import { describe, expect, it } from 'vitest';
import {
  kingName,
  npcPosOf,
  npcPosText,
  ownBattleHtml,
  parseArenaBase,
  parseArenaInit,
  parseGotoRank,
  parseRankList,
  parseRankRewardInfo,
  rewardTip,
  rowColor,
  winRecordHtml,
  ymdhms,
} from './arena';

const id = (k: string) => k;

describe('kingName', () => {
  it('colors a name by the king tier', () => {
    expect(kingName(1, 'a')).toBe("<font color='#ffffff'>a</font>");
    expect(kingName(4, 'a')).toBe("<font color='#33a800'>a</font>");
    expect(kingName(6, 'a')).toBe("<font color='#9933FF'>a</font>");
    expect(kingName(11, 'a')).toBe("<font color='#FFCC00'>a</font>");
  });
});

describe('ymdhms', () => {
  it('formats a unix timestamp as 20yy年MM月dd日 hh:mm:ss in the local clock', () => {
    const text = ymdhms(new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000);
    expect(text).toMatch(/^2026年01月02日 03:04:05$/);
  });
});

describe('parseArenaBase', () => {
  it('derives countStr and clamps the leaving time', () => {
    expect(parseArenaBase({ rank: 5, count: 9, maxrank: 3, maxwin: 7, leavingtime: -4 })).toEqual({
      rank: 5,
      count: 9,
      countStr: '9次',
      maxrank: 3,
      maxwin: 7,
      leavingtime: 0,
    });
    expect(parseArenaBase(false)).toBeNull();
  });
});

describe('ownBattleHtml', () => {
  it('renders an attack record with the rank change', () => {
    const html = ownBattleHtml(
      [
        {
          time: 1767225600,
          fromuid: 1001,
          fromKingLevel: 3,
          toKingLevel: 2,
          toname: 'bob',
          flag: 1,
          ischange: 1,
          attackrank: 4,
          rewardid: 101,
          rewardname: '礼包',
          rewardcount: 1,
        },
      ],
      1001,
      id,
    );
    expect(html).toContain("align='left'");
    expect(html).toContain('Arena_Battle_1_1');
    expect(html).toContain("<font color='#F7E970'>4</font>");
    expect(html).toContain('Arena_Battle_1_2');
  });

  it('renders a defence record from the other side', () => {
    const html = ownBattleHtml(
      [{ fromuid: 2002, fromKingLevel: 1, toKingLevel: 3, toname: 'me', flag: 0, ischange: 0 }],
      1001,
      id,
    );
    expect(html).toContain('Arena_Battle_1_6');
  });
});

describe('winRecordHtml', () => {
  it('joins the streak announcements', () => {
    const html = winRecordHtml(
      [{ fromKingLevel: 1, fromnameWin: 'a', toKingLevel: 2, tonameWin: 'b', times: 5 }],
      id,
    );
    expect(html).toContain('Arena_Battle_1_9');
    expect(html).toContain("<font color='#F7E970'>5</font>");
  });
});

describe('parseRankList', () => {
  it('flags the own row and formats the left time', () => {
    const list = parseRankList(
      [
        [
          { userid: 1001, getRewardTime: 0 },
          { userid: 5, getRewardTime: 30 },
        ],
      ],
      1001,
    );
    expect(list[0]!.butRewardIsShow).toBe(true);
    expect(list[0]!.butChallengeIsShow).toBe(false);
    expect(list[0]!.lefttimeStr).toBe('--');
    expect(list[1]!.butChallengeIsShow).toBe(true);
    expect(list[1]!.lefttimeStr).toBe('30');
  });
});

describe('npcPosOf / npcPosText', () => {
  it('reads the NPC head rank and substitutes it', () => {
    expect(npcPosOf([6, {}])).toBe(6);
    expect(npcPosOf([])).toBe(0);
    expect(npcPosText(6, id)).toBe('Arena_Battle_7_8');
    expect(npcPosText(0, id)).toBe('');
  });
});

describe('rewardTip', () => {
  it('differs for the occupier, NPCs and other players', () => {
    const own = {
      userid: 1001,
      lefttimeInt: 0,
      lefttimeStr: '--',
      rewardname: 'r',
      canGetRewardCount: '2',
    };
    expect(rewardTip(own as never, 1001, id)).toBe('Arena_Battle_reward_1_13r*2');
    const cooling = { ...own, lefttimeInt: 10, lefttimeStr: '10' };
    expect(rewardTip(cooling as never, 1001, id)).toBe(
      'Arena_Battle_reward_2_110Arena_Battle_reward_2_2r】*2',
    );
    const npc = { ...cooling, userid: 5 };
    // NPC rows (userid < 1000) always read the plain reward line, cooling or not.
    expect(rewardTip(npc as never, 1001, id)).toBe('Arena_Battle_reward_1_13r*2');
    const other = { ...cooling, userid: 2002, lefttimeInt: 0 };
    expect(rewardTip(other as never, 1001, id)).toBe('Arena_Battle_reward_2_3');
  });
});

describe('rowColor', () => {
  it('paints own rows yellow and NPC rows grey', () => {
    expect(rowColor(1001, 1001)).toBe(16776960);
    expect(rowColor(5, 1001)).toBe(11309055);
    expect(rowColor(2002, 1001)).toBe(16777215);
  });
});

describe('parseArenaInit', () => {
  it('splits the five-part init reply', () => {
    const init = parseArenaInit([
      { rank: 1, count: 2, maxrank: 1, maxwin: 0, leavingtime: 5 },
      [],
      [],
      [4],
      [{ hid: 9 }],
    ]);
    expect(init.base!.rank).toBe(1);
    expect(init.rankList).toHaveLength(0);
    expect(init.battleHeroes).toEqual([{ hid: 9 }]);
  });
});

describe('parseRankRewardInfo', () => {
  it('reads top3, confs and the own rank row', () => {
    const info = parseRankRewardInfo([
      [{ rank: 1 }],
      [{ minrank: 1, maxrank: 1, reward: '100,0,101,1' }],
      { rank: 4 },
    ]);
    expect(info.top3).toEqual([{ rank: 1 }]);
    expect(info.confs[0]!.minrank).toBe(1);
    expect(info.userRank!.rank).toBe(4);
  });
});

describe('parseGotoRank', () => {
  it('splits the base and the list', () => {
    const parsed = parseGotoRank([{ rank: 9, maxrank: 9 }, [{ userid: 1 }]]);
    expect(parsed.base!.rank).toBe(9);
    expect(parsed.list).toHaveLength(1);
  });
});
