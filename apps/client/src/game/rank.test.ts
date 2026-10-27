import { describe, expect, it } from 'vitest';
import {
  activityRankColumns,
  parseRankConfig,
  parseRankReply,
  parseRankReward,
  rankCellColor,
  rankColumns,
  rankPageLabel,
  rankPanel,
  rankType,
  rankUpdateTime,
} from './rank';

describe('rank helpers', () => {
  it('maps every panel sort to the original rank table type', () => {
    expect(rankType('king')).toBe('KingRankTotal');
    expect(rankType('hero', 4)).toBe('hero_command');
    expect(rankType('military', 2)).toBe('military_defence');
    expect(rankType('rich', 1)).toBe('rich_month');
    expect(rankType('battle', 2)).toBe('battle_day');
    expect(rankType('hero', 99)).toBe('hero_level');
  });

  it('parses page replies and empty or malformed data', () => {
    expect(parseRankReply([100, 3, 1, 'user', [{ rank: 11 }]])).toEqual({
      updateTime: 100,
      pageCount: 3,
      page: 1,
      type: 'user',
      rows: [{ rank: 11 }],
    });
    expect(parseRankReply(null).rows).toEqual([]);
    expect(rankPageLabel({ page: 1, pageCount: 3 })).toBe('2/3');
    expect(rankPageLabel({ page: 0, pageCount: 0 })).toBe('0/0');
  });

  it('highlights only the requested name or rank across all columns', () => {
    expect(rankCellColor({ rank: 12, name: '长乐' }, { kind: 'rank', value: 12 })).toBe(0xffff00);
    expect(rankCellColor({ rank: 12, name: '长乐' }, { kind: 'name', value: '长乐' })).toBe(
      0xffff00,
    );
    expect(rankCellColor({ rank: 12, name: '长乐' }, { kind: 'name', value: '其他' })).toBe(
      0xffffff,
    );
    expect(rankColumns(rankPanel('user'), { kind: null, value: '' })[0]?.color?.({ rank: 1 })).toBe(
      0xffffff,
    );
  });

  it('formats the rank rebuild time like Utils.MakeTime', () => {
    const units: Record<string, string> = {
      _Utils_1: '年',
      _Utils_2: '月',
      _Utils_3: '日 ',
      _Utils_5: '时',
      _Utils_6: '分',
      _Utils_7: '秒',
    };
    const time = new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000;
    expect(rankUpdateTime(time, (key) => units[key] ?? key)).toBe('26年01月02日 03时04分05秒');
  });

  it('maps activity sorts and dynamic titles', () => {
    expect(rankType('activity', 0)).toBe('activity');
    expect(rankType('activity', 1)).toBe('activity_today');
    expect(rankType('activity', 2)).toBe('activity_yesterday');
    expect(activityRankColumns('积分,声望,荣誉').map((column) => column.header)).toEqual([
      '排名',
      '君主',
      '积分',
      '声望',
      '荣誉',
    ]);
  });

  it('parses activity and king reward configuration', () => {
    expect(parseRankConfig([{ title: '活动', desc: '说明' }, 1])).toEqual({
      activity: { title: '活动', desc: '说明' },
      enabled: true,
    });
    expect(parseRankConfig([1])).toEqual({ activity: null, enabled: true });
    expect(parseRankConfig([])).toEqual({ activity: null, enabled: false });
  });

  it('separates reward items from failure messages', () => {
    expect(parseRankReward([1, [{ name: '传音符' }]])).toEqual({
      ok: true,
      message: '',
      items: [{ name: '传音符' }],
    });
    expect(parseRankReward([0, '已经领取'])).toEqual({
      ok: false,
      message: '已经领取',
      items: [],
    });
  });
});
