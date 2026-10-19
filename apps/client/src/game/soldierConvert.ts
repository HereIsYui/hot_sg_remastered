import type { ArmySoldierState } from './soldiers';

/** Army.SoldierChangerPanel: 兵种转化 in the main city's 兵营 (level 11 and up). */

/** `Define.SOLDIER_PEOPLE`: military population of one soldier of sid 1..12. */
const SOLDIER_PEOPLE = [1, 1, 1, 1, 1, 2, 3, 6, 4, 5, 10, 8];

/** `SoldierChangerItem.itemData`. */
export interface ConvertChoice {
  sid: number;
  name: string;
  count: number;
}

const isSpecial = (sid: number) => sid >= 45 && sid <= 50;
const people = (sid: number) => SOLDIER_PEOPLE[sid - 1] ?? 1;

/**
 * `ArmyDialog.initCanChangSoldier`: every ordinary soldier whose 前提科技 are met can be a target;
 * those the city has can be converted from.
 */
export function convertChoices(soldiers: ArmySoldierState[]): {
  from: ConvertChoice[];
  to: ConvertChoice[];
} {
  const from: ConvertChoice[] = [];
  const to: ConvertChoice[] = [];
  for (const s of soldiers) {
    if (isSpecial(s.sid)) continue;
    const choice = { sid: s.sid, name: s.sname, count: s.count };
    if (s.conditions.every((c) => c.type !== '前提科技' || c.canUpgrade)) to.push(choice);
    if (s.count > 0) from.push(choice);
  }
  return { from, to };
}

/** cfg_soldier_convert: `from:to`, so many of the one become so many of the other. */
export function convertRate(rates: unknown[][], fromSid: number, toSid: number): string {
  const r = rates[fromSid - 1]?.[toSid - 1];
  return r == null ? '' : String(r);
}

function ratio(rate: string): [number, number] | null {
  const [a, b] = rate.split(':').map(Number);
  return a && b ? [a, b] : null;
}

/** `updateMaxFrom`: as many as the city has and today's allowance pays for. */
export function maxConvertFrom(remain: number, from: ConvertChoice | null): number {
  return from ? Math.min(Math.floor(remain / people(from.sid)), from.count) : 0;
}

/** `updateMaxTo`: what the allowance pays for, and what the most that can go in turns into. */
export function maxConvertTo(
  remain: number,
  from: ConvertChoice | null,
  to: ConvertChoice | null,
  rate: string,
): number {
  const r = ratio(rate);
  if (!from || !to || !r) return 0;
  const byPeople = Math.floor(remain / people(to.sid));
  return Math.floor(Math.min(byPeople, (maxConvertFrom(remain, from) * r[1]) / r[0]));
}

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

/** `changeFrom`: what `count` of the source turns into; unchanged without a ratio. */
export function convertedCount(count: number, rate: string, max: number, current: number): number {
  const r = ratio(rate);
  return r ? clamp(Math.floor((count * r[1]) / r[0]), max) : current;
}

/** `convert`: the source count is recomputed from the target before sending. */
export function sourceCount(target: number, rate: string, max: number, current: number): number {
  const r = ratio(rate);
  return r ? clamp(Math.floor((target * r[0]) / r[1]), max) : current;
}

/** `SolderChangePanel_1_9`: "n个XX成功转化为m个YY". */
export function convertDoneText(
  template: string,
  fromCount: number,
  fromName: string,
  toCount: number,
  toName: string,
): string {
  return template
    .replace('n', String(fromCount))
    .replace('XX', fromName)
    .replace('m', String(toCount))
    .replace('YY', toName);
}
