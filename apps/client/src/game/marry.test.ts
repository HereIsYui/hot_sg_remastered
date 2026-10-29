import { describe, expect, it } from 'vitest';
import {
  exprLeftTime,
  favorGiftGid,
  favorStage,
  parseAddFavor,
  parseChildCulture,
  parseGirlfriends,
  parseKingExpr,
  parseMarryChild,
  parseMarryInfo,
  parseMadams,
  parseProposeReply,
  proposeBattleHeroes,
} from './marry';

describe('favorStage / favorGiftGid', () => {
  it('splits the four favour tiers', () => {
    expect(favorStage(0)).toBe(0);
    expect(favorStage(19)).toBe(0);
    expect(favorStage(20)).toBe(1);
    expect(favorStage(49)).toBe(1);
    expect(favorStage(50)).toBe(2);
    expect(favorStage(80)).toBe(3);
  });
  it('picks the next gift gid per tier, 100 clamps to 99', () => {
    expect(favorGiftGid(0)).toBe(12066);
    expect(favorGiftGid(25)).toBe(12067);
    expect(favorGiftGid(60)).toBe(12068);
    expect(favorGiftGid(90)).toBe(12069);
    expect(favorGiftGid(100)).toBe(12069);
  });
});

describe('parseGirlfriends', () => {
  it('pages 9 per page and derives the propose cooldown', () => {
    const girls = Array.from({ length: 10 }, (_, i) => ({
      hid: i,
      name: `g${i}`,
      sex: 0,
      face: 1,
      favor: 30,
      proposeCoolTime: 1000,
      nowtime: 400,
      command: 1,
      affairs: 2,
      bravery: 3,
      wisdom: 4,
    }));
    const parsed = parseGirlfriends(girls);
    expect(parsed.totalPage).toBe(2);
    expect(parsed.girlfriends[0]!.proposeLeftTime).toBe(600);
    expect(parsed.girlfriends[0]!.heroImage).toBe('images/hero/hero_girl_1.jpg');
    expect(parsed.girlfriends[0]!.attribute).toEqual(['1', '2', '3', '4']);
  });
});

describe('parseMarryInfo / parseKingExpr', () => {
  it('splits the loadMarryInfo reply', () => {
    const info = parseMarryInfo([{ state: 0 }, [{ hid: 5 }]]);
    expect(info.kingExpr!.state).toBe(0);
    expect(info.girlfriends).toHaveLength(1);
  });
  it('reads the king expr row and its remaining time', () => {
    expect(parseKingExpr([{ endtime: 2000, nowtime: 1500 }])).toEqual({
      endtime: 2000,
      nowtime: 1500,
    });
    expect(exprLeftTime({ endtime: 2000, nowtime: 1500 })).toBe(500);
    expect(exprLeftTime(null)).toBe(0);
  });
});

describe('parseMadams', () => {
  it('normalizes the madam rows', () => {
    const madams = parseMadams([
      {
        hid: 7,
        name: '貂蝉',
        sex: 0,
        face: 2,
        favor: 55,
        state: 2,
        roomIsEnough: 1,
        leaveCoolTime: -5,
        nextGidName: '胭脂',
        nextGidCount: 3,
      },
    ]);
    expect(madams[0]!.heroImage).toBe('images/hero/hero_girl_2.jpg');
    expect(madams[0]!.favor).toBe(55);
    expect(madams[0]!.roomIsEnough).toBe(true);
    expect(madams[0]!.leaveCoolTime).toBe(0);
    expect(madams[0]!.nextGidName).toBe('胭脂');
  });
});

describe('parseMarryChild', () => {
  it('splits room count and children', () => {
    const parsed = parseMarryChild([3, [{ hid: 1, sex: '1', roomindex: '2', culture: 5 }]]);
    expect(parsed.roomCount).toBe(3);
    expect(parsed.children[0]!.sex).toBe(1);
    expect(parsed.children[0]!.roomindex).toBe(2);
  });
});

describe('parseProposeReply', () => {
  it('parses the guard-NPC battle variant', () => {
    const reply = parseProposeReply([
      0,
      2,
      [{ hid: 1 }, { hid: 2 }],
      { report: [], totalNum: 3, winer: 1 },
    ]);
    expect(reply!.kind).toBe(0);
    if (reply!.kind === 0) {
      expect(reply!.giftType).toBe(2);
      expect(reply!.heroes).toHaveLength(2);
      expect(reply!.battle!.winer).toBe(1);
    }
  });
  it('parses the no-NPC variant', () => {
    const reply = parseProposeReply([1, '貂蝉']);
    expect(reply).toEqual({ kind: 1, name: '貂蝉' });
    expect(parseProposeReply([])).toBeNull();
  });
  it('splits the battle heroes', () => {
    const { king, npc } = proposeBattleHeroes([{ hid: 1 }, { hid: 2 }]);
    expect(king!.hid).toBe(1);
    expect(npc!.hid).toBe(2);
  });
});

describe('parseAddFavor / parseChildCulture', () => {
  it('reads the favour update and culture row', () => {
    expect(parseAddFavor(['成功', { favor: 66 }])).toEqual({ message: '成功', favor: 66 });
    expect(parseChildCulture([{ hid: 1, culture: 2 }])).toEqual({ hid: 1, culture: 2 });
  });
});
