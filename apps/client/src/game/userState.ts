/** W4 protocol helpers: selector indices differ from persisted states (2/6). */
export function coordinates(x: string, y: string): [number, number] | null {
  if (!/^\d+$/.test(x.trim()) || !/^\d+$/.test(y.trim())) return null;
  const point: [number, number] = [Number(x), Number(y)];
  return point.every((n) => Number.isInteger(n) && n >= 0 && n <= 500) ? point : null;
}
/** AS3 picker is 2..15 days; PHP accepts up to 99. */
export function vacationQuote(input: string) {
  const days = Number(input);
  return /^\d+$/.test(input) && Number.isInteger(days) && days >= 2 && days <= 15
    ? { days, cost: days * 5 + 20, cooldown: Math.floor(days * 0.2) }
    : null;
}
export type StateReply =
  | { kind: 'cancelVacation' }
  | { kind: 'vacation'; seconds: number }
  | { kind: 'state'; state: number; goods: unknown };
/** Vacation cancellation returns []; ordinary changes return [state, goods]. */
export function stateReply(data: unknown): StateReply | null {
  if (!Array.isArray(data)) return null;
  if (!data.length) return { kind: 'cancelVacation' };
  const state = Number(data[0]);
  if (state === 6) return { kind: 'vacation', seconds: Number(data[1]) || 0 };
  if (state === 0 || state === 2) return { kind: 'state', state, goods: data[1] };
  return null;
}
export const vacationCancelWait = (start: number, now: number) =>
  Math.max(0, start + 2 * 86400 - now);
export function stateNameKey(state: number): string {
  return state === 2
    ? 'UserInfo_ChangeStateDialog_14_1'
    : state === 6
      ? 'UserInfo_ChangeStateDialog_8'
      : state === 1
        ? 'UserInfo_ChangeStateDialog_11_1'
        : 'UserInfo_ChangeStateDialog_12_1';
}
