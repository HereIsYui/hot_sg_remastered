import { defineStore } from 'pinia';
import type { BuildingState } from './city';

export type Screen = 'loading' | 'login' | 'createRole' | 'game';

/** Main scene selected in the top bar. */
export type View = 'cityInner' | 'city' | 'world' | 'battle';

/** Dialogs opened without arguments (`showBuildingListDialog`, `showCityFieldDialog`, ...). */
export type PlainDialog =
  | 'buildingList'
  | 'resourceProduct'
  | 'cityList'
  | 'cityField'
  | 'modifyPassword'
  | 'task'
  | 'myGoods';

/**
 * `DialogManager.showCreateBuildingDialog(kind)` (0 fields, 1 inner, 2 wall), `showBuildingDialog`,
 * `showOpenLockDialog(type)` and the plain dialogs.
 */
export type DialogState =
  | { name: 'createBuilding'; kind: number }
  | { name: 'building'; building: BuildingState }
  | { name: 'openLock'; type: string }
  | { name: 'heroDetail'; hid: number }
  | { name: PlainDialog };

/**
 * `DialogManager.showUseGoodsDialog(time, type, param)`: the item picker over the other dialogs.
 * `param` is appended to useTypeGoods, e.g. the building's `[cid, inner, x, y, bid]`.
 */
export interface UseGoodsRequest {
  time: number;
  type: number;
  param: (number | string)[];
}

/** `DialogManager.showBuyAndUseDialog`: the shop row the `not_enough_goods` popup offers. */
export interface BuyAndUseRequest {
  goods: Record<string, unknown>;
}

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
    /** BuildingExchangePanel: the field it converts, kept while it is hidden. */
    exchange: null as BuildingState | null,
    exchangeOpen: false,
    useGoods: null as UseGoodsRequest | null,
    /** Shop (ShopDialog) open over the scene; the 购买装备 / 购买技能书 / 商城 entry points. */
    shop: null as { tab?: number } | null,
    /** BuyAndUseGoodsDialog: the `not_enough_goods` buy-and-use popup. */
    buyAndUse: null as BuyAndUseRequest | null,
    /** JackarooDialog: the welcome shown once a role is created. */
    welcome: false,
  }),
});
