import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { parseTechnicInfo, technicTip } from './technics';

const city = { people_all: 0, food: 600, wood: 0, rock: 0, iron: 0, gold: 900 };

const reply = [
  [
    {
      _explicitType: 'TechnicState',
      tid: 1,
      tname: '农耕技术',
      description: 'd',
      levelDescription: null,
      nextLevelDescription: 'next',
      level: 0,
      sharelevel: 0,
      cid: null,
      state: 0,
      state_endtime: 0,
      state_timeleft: -1402464328,
      can_upgrade: false,
      woodNeed: 0,
      rockNeed: 0,
      ironNeed: 0,
      foodNeed: 500,
      goldNeed: 1000,
      upgrade_time: 640,
      conditions: [
        { type: '前提建筑', upgradeNeed: '书院(等级1)', currentOwn: '等级15', canUpgrade: true },
      ],
    },
    { tid: '24', tname: '研究技巧', level: '10', cid: '209355', state: '1', conditions: null },
  ],
  '2',
];

beforeAll(() => {
  setStrings({
    _Utils_4: '0秒',
    _Utils_5: '小时',
    _Utils_6: '分',
    _Utils_7: '秒',
    College_CollegeTechnicItemSrc_8: '升级到: ',
    College_CollegeTechnicItemSrc_9: '(等级',
    College_CollegeTechnicItemSrc_14: '消耗粮食',
    College_CollegeTechnicItemSrc_18: '消耗黄金',
  });
});

describe('technics', () => {
  it('parses the 书院 extra with PHP nulls and numeric strings', () => {
    const info = parseTechnicInfo(reply)!;
    expect(info.collegeCount).toBe(2);
    expect(info.technics[0]).toMatchObject({ tid: 1, cid: 0, levelDescription: '', foodNeed: 500 });
    expect(info.technics[1]).toMatchObject({ tid: 24, level: 10, cid: 209355, state: 1 });
    expect(info.technics[1]!.conditions).toEqual([]);
    expect(parseTechnicInfo('无此在建的科技的信息')).toBeNull();
  });

  it('lists the conditions, then food and gold against the city', () => {
    const [first, top] = parseTechnicInfo(reply)!.technics;
    const tip = technicTip(first!, city)!;
    expect(tip.title).toBe('升级到: 农耕技术(等级1)');
    expect(tip.time).toBe('10分40秒');
    expect(tip.rows.map((r) => [r.type, r.need, r.current, r.ok])).toEqual([
      ['前提建筑', '书院(等级1)', '等级15', true],
      ['消耗粮食', '500', '600', true],
      ['消耗黄金', '1000', '900', false],
    ]);
    expect(technicTip(top!, city)).toBeNull();
  });
});
