import { heroStateName } from './units';

type Row = Record<string, unknown>;
const int = (value: unknown) => parseInt(String(value), 10) || 0;

export interface OfficeHeroRow extends Row {
  command: number;
  affairs: number;
  bravery: number;
  wisdom: number;
  stateText: string;
  sortState: number;
}

function stateSort(hero: Row): number {
  if (int(hero.hero_health) !== 0) return 1;
  const state = int(hero.state);
  if (state === 0) return 6;
  if (state === 1) return 9;
  if (state === 2) return 5;
  if (state === 4) return 4;
  if (state === 6) return 2;
  if (state === 7) return 8;
  if (state === 8) return 7;
  if (state === 10) return 3;
  return -1;
}

export function officeHeroRow(hero: Row, now: number): OfficeHeroRow {
  const commandBase = int(hero.level) + int(hero.command_base);
  const command =
    int(now < int(hero.buf1) ? Math.floor(commandBase * 1.5) : commandBase) +
    int(hero.command_add_on);
  const attribute = (base: unknown, add: unknown, buffer: unknown, addon: unknown) => {
    const value = int(base) + int(add);
    return int(now < int(buffer) ? Math.floor(value * 1.25) : value) + int(addon);
  };
  return {
    ...hero,
    command,
    affairs: attribute(hero.affairs_base, hero.affairs_add, hero.buf2, hero.affairs_add_on),
    bravery: attribute(hero.bravery_base, hero.bravery_add, hero.buf3, hero.bravery_add_on),
    wisdom: attribute(hero.wisdom_base, hero.wisdom_add, hero.buf4, hero.wisdom_add_on),
    stateText: heroStateName(hero),
    sortState: stateSort(hero),
  };
}

export function officeHeroRows(heroes: Row[], now: number): OfficeHeroRow[] {
  return heroes.map((hero) => officeHeroRow(hero, now)).sort((a, b) => b.sortState - a.sortState);
}

export function parseRestHeroes(data: unknown): { now: number; heroes: Row[] } {
  const arr = Array.isArray(data) ? data : [];
  const resting = Array.isArray(arr[1]) ? (arr[1] as Row[]) : [];
  const hurt = Array.isArray(arr[2]) ? (arr[2] as Row[]) : [];
  return { now: int(arr[0]), heroes: resting.length > 0 ? resting : hurt };
}
