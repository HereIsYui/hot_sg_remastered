import { describe, expect, it } from 'vitest';
import { calcProduct, parseCityProduct } from './production';

const resadd = {
  food_rate: '100',
  wood_rate: '50',
  rock_rate: '0',
  iron_rate: '100',
  field_food_add: '10',
  field_wood_add: '0',
  field_rock_add: '0',
  field_iron_add: '0',
  goods_food_add: '25',
  goods_wood_add: '0',
  goods_rock_add: '0',
  goods_iron_add: '0',
};

function reply(skill: unknown[]) {
  return [
    resadd,
    '200', '100', '100', '50', // workers
    '2000', '1000', '500', '200', // output
    '10', '0', '0', '20', // technics
    '120', // army food
    '7.5', // chief
    '0', '0', '0', '0',
    skill,
  ]; // prettier-ignore
}

describe('production', () => {
  it('parses the reply and the chief skill', () => {
    const p = parseCityProduct(reply([1, 9, [5, 6, 7, 8]]))!;
    expect(p.rates).toEqual([100, 50, 0, 100]);
    expect(p.allPeople).toEqual([200, 100, 100, 50]);
    expect(p.chiefAdd).toBe(7.5);
    expect(p.skillAdd).toEqual([5, 6, 7, 8]);
    expect(parseCityProduct(reply([1, 11, '12.9']))!.skillAdd).toEqual([0, 12, 0, 0]);
    expect(parseCityProduct(reply([0]))!.skillAdd).toEqual([0, 0, 0, 0]);
  });

  it('scales the output by the workers the free people cover', () => {
    const p = parseCityProduct(reply([0]))!;
    const full = calcProduct(p, p.rates, 1000, 0);
    expect(full.working).toEqual([200, 50, 0, 50]);
    expect(full.workingRate).toBe(1);
    expect(full.base).toEqual([2000, 500, 0, 200]);
    // food: 100 + floor(2000 * (100 + 10 + 7.5 + 10 + 25) / 100) - 120
    expect(full.final).toEqual([3030, 637, 100, 355]);
    expect(full.heroAdd).toEqual([150, 37, 0, 15]);

    const short = calcProduct(p, p.rates, 250, 100);
    expect(short.workingRate).toBe(0.5);
    expect(short.base).toEqual([1000, 250, 0, 100]);
  });
});
