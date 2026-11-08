import { describe, expect, it } from 'vitest';
import { friendDetails, parsePublicHeroTasks, rewardArgs, rewardSelection } from './famousTasks';
describe('famous task protocols', () => {
  it('preserves the group for public, exclusive and commission rewards', () => {
    expect(rewardArgs(401, 24561)).toEqual([401, 24561]);
    expect(rewardArgs(400101, 20101)).toEqual([400101, 20101]);
    expect(rewardArgs(300001, 300001)).toEqual([300001, 300001]);
  });
  it('selects heroes by level and equipment by quality or part', () => {
    expect(rewardSelection(1, 1, [{ sort: '1', type: '50', count: '20' }])).toEqual({
      kind: 'hero',
      type: 50,
      level: 20,
    });
    for (const type of [51, 52])
      expect(rewardSelection(1, 1, [{ sort: 1, type, count: 4 }])).toEqual({
        kind: 'armor',
        type,
        armorId: 0,
        value: 4,
        count: 1,
      });
    expect(rewardSelection(1, 1, [{ sort: 2, type: 50, count: 2 }])).toBeNull();
  });
  it('requires two pieces for the equipment exchange', () => {
    expect(
      rewardSelection(104432, 104430, [
        { sort: 2, type: 13, count: 1 },
        { sort: 1, type: 12001, count: 2 },
      ]),
    ).toEqual({ kind: 'armor', type: 0, armorId: 12001, value: 0, count: 2 });
  });
  it('normalizes PHP ids and counts competing friendships', () => {
    expect(parsePublicHeroTasks([[{ id: '401', group: '24561' }]])[0]?.group).toBe(24561);
    expect(
      friendDetails([
        [{ hid: '456', npcid: '456', state: '1' }],
        [
          { npcid: '456', state: '1' },
          { npcid: 456, state: 1 },
          { npcid: 456, state: 2 },
        ],
      ]).get(456)?.count,
    ).toBe(2);
  });
});
