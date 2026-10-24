import { defineStore } from 'pinia';
import type { TroopRow } from '../game/troop';
import type { BuildingState } from './city';

export type Screen = 'loading' | 'login' | 'createRole' | 'game';

/** Main scene selected in the top bar. */
export type View = 'cityInner' | 'city' | 'world' | 'battle';

/** Dialogs opened without arguments (`showBuildingListDialog`, `showResourceProductDialog`, ...). */
export type PlainDialog =
  | 'buildingList'
  | 'resourceProduct'
  | 'cityList'
  | 'modifyPassword'
  | 'task'
  | 'myGoods'
  | 'favourites';

/**
 * `DialogManager.showCreateBuildingDialog(kind)` (0 fields, 1 inner, 2 wall), `showBuildingDialog`,
 * `showOpenLockDialog(type)` and the plain dialogs. `cityField` carries the wid the original
 * `showCityFieldDialog(wid)` pre-opens the field detail for (0 = the plain list).
 */
export type DialogState =
  | { name: 'createBuilding'; kind: number }
  | { name: 'building'; building: BuildingState }
  | { name: 'openLock'; type: string }
  | { name: 'heroDetail'; hid: number }
  | { name: 'worldAction'; cid: number }
  | { name: 'cityField'; wid: number }
  | { name: 'cityMerge'; selectCid: number }
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

/** `DialogManager.showTroopDetailDialog`: the troop a 军队详情 pop-up is opened for. */
export interface TroopDetailRequest {
  troop: TroopRow;
  armyType: 'self' | 'enemy' | 'union';
}

/**
 * `DialogManager.showCampaignDialog`: the 出征 dialog opened over the 校场. `groundBid` / `groundParam`
 * route its StartTroop / scheme dialog commands; `targetCid` / `taskIndex` preset the target and
 * the task combo (per the AS3 `setTarget` / `setTask`).
 */
export interface CampaignRequest {
  groundBid: number;
  groundParam: number;
  targetCid: number;
  taskIndex: number;
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
    /** Mail (MailDialog) open over the scene; detail / write layer stacked on top. */
    mail: null as { open: boolean } | null,
    /** MailDetailDialog: the letter being read (mid + its mailbox page). */
    mailDetail: null as { mid: number; page: number } | null,
    /** MailWriteDialog: a new letter, optionally a reply pre-filled from a read letter. */
    mailWrite: null as { reply: Record<string, unknown> | null; receiver: string } | null,
    /** JackarooDialog: the welcome shown once a role is created. */
    welcome: false,
    /** Troop (TroopDialog, 军队) open over the scene. */
    troopDialog: false,
    /** TroopDetailDialog: the 军队详情 pop-up stacked over the TroopDialog. */
    troopDetail: null as TroopDetailRequest | null,
    /** CampaignDialog (出征) open over the 校场. */
    campaign: null as CampaignRequest | null,
    /** Report (ReportDialog, 战报) open over the scene. */
    report: null as { open: boolean } | null,
    /** BattleDialog (战斗 view): the battle being watched, opened from a report or a troop. */
    battle: null as { battleid: number; userIsAttack: boolean } | null,
  }),
});
