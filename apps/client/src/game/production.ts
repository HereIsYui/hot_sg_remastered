type Row = Record<string, unknown>;

/** Food, wood, rock and iron, in the order of every production reply and column. */
export const PRODUCTS = ['food', 'wood', 'rock', 'iron'] as const;
export type Four = [number, number, number, number];
type Index = 0 | 1 | 2 | 3;

/** AS3 `int` assignment (ToInt32): truncates, NaN becomes 0. */
const toInt = (n: number) => n | 0;
const parseIntAs = (v: unknown) => parseInt(String(v), 10);
const four = (f: (i: Index) => number): Four => [f(0), f(1), f(2), f(3)];

/** `ResourceProductDialog.onGetCityProduct`: the getCityProduct reply. */
export interface CityProduct {
  /** sys_city_res_add row: rates and the field / item bonuses (%). */
  resadd: Row;
  /** Workers of all farms, sawmills, quarries and mines. */
  allPeople: Four;
  /** Hourly output with every worker at work. */
  all: Four;
  /** 农业 / 伐木 / 采石 / 冶炼 technic bonus (%). */
  techRate: Four;
  armyFoodUse: number;
  /** The 城守's 内政 bonus (%). */
  chiefAdd: number;
  /** When the 神农锄 / 鲁班斧 / 开山锤 / 玄铁炉 bonus runs out. */
  goodsEndTime: Four;
  /** The 城守's production skill bonus (%). */
  skillAdd: Four;
  rates: Four;
}

export function parseCityProduct(data: unknown): CityProduct | null {
  if (!Array.isArray(data)) return null;
  const d = [...(data as unknown[])];
  const resadd = (d.shift() ?? {}) as Row;
  const next = () => toInt(parseIntAs(d.shift()));
  const allPeople = four(next);
  const all = four(next);
  const techRate = four(next);
  const armyFoodUse = next();
  const chiefAdd = parseFloat(String(d.shift()));
  const goodsEndTime = four(next);
  return {
    resadd,
    allPeople,
    all,
    techRate,
    armyFoodUse,
    chiefAdd,
    goodsEndTime,
    skillAdd: parseSkill(d.shift()),
    rates: four((i) => toInt(parseIntAs(resadd[`${PRODUCTS[i]}_rate`]))),
  };
}

/** `[owned, skillId, bonus]`: skill 9 raises all four (bonus is a list), 10..13 one each. */
function parseSkill(v: unknown): Four {
  const skill = Array.isArray(v) ? (v as unknown[]) : [];
  const out: Four = [0, 0, 0, 0];
  if (toInt(parseIntAs(skill[0])) === 0) return out;
  const id = toInt(parseIntAs(skill[1]));
  if (id === 9) {
    const list = Array.isArray(skill[2]) ? (skill[2] as unknown[]) : [];
    return four((i) => toInt(Number(list[i])));
  }
  const i = id - 10;
  if (i >= 0 && i < 4) out[i] = toInt(parseFloat(String(skill[2])));
  return out;
}

export interface ProductTable {
  working: Four;
  /** Share of the needed workers the free population covers, at most 1. */
  workingRate: number;
  base: Four;
  techAdd: Four;
  heroAdd: Four;
  fieldAdd: Four;
  goodsAdd: Four;
  /** Hourly output: the 100 natural, the bonuses and (food) the army's upkeep. */
  final: Four;
}

/** `ResourceProductDialog.calcProduct` at the given rates. */
export function calcProduct(
  p: CityProduct,
  rates: Four,
  peopleAll: number,
  peopleBuilding: number,
): ProductTable {
  const working = four((i) => toInt(Math.floor(p.allPeople[i] * rates[i] * 0.01)));
  const needed = working.reduce((a, b) => a + b, 0);
  let workingRate = 1;
  if (needed > 0) workingRate = Math.min(1, Math.max(0, peopleAll - peopleBuilding) / needed);
  const base = four((i) => toInt(p.all[i] * rates[i] * 0.01 * workingRate));
  const bonus = (key: string, i: Index) => parseIntAs(p.resadd[`${key}_${PRODUCTS[i]}_add`]);
  const final = four((i) => {
    const rate =
      100 + p.techRate[i] + p.chiefAdd + p.skillAdd[i] + bonus('field', i) + bonus('goods', i);
    return toInt(100 + Math.floor(base[i] * rate * 0.01) - (i === 0 ? p.armyFoodUse : 0));
  });
  return {
    working,
    workingRate,
    base,
    techAdd: four((i) => toInt(p.techRate[i] * base[i] * 0.01)),
    heroAdd: four((i) => toInt(p.chiefAdd * base[i] * 0.01 + base[i] * p.skillAdd[i] * 0.01)),
    fieldAdd: four((i) => toInt(bonus('field', i) * base[i] * 0.01)),
    goodsAdd: four((i) => toInt(bonus('goods', i) * base[i] * 0.01)),
    final,
  };
}
