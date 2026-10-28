import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { parseStatsReply, sortHeroStats, statHeroSorts, statTabs } from './stat';

setStrings({
  Stat_StatDialog_2_1: '城池',
  Stat_StatDialog_3_1: '资源',
  Stat_StatDialog_4_1: '产量',
  Stat_StatDialog_5_1: '将领',
  Stat_StatDialog_6_1: '军队',
  Stat_StatDialog_7_1: '城防',
  Stat_StatDialog_9_1: '城池',
  Stat_StatDialog_10_1: '坐标',
  Stat_StatDialog_11_1: '人口',
  Stat_StatDialog_48_1: '城池',
  Stat_StatDialog_49_1: '坐标',
  Stat_StatDialog_50_1: '民夫',
  Stat_StatDialog_61_1: '投石',
  Stat_StatDialog_61_2: '西凉铁骑',
  Stat_StatDialog_61_7: '藤甲兵',
  Stat_StatDialog_72: '城池',
  Stat_StatDialog_73: '等级',
  Stat_StatDialog_74: '统率',
  Stat_StatDialog_75: '内政',
  Stat_StatDialog_76: '勇武',
  Stat_StatDialog_77: '智谋',
  Stat_StatDialog_78: '忠诚',
});

describe('stat tabs', () => {
  it('defines the six tabs in getStats order', () => {
    const tabs = statTabs();
    expect(tabs.map((t) => t.key)).toEqual([
      'city',
      'resource',
      'product',
      'hero',
      'army',
      'defence',
    ]);
    expect(tabs.map((t) => t.columns.length)).toEqual([10, 7, 7, 10, 20, 9]);
  });

  it('names the special-cased army columns', () => {
    const army = statTabs().find((t) => t.key === 'army')!.columns;
    expect(army[2]).toEqual({ header: '民夫', field: 'minfuCount', width: 60 });
    expect(army[13]).toMatchObject({ header: '投石', field: 'toushiCount' });
    expect(army[14]).toMatchObject({ header: '西凉铁骑', field: 'bing45Count' });
    expect(army[19]).toMatchObject({ header: '藤甲兵', field: 'bing50Count' });
  });

  it('lists the hero sort combo entries', () => {
    expect(statHeroSorts().map((s) => s.label)).toEqual([
      '城池',
      '等级',
      '统率',
      '内政',
      '勇武',
      '智谋',
      '忠诚',
    ]);
  });
});

describe('parseStatsReply', () => {
  it('skips the leading empty array and takes the tag', () => {
    const reply = parseStatsReply([
      [],
      3,
      { name: 'a', herotype: 1 },
      { name: '君主', herotype: 1000 },
    ]);
    expect(reply.tag).toBe(3);
    expect(reply.rows).toEqual([
      { name: 'a', herotype: 1 },
      { name: '君主', herotype: 1000, loyalty: '--' },
    ]);
  });
});

describe('sortHeroStats', () => {
  const rows = [
    { name: 'a', level: '10', command: '30' },
    { name: 'b', level: '12', command: '20' },
    { name: 'c', level: '11', command: '30' },
  ];

  it('sorts descending by the chosen key (insertion like compareXxxAdd)', () => {
    expect(sortHeroStats(rows, 1).map((r) => r.name)).toEqual(['b', 'c', 'a']);
    // 统率 30/30 keep their relative order, 20 last
    expect(sortHeroStats(rows, 2).map((r) => r.name)).toEqual(['a', 'c', 'b']);
  });

  it('keeps the order for the 城池 sort (parseInt of "(x,y)" is NaN)', () => {
    const cityRows = [
      { name: 'a', cid: '(2,310)' },
      { name: 'b', cid: '(5,200)' },
    ];
    expect(sortHeroStats(cityRows, 0).map((r) => r.name)).toEqual(['a', 'b']);
  });
});
