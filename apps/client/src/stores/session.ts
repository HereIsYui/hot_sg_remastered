import { defineStore } from 'pinia';
import type { BuildingState } from './city';

export type Screen = 'loading' | 'login' | 'createRole' | 'game';

/** Main scene selected in the top bar. */
export type View = 'cityInner' | 'city' | 'world' | 'battle';

/** Dialogs opened without arguments (`showBuildingListDialog`, `showCityFieldDialog`, ...). */
export type PlainDialog =
  'buildingList' | 'resourceProduct' | 'cityList' | 'cityField' | 'modifyPassword' | 'task';

/**
 * `DialogManager.showCreateBuildingDialog(kind)` (0 fields, 1 inner, 2 wall), `showBuildingDialog`,
 * `showOpenLockDialog(type)` and the plain dialogs.
 */
export type DialogState =
  | { name: 'createBuilding'; kind: number }
  | { name: 'building'; building: BuildingState }
  | { name: 'openLock'; type: string }
  | { name: PlainDialog };

/** Client-side flow state of BloodWar.as (which top-level view is shown, busy cursor). */
export const useSessionStore = defineStore('session', {
  state: () => ({
    screen: 'loading' as Screen,
    loadProgress: 0,
    /** Pending requests with `showBusyCursor`. */
    busy: 0,
    /** Login queue position (`LoginDialog.mQueuePeople`), 0 when not queued. */
    queuePeople: 0,
    loginAnnouncement: '',
    /** CreateRoleDialog mode: new role (true) or rebuild a city after losing all (false). */
    createRoleFirstTime: true,
    /** The province list may only be shown once loadProvinceInfo answered. */
    provinceLoaded: false,
    view: 'cityInner' as View,
    /** `TopPanel.mShowLevel`: level badges on the buildings. */
    showLevel: false,
    /** `TopPanel.buildingListPanel.visible`. */
    showBuildingList: false,
    /** `TopPanel.firstSet`: the first city load opens the building list and the level badges. */
    buildingListOpened: false,
    /** `City.current_inner` / `current_x` / `current_y`: the slot a building dialog acts on. */
    currentSlot: { inner: true, x: 0, y: 0 },
    dialog: null as DialogState | null,
  }),
});
