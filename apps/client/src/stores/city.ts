import { defineStore } from 'pinia';

type Row = Record<string, unknown>;

/** `Define.GAME_SPEED_RATE`. */
const GAME_SPEED_RATE = 1;
const TECHNIC_TAX = 25;
const BUILDING_GOVERNMENT = 6;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const num = (v: unknown) => parseFloat(String(v)) || 0;
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/** `Building.BuildingState`: one sys_building row as the client models it. */
export interface BuildingState {
  bid: number;
  bname: string;
  description: string;
  /** 1 inside the walls, 0 the fields outside. */
  inner: number;
  x: number;
  y: number;
  level: number;
  /** 0 idle, 1 upgrading, 2 being demolished. */
  state: number;
  state_starttime: number;
  state_endtime: number;
  state_timeleft: number;
}

/** `BloodWar.onGetCityBuilding` for one row: `xy` packs inner*100 + x*10 + y. */
export function parseBuilding(r: Row, descriptions: Record<number, string> = {}): BuildingState {
  const xy = int(r.xy);
  const inner = Math.floor(xy / 100);
  const cell = xy - inner * 100;
  return {
    bid: int(r.bid),
    bname: String(r.bname ?? ''),
    description: descriptions[int(r.bid)] ?? '',
    inner,
    x: Math.floor(cell / 10),
    y: cell % 10,
    level: int(r.level),
    state: int(r.state),
    state_starttime: int(r.state_starttime),
    state_endtime: int(r.state_endtime),
    state_timeleft: int(r.state_timeleft) + 1,
  };
}

/** Port of the static `City` model: the city currently shown (filled by city/getCityInfo). */
export const useCityStore = defineStore('city', {
  state: () => ({
    cid: 0,
    name: '',
    type: 0,
    spacialSid: 0,
    position: '',
    provinceId: 0,
    junId: 0,
    morale: 0,
    morale_stable: 0,
    complaint: 0,
    tax: 0,
    hero_fee: 0,
    gold: 0,
    gold_max: 0,
    gold_rate: 0,
    gold_add: 0,
    people_all: 0,
    people_max: 0,
    people_working: 0,
    people_building: 0,
    people_stable: 0,
    people_free: 0,
    food: 0,
    food_real: 0,
    food_add: 0,
    food_add_real: 0,
    food_army_use: 0,
    food_army_use_real: 0,
    food_max: 0,
    wood: 0,
    wood_real: 0,
    wood_add: 0,
    wood_add_real: 0,
    wood_max: 0,
    rock: 0,
    rock_real: 0,
    rock_add: 0,
    rock_add_real: 0,
    rock_max: 0,
    iron: 0,
    iron_real: 0,
    iron_add: 0,
    iron_add_real: 0,
    iron_max: 0,
    /** `BloodWar.skillGoldAdd`: tax bonus (%) of the governor's skills. */
    skillGoldAdd: 0,
    governmentLevel: 0,
    buildings: [] as BuildingState[],
    /** tid -> level. */
    technics: {} as Record<number, number>,
    heroes: [] as Row[],
    /** sid -> soldiers in the city; ids absent from the last reply count 0. */
    soldierCounts: {} as Record<number, number>,
    /** did -> defence works on the wall. */
    defenceCounts: {} as Record<number, number>,
    /** sys_alarm row (troops / enemy / report / union / battle / task flags), false when none. */
    alarm: null as Row | null,
  }),
  getters: {
    technicLevel: (s) => (tid: number) => s.technics[tid] ?? 0,
  },
  actions: {
    /**
     * `City.getGoldAdd`: hourly tax income before hero wages; at another `tax` it is the
     * 调整税率 dialog's estimate.
     */
    goldIncome(rate?: number): number {
      const tax = rate ?? this.tax;
      const base = tax * this.people_all * 0.01 * GAME_SPEED_RATE * this.gold_rate * 0.01;
      const skill = this.people_all * tax * 0.01 * this.skillGoldAdd * 0.01;
      return Math.floor(base * (this.technicLevel(TECHNIC_TAX) * 0.05 + 1) + skill);
    },

    /** `BloodWar.onLoadResource` (mem_city_resource row). */
    applyResource(r: Row | null): void {
      if (!r) return;
      this.gold = Math.floor(num(r.gold));
      this.gold_max = Math.floor(num(r.gold_max));
      this.gold_rate = int(r.gold_rate);
      // Uses tax / people / wages of the previous load, as the original does.
      this.gold_add = this.goldIncome() - this.hero_fee;
      if (this.gold_add === 0) {
        const base = Math.trunc(
          int(r.people) * int(r.tax) * 0.01 * int(r.gold_rate) * 0.01 * GAME_SPEED_RATE,
        );
        const skill = num(r.people) * num(r.tax) * 0.01 * this.skillGoldAdd * 0.01;
        this.gold_add = Math.floor(
          base * (this.technicLevel(TECHNIC_TAX) * 0.05 + 1) + skill - int(r.hero_fee),
        );
      }
      this.food = Math.floor(num(r.food));
      this.food_real = num(r.food);
      this.food_add = Math.floor(num(r.food_add));
      this.food_add_real = num(r.food_add);
      this.food_army_use = Math.floor(num(r.food_army_use));
      this.food_army_use_real = num(r.food_army_use);
      this.food_max = Math.floor(num(r.food_max));
      for (const k of ['wood', 'iron', 'rock'] as const) {
        this[k] = Math.floor(num(r[k]));
        this[`${k}_real`] = num(r[k]);
        this[`${k}_add`] = Math.floor(num(r[`${k}_add`]));
        this[`${k}_add_real`] = num(r[`${k}_add`]);
        this[`${k}_max`] = Math.floor(num(r[`${k}_max`]));
      }
      this.people_all = int(r.people);
      this.people_max = int(r.people_max);
      this.people_working = int(r.people_working);
      this.people_building = int(r.people_building);
      this.people_stable = int(r.people_stable);
      this.people_free = this.people_all - this.people_working - this.people_building;
      this.tax = int(r.tax);
      this.morale = int(r.morale);
      this.morale_stable = int(r.morale_stable);
      this.complaint = int(r.complaint);
      this.hero_fee = int(r.hero_fee);
    },

    applyBuildings(rows: unknown, descriptions: Record<number, string>): void {
      this.buildings = rowsOf(rows).map((r) => parseBuilding(r, descriptions));
      const gov = this.buildings.find((b) => b.bid === BUILDING_GOVERNMENT);
      if (gov) this.governmentLevel = gov.level;
    },

    applyTechnics(rows: unknown): void {
      this.technics = Object.fromEntries(rowsOf(rows).map((r) => [int(r.tid), int(r.level)]));
    },

    applyHeroes(rows: unknown): void {
      this.heroes = rowsOf(rows);
    },

    /** `heroList.setItemAt`: one hero row refreshed by an armor command. */
    replaceHero(row: unknown): void {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      const hero = row as Row;
      const i = this.heroes.findIndex((h) => int(h.hid) === int(hero.hid));
      if (i >= 0) this.heroes.splice(i, 1, hero);
    },

    /** `onLoadSoldierList` / `onLoadDefenceList`: `count` may be null. */
    applySoldiers(rows: unknown): void {
      this.soldierCounts = Object.fromEntries(rowsOf(rows).map((r) => [int(r.sid), int(r.count)]));
    },

    applyDefences(rows: unknown): void {
      this.defenceCounts = Object.fromEntries(rowsOf(rows).map((r) => [int(r.did), int(r.count)]));
    },

    /** One second of `InfoPanel.onTimer`: production accrues up to the storage limit. */
    accrue(): void {
      if (this.wood_real < this.wood_max) this.wood_real += this.wood_add_real / 3600;
      if (this.food_real < this.food_max) {
        this.food_real = Math.max(
          0,
          this.food_real + (this.food_add_real - this.food_army_use_real) / 3600,
        );
      }
      if (this.rock_real < this.rock_max) this.rock_real += this.rock_add_real / 3600;
      if (this.iron_real < this.iron_max) this.iron_real += this.iron_add_real / 3600;
    },
  },
});
