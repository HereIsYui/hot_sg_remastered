import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { parseBattleHonourStat } from './battleHonour';

setStrings({
  Battle_BattleHonourStatList_4_1: '阵营',
  Battle_BattleHonourStatList_5_1: '阵营所有玩家平均战斗荣誉',
});

describe('getBattleHonourStat reply', () => {
  it('builds one list per camp with the contribution rows', () => {
    const lists = parseBattleHonourStat([
      { '7': { name: '汉室', avgHonour: 100 }, '8': { name: '董卓', avgHonour: 50 } },
      {
        '7': [
          { name: '甲', honour: 200, contribute: 20 },
          { name: '乙', honour: 50, contribute: 5 },
        ],
        '8': [{ name: '丙', honour: 25, contribute: 5 }],
      },
    ]);
    expect(lists).toEqual([
      {
        unionid: '7',
        title: '汉室阵营',
        avgHonourDesc: '汉室阵营所有玩家平均战斗荣誉100',
        users: [
          { name: '甲', honour: 200, contribute: 20 },
          { name: '乙', honour: 50, contribute: 5 },
        ],
      },
      {
        unionid: '8',
        title: '董卓阵营',
        avgHonourDesc: '董卓阵营所有玩家平均战斗荣誉50',
        users: [{ name: '丙', honour: 25, contribute: 5 }],
      },
    ]);
  });

  it('keeps a camp without an average row as zeroes', () => {
    const lists = parseBattleHonourStat([
      { '9': { name: '袁绍' } },
      { '9': [{ name: '丁', honour: 1, contribute: 0 }] },
    ]);
    expect(lists[0]?.avgHonourDesc).toBe('袁绍阵营所有玩家平均战斗荣誉0');
  });
});
