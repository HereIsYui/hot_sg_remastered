import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseBuilding, useCityStore } from './city';

beforeEach(() => setActivePinia(createPinia()));

const resource = {
  gold: '1000.75',
  gold_max: '100000',
  gold_rate: '100',
  food: '500.5',
  food_add: '3600',
  food_army_use: '7200',
  food_max: '10000',
  wood: '9999.9',
  wood_add: '3600',
  wood_max: '10000',
  rock: '0',
  rock_add: '360',
  rock_max: '10000',
  iron: '20000',
  iron_add: '3600',
  iron_max: '10000',
  people: '200',
  people_max: '1000',
  people_working: '50',
  people_building: '30',
  people_stable: '300',
  tax: '10',
  morale: '80',
  morale_stable: '90',
  complaint: '5',
  hero_fee: '0',
};

describe('city store', () => {
  it('unpacks xy and the remaining time like onGetCityBuilding', () => {
    const b = parseBuilding(
      { bid: '6', bname: '官府', xy: '153', level: '2', state: '1', state_timeleft: '9' },
      { 6: 'desc' },
    );
    expect(b).toMatchObject({ bid: 6, inner: 1, x: 5, y: 3, level: 2, state: 1 });
    expect(b.state_timeleft).toBe(10);
    expect(b.description).toBe('desc');
    expect(parseBuilding({ xy: '42' })).toMatchObject({ inner: 0, x: 4, y: 2 });
  });

  it('loads resources and computes idle people', () => {
    const city = useCityStore();
    city.applyResource(resource);
    expect(city.gold).toBe(1000);
    expect(city.food_real).toBe(500.5);
    expect(city.people_free).toBe(120);
    // First load: tax and people of the previous (empty) state give 0, so the fallback applies.
    expect(city.gold_add).toBe(20);
    city.applyResource(resource);
    expect(city.gold_add).toBe(20);
  });

  it('accrues hourly production per second below the storage limit', () => {
    const city = useCityStore();
    city.applyResource(resource);
    city.accrue();
    expect(city.wood_real).toBeCloseTo(10000.9);
    expect(city.iron_real).toBe(20000);
    expect(city.rock_real).toBeCloseTo(0.1);
    expect(city.food_real).toBeCloseTo(499.5);
    city.food_real = 0.5;
    city.accrue();
    expect(city.food_real).toBe(0);
  });

  it('applies the tax technic to the income', () => {
    const city = useCityStore();
    city.applyTechnics([{ tid: '25', level: '10' }]);
    city.applyResource(resource);
    city.applyResource(resource);
    expect(city.gold_add).toBe(30);
  });

  it('tracks the government level from the building list', () => {
    const city = useCityStore();
    city.applyBuildings([{ bid: '6', xy: '155', level: '4' }], {});
    expect(city.governmentLevel).toBe(4);
  });
});
