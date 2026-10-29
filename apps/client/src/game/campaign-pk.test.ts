import { describe, expect, it } from 'vitest';
import {
  battleChapters,
  battleDesc,
  calcHeroAttr,
  dropGoodOf,
  enterCondition,
  heroesByChapter,
  maxLevelOf,
  packPassId,
  parseAllHeroByUid,
  parseBuyJunling,
  parseCampaignInit,
  parseCampaignMax,
  parsePkBattle,
  parsePkRewardRank,
  pickerHero,
  showState,
} from './campaign-pk';

const heroRow = {
  battleid: 1,
  levelid: 2,
  flag: 0,
  area: 1,
  hid: 11,
  face: 3,
  sex: 0,
  energy: 100,
  energy_add: 5,
  command_base: 10,
  command_add: 2,
  bravery_base: 20,
  bravery_add: 3,
  wisdom_base: 15,
  wisdom_add: 1,
  speed_base: 8,
  speed_add: 1,
  name: '黄巾贼',
};

describe('battleChapters', () => {
  it('lists the 10 chapters with their serial image and floors', () => {
    const chapters = battleChapters((id) => `chapter ${id}`);
    expect(chapters).toHaveLength(10);
    expect(chapters[0]).toEqual({
      label: 'chapter 1',
      image: 'images/battle_serial_1.png',
      data: 1,
      floorCount: 10,
    });
    expect(chapters[9]!.data).toBe(10);
  });
});

describe('calcHeroAttr', () => {
  it('derives the display stats and portrait of an NPC row', () => {
    const hero = calcHeroAttr(heroRow);
    expect(hero.heroImage).toBe('images/hero/hero_girl_3.jpg');
    expect(hero.attack).toBe(230); // (20+3)*10
    expect(hero.defence).toBe(160); // (15+1)*10
    expect(hero.force).toBe(105); // 100+5
    expect(hero.speed).toBe(9); // 8+1
    expect(hero.blood).toBe(5250); // 105*50
  });
});

describe('showState', () => {
  it('marks passed/current/locked floors like getInitData', () => {
    expect(showState(1, 1, 1, 3)).toBe(1);
    expect(showState(1, 3, 1, 3)).toBe(0);
    expect(showState(1, 4, 1, 3)).toBe(-1);
    expect(showState(2, 1, 1, 3)).toBe(-1);
    expect(showState(2, 1, 2, 1)).toBe(0);
  });
});

describe('parseCampaignInit', () => {
  it('reads the six-part reply', () => {
    const init = parseCampaignInit([
      { normal: 103, special: 1 },
      [heroRow],
      [],
      [{ battleid: 1, flag: 0, goods: { gid: 18010 } }],
      { junling: 9, wuzhuqian: 4 },
      [{ id: 1, description: 'desc' }],
    ]);
    expect(init.normal).toBe(103);
    expect(init.special).toBe(1);
    expect(init.common).toHaveLength(1);
    expect(init.common[0]!.attack).toBe(230);
    expect(init.rewards[0]!.goods).toEqual({ gid: 18010 });
    expect(init.junling).toBe(9);
    expect(init.wuzhuqian).toBe(4);
    expect(init.descs[0]).toEqual({ id: 1, description: 'desc' });
  });

  it('falls back to chapter 1 floor 1 for a missing level row', () => {
    const init = parseCampaignInit([false, [], [], [], {}, []]);
    expect(init.normal).toBe(1);
    expect(init.special).toBe(1);
    expect(init.junling).toBe(0);
  });
});

describe('maxLevelOf / packPassId', () => {
  it('finds a chapter max floor and packs the pass id', () => {
    const heroes = [calcHeroAttr(heroRow), calcHeroAttr({ ...heroRow, levelid: 5, flag: 1 })];
    expect(maxLevelOf(heroes, 1, 0)).toBe(2);
    expect(maxLevelOf(heroes, 1, 1)).toBe(5);
    expect(packPassId(3, 7)).toBe(307);
  });
});

describe('parseCampaignMax / parseBuyJunling', () => {
  it('parses regetCampaignMaxData and buyJunlingFunc replies', () => {
    expect(parseCampaignMax([{ normal: 201, special: 101 }, 12, 3])).toEqual({
      normal: 201,
      special: 101,
      junling: 12,
      wuzhuqian: 3,
    });
    expect(parseBuyJunling([0, 5, 990])).toEqual({ type: 0, count: 5, money: 990 });
  });
});

describe('dropGoodOf / battleDesc', () => {
  const rewards = [{ battleid: 2, flag: 1, goods: { gid: 18021 } }];
  it('looks the drop up by chapter and difficulty', () => {
    expect(dropGoodOf(rewards as never, 2, 1)).toEqual({ gid: 18021 });
    expect(dropGoodOf(rewards as never, 2, 0)).toBeNull();
  });
  it('finds a chapter description', () => {
    expect(battleDesc([{ id: 2, description: 'x' }], 2)).toBe('x');
    expect(battleDesc([{ id: 2, description: 'x' }], 3)).toBe('');
  });
});

describe('enterCondition', () => {
  it('builds the tooltip with the two level lines', () => {
    const text = enterCondition('黄巾之乱', 10, 5, 3, (k) => k);
    expect(text).toContain('黄巾之乱');
    expect(text).toContain('Hero_Battle_Dialog_battle_tip_instr_15');
    expect(text).toContain('Hero_Battle_Dialog_battle_tip_instr_23');
  });
});

describe('heroesByChapter', () => {
  it('buckets rows by chapter', () => {
    const heroes = [calcHeroAttr(heroRow), calcHeroAttr({ ...heroRow, battleid: 2 })];
    const map = heroesByChapter(heroes);
    expect(map.get(1)).toHaveLength(1);
    expect(map.get(2)).toHaveLength(1);
  });
});

describe('parseAllHeroByUid', () => {
  it('keeps the king hero of page 1 separate', () => {
    const parsed = parseAllHeroByUid([
      [{ ...heroRow, hid: 5, heroBravery: 99 }],
      1,
      { ...heroRow, hid: 6, herotype: 1000 },
    ]);
    expect(parsed.page).toBe(1);
    expect(parsed.list[0]!.hid).toBe(5);
    expect(parsed.king?.isKing).toBe(true);
  });

  it('has no king hero on later pages', () => {
    const parsed = parseAllHeroByUid([[], 2]);
    expect(parsed.king).toBeNull();
  });
});

describe('pickerHero', () => {
  it('uses the add_on columns for the display stats', () => {
    const hero = pickerHero({
      ...heroRow,
      bravery_add_on: 4,
      wisdom_add_on: 2,
      speed_add_on: 10,
      heroBravery: 27,
    });
    expect(hero.attack).toBe(270); // (20+3+4)*10
    expect(hero.defence).toBe(180);
    expect(hero.speed).toBe(19); // 8+1+10
    expect(hero.isKing).toBe(false);
  });
});

describe('parsePkBattle', () => {
  it('parses the report rounds and the reward', () => {
    const battle = parsePkBattle([
      {
        report: [[{ attackhid: 1, resisthid: 2, damage: 10, blood: 90, flag: 0, battleId: 1 }]],
        totalNum: 1,
        winer: 1,
        reward: [{ flag: 0, info: { gid: 18010 }, count: 1 }],
      },
    ]);
    expect(battle!.totalNum).toBe(1);
    expect(battle!.winer).toBe(1);
    expect(battle!.report[0]![0]!.damage).toBe(10);
    expect(battle!.reward).toHaveLength(1);
  });

  it('returns null without a battle row (the no-report case)', () => {
    expect(parsePkBattle([[]])).toBeNull();
    expect(parsePkBattle(null)).toBeNull();
  });
});

describe('parsePkRewardRank', () => {
  it('parses the first-pass top three rows', () => {
    const ranks = parsePkRewardRank([
      [
        {
          rankid: 1,
          uid: 1001,
          userName: 'changle',
          formatTime: '2026-01-01 00:00:00',
          rewardType: 0,
          rewardGood: { gid: 18010 },
          rewardCount: 1,
        },
      ],
    ]);
    expect(ranks[0]!.userName).toBe('changle');
    expect(ranks[0]!.rewardGood).toEqual({ gid: 18010 });
  });
});
