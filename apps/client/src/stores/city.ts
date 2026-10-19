import { defineStore } from 'pinia';

/** Port of the static `City` model: the city currently shown (filled by city/getCityInfo). */
export const useCityStore = defineStore('city', {
  state: () => ({
    cid: 0,
    name: '',
    type: 0,
    position: '',
    morale: 0,
    complaint: 0,
    tax: 0,
    gold: 0,
    gold_add: 0,
    people_all: 0,
    people_free: 0,
    food_real: 0,
    wood_real: 0,
    rock_real: 0,
    iron_real: 0,
    food_add: 0,
    food_army_use: 0,
    wood_add: 0,
    rock_add: 0,
    iron_add: 0,
  }),
});
