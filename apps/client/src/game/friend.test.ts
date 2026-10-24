import { describe, expect, it } from 'vitest';
import { cidLabel, parseUserRelation } from './friend';

const reply = [
  [
    {
      tuid: 1002,
      tname: '张三',
      type: '0',
      unionName: '蜀',
      nobility: '2',
      time: '1970-01-02 00:00:00',
      cid: 200350,
      tcid: 188128,
    },
    {
      tuid: 1003,
      tname: '李四',
      type: '1',
      unionName: '',
      nobility: '0',
      time: '1970-01-02 00:00:00',
      cid: 209355,
      tcid: 200351,
    },
  ],
];

const NOBILITY = { 0: '平民', 2: '不更' };

describe('parseUserRelation', () => {
  it('splits the reply into friends and enemies with formatted coordinates', () => {
    const { friends, enemies } = parseUserRelation(reply, NOBILITY);
    expect(friends).toHaveLength(1);
    expect(enemies).toHaveLength(1);
    expect(friends[0]).toMatchObject({ tuid: 1002, tname: '张三', nobility: '不更' });
    expect(enemies[0]).toMatchObject({
      tuid: 1003,
      nobility: '平民',
      cid: '[355,209]',
      tcid: '[351,200]',
    });
  });

  it('maps unknown nobility ids to an empty name and tolerates an empty reply', () => {
    expect(parseUserRelation([], NOBILITY).friends).toHaveLength(0);
    const { enemies } = parseUserRelation([[{ tuid: 9, type: '1', nobility: 99 }]], NOBILITY);
    expect(enemies[0]!.nobility).toBe('');
  });
});

describe('cidLabel', () => {
  it('renders a city id as [x,y]', () => {
    expect(cidLabel(209355)).toBe('[355,209]');
    expect(cidLabel(200351)).toBe('[351,200]');
  });
});
