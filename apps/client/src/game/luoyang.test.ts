import { describe, expect, it } from 'vitest';
import {
  battleIntro,
  canPassNextCid,
  isLegalTarget,
  isSpecialCid,
  luoyangTroopStartArgs,
  luoyangYear,
  parseAllocate,
  parseBelongInfo,
  parseChangeCity,
  parseCityTroops,
  parseLYBattleData,
  parseLuoyangCities,
  parseLuoyangEvents,
  parseRankPoints,
  parseUserInfoPoint,
  troopHeroImage,
} from './luoyang';

const id = (k: string) => k;

describe('parseLuoyangCities', () => {
  it('maps rows onto slots by the image column and splits nextcid', () => {
    const cities = parseLuoyangCities([
      { cid: 3, image: 2, nextcid: '1,2' },
      { cid: 1, image: 0, nextcid: '2,3' },
    ]);
    expect(cities[0]!.slot).toBe(2);
    expect(cities[0]!.nextList).toEqual([1, 2]);
    expect(cities[1]!.slot).toBe(0);
  });
});

describe('canPassNextCid / isLegalTarget', () => {
  const cities = parseLuoyangCities([{ cid: 1, image: 0, nextcid: '2,3' }]);
  it('lists the reachable cids of a city', () => {
    expect(canPassNextCid(cities, 1)).toEqual([2, 3]);
    expect(canPassNextCid(cities, 9)).toEqual([]);
  });
  it('validates a march target like doTestLegalCid', () => {
    expect(isLegalTarget(cities, 1, 2)).toBe(true);
    expect(isLegalTarget(cities, 1, 5)).toBe(false);
  });
});

describe('isSpecialCid', () => {
  it('marks the five must-pass cities', () => {
    expect([1, 2, 4, 5, 7].every(isSpecialCid)).toBe(true);
    expect(isSpecialCid(3)).toBe(false);
  });
});

describe('parseLYBattleData', () => {
  it('parses the four-part reply and troop rows', () => {
    const data = parseLYBattleData([
      [{ cid: 1, image: 0, nextcid: '2' }],
      3600,
      1,
      [{ hid: 5, cid: 0, level: 3, state: 0, leavingTime: -2, heroname: '关羽' }],
    ]);
    expect(data.cities).toHaveLength(1);
    expect(data.leavingTime).toBe(3600);
    expect(data.isOpenSecond).toBe(1);
    expect(data.userTroops[0]!.leavingTime).toBe(0);
    expect(data.userTroops[0]!.heroname).toBe('关羽');
  });
});

describe('troopHeroImage', () => {
  it('uses the player portrait for the lord hero', () => {
    expect(troopHeroImage({ herotype: 1000, sex: 1, face: 2 }, 0, 3)).toBe(
      'images/player/player_girl_4.jpg',
    );
    expect(troopHeroImage({ herotype: 1, sex: 0, face: 7 }, 1, 3)).toBe(
      'images/herox/hero_girl_7.jpg',
    );
  });
});

describe('luoyangTroopStartArgs', () => {
  it('packs [hid, cid, unionid, soldiers, useFlag]', () => {
    expect(luoyangTroopStartArgs(9, 215265, 3, '1,2', true)).toEqual([9, 215265, 3, '1,2', true]);
  });
});

describe('parseCityTroops / parseChangeCity', () => {
  it('splits the troop list and change reply', () => {
    expect(parseCityTroops([[{ hid: 1 }]])).toEqual([{ hid: 1 }]);
    const change = parseChangeCity([{ hid: 2, cid: 1 }, '成功']);
    expect(change.troop!.hid).toBe(2);
    expect(change.message).toBe('成功');
  });
});

describe('luoyangYear', () => {
  it('picks the era name by the year count', () => {
    expect(luoyangYear(1, id)).toBe('LuoYang_Battle_1_2');
    expect(luoyangYear(20, id)).toBe('LuoYang_Battle_1_21');
    expect(luoyangYear(21, id)).toBe('LuoYang_Battle_1_1');
  });
});

describe('parseBelongInfo', () => {
  it('fills the owner lines only for a real owner with a year sign', () => {
    const empty = parseBelongInfo([null, {}, true], id);
    expect(empty.yearName).toBe('Report_Announcement_12_1');
    const owned = parseBelongInfo(
      [
        { uid: 1001, userName: 'changle', unionName: '盟', yearCount: 3 },
        { winCondition: 'w' },
        true,
      ],
      id,
    );
    expect(owned.yearName).toBe('changleLuoYang_Battle_1_4_Utils_1');
    expect(owned.unionName).toBe('盟');
    expect(owned.isCanSend).toBe(true);
  });
});

describe('battleIntro', () => {
  it('joins the five tips with the win/lose conditions', () => {
    const text = battleIntro({ winCondition: 'win', loseCondition: 'lose' }, id);
    expect(text).toContain('LuoYang_Belong_tip_1');
    expect(text).toContain('win');
    expect(text).toContain('LuoYang_Belong_tip_6');
    expect(text).toContain('lose');
  });
});

describe('parseLuoyangEvents / parseRankPoints / parseUserInfoPoint / parseAllocate', () => {
  it('parses the belong-panel replies', () => {
    expect(parseLuoyangEvents([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(parseRankPoints([[{ unionid: 1 }]])).toEqual([{ unionid: 1 }]);
    const point = parseUserInfoPoint([100, [{ tid: 1 }]]);
    expect(point.score).toBe('100');
    expect(point.rows).toEqual([{ tid: 1 }]);
    expect(parseAllocate(['分配成功'])).toBe('分配成功');
  });
});
