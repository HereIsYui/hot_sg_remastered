import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  groupLabel,
  parseGroups,
  parseTasks,
  pickGroup,
  pickTask,
  rewardText,
  taskDetail,
  type TaskNames,
} from './task';

const names: TaskNames = {
  soldiers: { 3: '民兵' },
  defences: { 1: '陷阱' },
  things: { 10400: '碎片' },
  officepos: { 1: '伍长' },
  nobility: { 2: '上造' },
};

beforeAll(() => {
  const strings: Record<string, string> = {
    Task_TaskDialogSrc_9: '黄金',
    Task_TaskDialogSrc_10: '粮食',
    Task_TaskDialogSrc_27: '礼金',
    Task_TaskDialogSrc_32: '(完成)',
    Task_TaskDialogSrc_40: '（完成）<br/>',
    Task_TaskDialogSrc_41: '（未完成）<br/>',
    Task_TaskDialogSrc_44: '，',
    Task_TaskDialogSrc_45: '。',
    Task_TaskDialogSrc_46: '晋升官职',
    Task_TaskDialogSrc_48: '战场荣誉',
    Task_TaskDialogSrc_56: '好感度',
  };
  for (const n of [34, 35, 36, 37, 38, 39, 42, 43]) strings[`Task_TaskDialogSrc_${n}`] = '';
  setStrings(strings);
});

const groups = parseGroups([
  { id: '1', name: '安居乐业', count: '0', description: 'a' },
  { id: '7', name: '政通人和', count: '2', description: 'b' },
  { id: '12', name: '招兵买马', count: '1', description: 'c' },
]);

describe('task groups', () => {
  it('labels the finished count in green', () => {
    expect(groupLabel(groups[0]!)).toBe('安居乐业  ');
    expect(groupLabel(groups[1]!)).toBe('政通人和  <font color="#00ff00">(2)</font>');
  });

  it('prefers the remembered group with finished tasks, then the first one with any', () => {
    expect(pickGroup(groups, 12)).toEqual({ id: 12, index: 2 });
    expect(pickGroup(groups, -1)).toEqual({ id: 7, index: 1 });
    expect(pickGroup(groups, 1)).toEqual({ id: 7, index: 1 });
    const idle = parseGroups([
      { id: '1', count: 0 },
      { id: '4', count: 0 },
    ]);
    expect(pickGroup(idle, 4)).toEqual({ id: 4, index: 0 });
    expect(pickGroup(idle, -1)).toEqual({ id: 1, index: 0 });
    expect(pickGroup(idle, 0)).toEqual({ id: 1, index: 0 });
  });
});

describe('task list', () => {
  const tasks = parseTasks([
    { id: '2', name: '升级民房', state: false },
    { id: '3', name: '建造农田', state: true },
    { id: '4', name: '建造木场', state: true },
  ]);

  it('keeps a finished remembered row, else jumps to the first finished one', () => {
    expect(pickTask(tasks, 2)).toBe(2);
    expect(pickTask(tasks, 0)).toBe(1);
    expect(pickTask(tasks, -1)).toBe(1);
    expect(pickTask(parseTasks([{ id: 9, state: false }]), -1)).toBe(0);
  });
});

describe('task detail', () => {
  it('names rewards by kind', () => {
    expect(rewardText({ sort: 1, type: 1, count: '500' }, names)).toBe('黄金500');
    expect(rewardText({ sort: 1, type: 17, count: '1' }, names)).toBe('晋升官职伍长');
    expect(rewardText({ sort: 1, type: 30, count: 5 }, names)).toBe('战场荣誉5');
    expect(rewardText({ sort: 1, type: 21, count: 3 }, names)).toBe('好感度3');
    expect(rewardText({ sort: 1, type: 99, count: 3, name: '其他' }, names)).toBe('其他');
    expect(rewardText({ sort: 2, type: 68, count: 1, name: '鲁班便笺1' }, names)).toBe('鲁班便笺1');
    expect(rewardText({ sort: 3, type: 3, count: 10 }, names)).toBe('民兵10');
    expect(rewardText({ sort: 5, type: 10400, count: 80 }, names)).toBe('碎片80');
  });

  it('lists goals with progress and enables the reward when all are reached', () => {
    const detail = taskDetail(
      [
        { id: '801', name: '强化所需', content: 'c', todo: 'd' },
        [
          { sort: '5', type: '10400', count: '80', content: '兑换碎片', state: true },
          { sort: '50', count: '3', currentcount: '1', content: '累计', state: false },
        ],
        [
          { sort: 1, type: 1, count: 500 },
          { sort: 1, type: 2, count: 300 },
        ],
      ],
      3,
      names,
    )!;
    expect(detail.id).toBe(801);
    expect(detail.finished).toBe(false);
    expect(detail.multi).toBe(true);
    expect(detail.html).toContain('- 兑换碎片（完成）');
    expect(detail.html).toContain('- 累计 (1/3) （未完成）');
    expect(detail.html).toContain('黄金500，粮食300。');
  });

  it('offers no batch reward for hero or gear goals, nor without goals a reward', () => {
    const detail = taskDetail([{ id: 1 }, [{ sort: 1, type: 50, state: true }], []], 5, names)!;
    expect(detail.multi).toBe(false);
    expect(detail.finished).toBe(true);
    expect(taskDetail([{ id: 1 }, [], []], 0, names)!.finished).toBe(false);
  });
});
