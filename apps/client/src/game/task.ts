import { i18n } from '../i18n';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const t = (n: number | string) => i18n(`Task_TaskDialogSrc_${n}`);

/** cfg_task_group.type of the tabs that can drop tasks (名将, 委托, 君主). */
export const DROPPABLE_TYPES = [2, 4, 7];
/** Kinds whose repeatable tasks can be handed in several times at once (史诗, 活动). */
const MULTI_TYPES = [3, 5];

export interface TaskGroup {
  id: number;
  name: string;
  /** Finished tasks in the group. */
  count: number;
  description: string;
}

export interface TaskRow {
  id: number;
  name: string;
  done: boolean;
}

/** Id lookups for the reward text (`Global.*NameMap`). */
export interface TaskNames {
  soldiers: Record<number, string>;
  defences: Record<number, string>;
  things: Record<number, string>;
  officepos: Record<number, string>;
  nobility: Record<number, string>;
}

export function parseGroups(list: unknown): TaskGroup[] {
  return (Array.isArray(list) ? (list as Row[]) : []).map((g) => ({
    id: int(g.id),
    name: str(g.name),
    count: int(g.count),
    description: str(g.description),
  }));
}

/** The group list's html row: name, then the finished count in green. */
export function groupLabel(group: TaskGroup): string {
  const count = group.count !== 0 ? `<font color="#00ff00">(${group.count})</font>` : '';
  return `${group.name}  ${count}`;
}

/**
 * `onGetTaskGroupList`'s choice: the remembered group if it has finished tasks, else the first
 * group with finished tasks, else the remembered group or the first. `index` is the row to
 * highlight.
 */
export function pickGroup(groups: TaskGroup[], lastId: number): { id: number; index: number } {
  let found = false;
  let index = -1;
  let firstDone = -1;
  groups.forEach((g, i) => {
    if (g.count === 0) return;
    if (g.id === lastId) {
      found = true;
      index = i;
    }
    if (!found && index < 0 && firstDone < 0) {
      index = i;
      firstDone = g.id;
    }
  });
  let id = lastId;
  if (!found && firstDone > 0) id = firstDone;
  else if (id < 0) id = groups[0]?.id ?? 0;
  if (id === 0) id = groups[0]?.id ?? 0;
  return { id, index: index >= 0 ? index : 0 };
}

export function parseTasks(list: unknown): TaskRow[] {
  return (Array.isArray(list) ? (list as Row[]) : []).map((task) => ({
    id: int(task.id),
    name: str(task.name),
    done: Boolean(task.state),
  }));
}

export function taskLabel(task: TaskRow): string {
  return task.done ? task.name + t(32) : task.name;
}

/** `onGetTaskList`'s choice: the remembered row if finished, else the first finished, else it. */
export function pickTask(tasks: TaskRow[], lastIndex: number): number {
  const keep = tasks[lastIndex]?.done === true;
  const firstDone = tasks.findIndex((task) => task.done);
  let index = !keep && firstDone >= 0 ? firstDone : lastIndex;
  if (index < 0) index = 0;
  return Math.min(index, tasks.length - 1);
}

export function groupDetailHtml(group: TaskGroup): string {
  return (
    `<p align="center"><font size="14"><b>${group.name}</b></font></p>` +
    t(49) +
    `<font color="#EBFFA9">${group.description}</font><br/>`
  );
}

/** `REWARD_RES_NAME`: sort-1 reward names by type. */
function resourceName(type: number): string | undefined {
  if (type >= 1 && type <= 20) return t(type + 8);
  if (type === 21) return t(56);
  return undefined;
}

/** `parseReward`: one reward's text, e.g. 黄金500. */
export function rewardText(reward: Row, names: TaskNames): string {
  const type = int(reward.type);
  const count = str(reward.count);
  switch (int(reward.sort)) {
    case 1:
      if (type === 17) return t(46) + (names.officepos[int(reward.count)] ?? '');
      if (type === 18) return t(47) + (names.nobility[int(reward.count)] ?? '');
      if (type === 30) return t(48) + count;
      if (type === 500) return t(100) + count;
      if (type === 502) return t(101) + count;
      if (type === 0) return count;
      return resourceName(type) !== undefined ? resourceName(type) + count : str(reward.name);
    case 2:
    case 6:
      return str(reward.name);
    case 3:
      return (names.soldiers[type] ?? '') + count;
    case 4:
      return (names.defences[type] ?? '') + count;
    case 5:
      return (names.things[type] ?? '') + count;
    default:
      return '';
  }
}

export interface TaskDetail {
  id: number;
  html: string;
  /** Every goal reached: 领取奖励 is enabled. */
  finished: boolean;
  /** 批量领取 is offered. */
  multi: boolean;
  goals: Row[];
}

/** `onGetTaskDetail`: `[task, goals, rewards]` as the content text. */
export function taskDetail(data: unknown, taskType: number, names: TaskNames): TaskDetail | null {
  if (!Array.isArray(data)) return null;
  const task = (data[0] ?? {}) as Row;
  const goals = (Array.isArray(data[1]) ? data[1] : []) as Row[];
  const rewards = (Array.isArray(data[2]) ? data[2] : []) as Row[];
  const multi =
    MULTI_TYPES.includes(taskType) && !goals.some((g) => int(g.sort) === 1 && int(g.type) >= 50);
  let html = `<p align="center"><font size="14"><b>${str(task.name)}</b></font></p>`;
  html += t(34) + t(35) + `<font color="#EBFFA9">${str(task.content)}</font><br/>`;
  html += t(36) + t(37) + `<font color="#EBFFA9">${str(task.todo)}</font><br/>`;
  html += t(38) + t(39);
  let finished = goals.length > 0;
  for (const goal of goals) {
    const progress =
      int(goal.sort) === 50 ? ` (${int(goal.currentcount)}/${int(goal.count)}) ` : '';
    if (!goal.state) finished = false;
    html += `<font color="#EBFFA9">- ${str(goal.content)}${progress}${t(goal.state ? 40 : 41)}`;
  }
  html += t(42) + t(43) + '<font color="#EBFFA9">';
  html += rewards.map((r) => rewardText(r, names)).join(t(44));
  html += t(45);
  return { id: int(task.id), html, finished, multi, goals };
}
