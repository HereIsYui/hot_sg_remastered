import { defineStore } from 'pinia';
import type { UnionMark, WorldCell, WorldCityInfo } from '../game/world';

/**
 * Client-side state of the world map (`World/WorldPanel.as` fields: `gridInfo`, `mgx`/`mgy`,
 * the loaded city infos and union marks). Kept out of the Vue component so the Pixi panel can be
 * torn down and rebuilt without losing where the view was.
 */
export const useWorldStore = defineStore('world', {
  state: () => ({
    /** `mgx` / `mgy`: the grid coordinate the view is centred on. */
    centre: { x: 250, y: 250 },
    /** `WorldPanel.gridInfo`: every known cell, keyed by city id. */
    cells: new Map<number, WorldCell>(),
    /** Detailed city rows from getWorldCityInfo, keyed by city id. */
    cityInfo: new Map<number, WorldCityInfo>(),
    /** Union marks from getBlockData. */
    marks: [] as UnionMark[],
    /** City ids the player owns a field on (getUserFields). */
    userFieldCids: [] as number[],
    /** Special-event field city ids (getActionField). */
    actionFieldCids: [] as number[],
    /** True once the first block load has resolved. */
    loaded: false,
  }),
});
