import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  achieveGroupNames,
  achieveItemView,
  groupQueryArgs,
  parseAchiveDetail,
  parseAchiveRankReply,
  parseAchivementsByGroup,
  parseOverviewStat,
} from './achivement';

setStrings({
  Achivement_UserAchivement_19: '总览',
  Achivement_UserAchivement_6: '综合',
  Achivement_UserAchivement_7: '任务',
  Achivement_UserAchivement_8: '排行',
  Achivement_UserAchivement_9: '活动',
  Achivement_UserAchivement_12: '剧情战场',
  Achivement_UserAchivement_11: '据点战场',
  Achivement_UserAchivement_10: '名城名将',
  Achivement_UserAchivement_22: '跨服战场',
  Achivement_UserAchivement_23: '赤壁战场',
  Achivement_Other_1: '点数：',
  _Utils_1: '年',
  _Utils_2: '月',
  _Utils_3: '日',
  _Utils_5: '时',
  _Utils_6: '分',
  _Utils_7: '秒',
});

describe('parseOverviewStat', () => {
  const reply = [
    120,
    [
      {
        id: 5,
        name: '首战告捷',
        content: '打赢第一仗',
        point: 10,
        achieveGetTime: 1700000000,
        image: 0,
      },
    ],
    [
      { group: 1, group_name: '综合', total_count: 40, finish_count: 3 },
      { group: 8, group_name: '跨服战场', total_count: 20, finish_count: 2 },
    ],
  ];

  it('sums the groups and skips group 8 without the battle net', () => {
    const overview = parseOverviewStat(reply);
    expect(overview.point).toBe(120);
    expect(overview.finished).toBe(3);
    expect(overview.total).toBe(40);
    expect(overview.groups.map((g) => g.group)).toEqual([1]);
  });

  it('keeps group 8 with the battle net enabled', () => {
    const overview = parseOverviewStat(reply, true);
    expect(overview.finished).toBe(5);
    expect(overview.total).toBe(60);
  });
});

describe('achieveGroupNames / groupQueryArgs', () => {
  it('lists 总览 plus the fixed groups, nets only when enabled', () => {
    expect(achieveGroupNames()).toEqual([
      '总览',
      '综合',
      '任务',
      '排行',
      '活动',
      '剧情战场',
      '据点战场',
      '名城名将',
    ]);
    expect(achieveGroupNames(true, true)).toHaveLength(10);
  });

  it('maps group 8 to 9 only with chibi net enabled and battle net off', () => {
    expect(groupQueryArgs(1, 8, 0, 0)).toEqual([1, 8, 0, 0, 0]);
    expect(groupQueryArgs(1, 8, 0, 2, false, true)).toEqual([1, 9, 0, 0, 2]);
    expect(groupQueryArgs(1, 8, 0, 2, true, true)).toEqual([1, 8, 0, 0, 2]);
  });
});

describe('parseAchivementsByGroup', () => {
  it('computes the 5-per-page count as (count+4)/5', () => {
    expect(parseAchivementsByGroup([0, []])).toEqual({ pageCount: 0, rows: [] });
    expect(parseAchivementsByGroup([1, [{ id: 1 }]]).pageCount).toBe(1);
    expect(parseAchivementsByGroup([6, []]).pageCount).toBe(2);
  });
});

describe('achieveItemView', () => {
  it('formats the gained time and image path', () => {
    const view = achieveItemView({
      id: 7,
      name: '初出茅庐',
      content: '介绍',
      point: 5,
      image: 0,
      achieveGetTime: '--',
    });
    expect(view).toMatchObject({
      id: 7,
      gained: false,
      getTime: '------',
      imagePath: 'images/achievement/7.png',
    });
    const gained = achieveItemView({
      id: 8,
      name: 'x',
      content: '',
      point: 1,
      image: 12,
      achieveGetTime: 1700000000,
    });
    expect(gained.gained).toBe(true);
    expect(gained.getTime).toContain('年');
    expect(gained.imagePath).toBe('images/achievement/12.png');
  });
});

describe('parseAchiveDetail', () => {
  it('returns null without the info row', () => {
    expect(parseAchiveDetail([false, [], 0])).toBeNull();
  });

  it('type 2 builds the cumulative progress label', () => {
    const view = parseAchiveDetail([
      { id: 22, name: '囤积者', todo: '存粮', type: 2, image: 0 },
      [{ targetValue: 3000, userValue: 1500 }],
      9,
    ]);
    expect(view).toMatchObject({ name: '囤积者', progressLabel: '50%', userCount: 9 });
    expect(view!.progressRatio).toBeCloseTo(0.5);
  });

  it('type 2 uses the raw pair up to 1000', () => {
    const view = parseAchiveDetail([
      { id: 3, name: 'x', todo: '', type: 2, image: 0 },
      [{ targetValue: 10, userValue: 4 }],
      0,
    ]);
    expect(view!.progressLabel).toBe('4/10');
  });

  it('type 2 caps userValue at the target', () => {
    const view = parseAchiveDetail([
      { id: 3, name: 'x', todo: '', type: 2, image: 0 },
      [{ targetValue: 10, userValue: 40 }],
      0,
    ]);
    expect(view!.progressLabel).toBe('10/10');
  });

  it('type 3 lists the goals with their done state', () => {
    const view = parseAchiveDetail([
      { id: 4, name: 'x', todo: '', type: 3, image: 0 },
      [
        { content: '目标一', isDone: 1 },
        { content: '目标二', isDone: 0 },
      ],
      3,
    ]);
    expect(view!.goals).toEqual([
      { content: '目标一', isDone: true },
      { content: '目标二', isDone: false },
    ]);
  });
});

describe('parseAchiveRankReply', () => {
  it('keeps the rank reply fields', () => {
    const reply = parseAchiveRankReply([1700000000, 3, 1, 'achivement', [{ rank: 1 }]]);
    expect(reply).toEqual({
      updateTime: 1700000000,
      pageCount: 3,
      page: 1,
      type: 'achivement',
      rows: [{ rank: 1 }],
    });
  });
});
