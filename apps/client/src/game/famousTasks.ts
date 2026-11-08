/** TaskDialog reward selection, including the two-piece equipment exchange. */
type Row = Record<string, unknown>;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
export type TaskSelection =
  | { kind: 'hero'; type: number; level: number }
  | { kind: 'armor'; type: number; armorId: number; value: number; count: number };
export function rewardSelection(tid: number, group: number, goals: Row[]): TaskSelection | null {
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i]!;
    if (int(goal.sort) !== 1 && group !== 104430) continue;
    let type = int(goal.type);
    let count = int(goal.count);
    if (group === 104430 && tid !== 104431) {
      if (count !== 2) {
        type = int(goals[i + 1]?.type);
        count = int(goals[i + 1]?.count);
      }
      return { kind: 'armor', type: 0, armorId: type, value: 0, count };
    }
    if (type === 51 || type === 52)
      return { kind: 'armor', type, armorId: 0, value: count, count: 1 };
    if (type === 50) return { kind: 'hero', type, level: count };
  }
  return null;
}
export function rewardArgs(tid: number, group: number): number[] {
  // AS3 TaskDialog.getReward always sends the group, including exclusive hero tasks.
  return [tid, group];
}
export interface PublicHeroTask {
  id: number;
  group: number;
  name: string;
  todo: string;
  reward: string;
}
export function parsePublicHeroTasks(data: unknown): PublicHeroTask[] {
  const rows = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as Row[]) : [];
  return rows.map((r) => ({
    id: int(r.id),
    group: int(r.group),
    name: String(r.name ?? ''),
    todo: String(r.todo ?? ''),
    reward: String(r.reward ?? ''),
  }));
}
/** Preserve portrait, loyalty and biography omitted by the normalized roster. */
export function friendDetails(data: unknown): Map<number, Row> {
  if (!Array.isArray(data)) return new Map();
  const mine = Array.isArray(data[0]) ? (data[0] as Row[]) : [];
  const all = Array.isArray(data[1]) ? (data[1] as Row[]) : [];
  return new Map(
    mine.map((r) => [
      int(r.hid),
      {
        ...r,
        loyalty: int(r.state) === 0 || int(r.state) === 1 ? '*' : r.loyalty,
        count: all.filter((f) => int(f.npcid) === int(r.npcid) && int(f.state) === 1).length,
      },
    ]),
  );
}
