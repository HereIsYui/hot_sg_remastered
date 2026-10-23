import type { CommandArg } from '@hot/shared';
import type { Pinia } from 'pinia';
import { inject, reactive, type InjectionKey } from 'vue';
import { serverTime, syncServerTime } from '../core/clock';
import { i18n } from '../i18n';
import { CommandClient, type CommandFailure, type DialogResult } from '../net/command';
import { LoginService, type LoginResult } from '../net/login';
import { useCityStore, type BuildingState } from '../stores/city';
import { useGlobalStore } from '../stores/global';
import { useSessionStore, type PlainDialog, type View } from '../stores/session';
import { cityPosition, parseCities, useUserStore } from '../stores/user';
import { gameAlert, setAlertLabels, showAlert } from '../ui/alert';
import { BUILDING_COLLEGE } from './cityGrid';
import { UseGoodsType } from './goods';
import { GuideManager } from './guide';
import { loadLoginPrefs, saveLoginPrefs, type LoginPrefs } from './loginPrefs';
import { HERO_TYPE_KING } from './units';

type Row = Record<string, unknown>;

const QUEUE_POLL_MS = 30_000;

/** CityCommand poll types (`Command.sendCityCommand`). */
const CityInfoType = { Resource: 0, Hero: 1, Army: 2, Defence: 3, Time: 4 } as const;

/** City commands whose reply is the refreshed building list. */
const BUILDING_COMMANDS = new Set([
  'getCityBuilding',
  'startUpgradeBuilding',
  'startDestroyBuilding',
  'stopDestroyBuilding',
  'stopUpgradeBuilding',
  'startDestroyBuildingAll',
  'startChangeBuilding',
]);

/** A dialog waiting for replies (`isTarget` / `onData` of the original dialogs). */
export interface DialogReceiver {
  isTarget(receiverId: number, receiverParam: number): boolean;
  onData(data: unknown, ttype: number): void;
}

/** A dialog's handler for the global replies of its action (`onCommand` of the original). */
export type GlobalReceiver = (command: string, data: unknown) => void;

const asRow = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;
const int = (v: unknown) => parseInt(String(v), 10) || 0;

/**
 * Application controller: the flow logic of BloodWar.as (login, queue, role creation, global
 * command routing) on top of the stores; views only call into it.
 */
export class Game {
  readonly cmd: CommandClient;
  readonly loginService: LoginService;
  readonly user;
  readonly global;
  readonly city;
  readonly session;
  readonly guide = reactive(new GuideManager());
  private queueTimer: ReturnType<typeof setInterval> | undefined;
  private secondTimer: ReturnType<typeof setInterval> | undefined;
  private pollCountdown = { resource: 15, units: 60, time: 600 };
  private buildingWait = { seconds: 0, slot: '' };
  private showingFault = false;
  private readonly dialogReceivers = new Set<DialogReceiver>();
  private readonly globalReceivers = new Map<string, Set<GlobalReceiver>>();
  /** The action guarded by the open 2级密码 dialog (`BloodWar.unLockType` dispatch). */
  private pendingUnlock: { type: string; action: () => void } | null = null;

  constructor(pinia: Pinia, loginService = new LoginService(), cmd?: CommandClient) {
    this.user = useUserStore(pinia);
    this.global = useGlobalStore(pinia);
    this.city = useCityStore(pinia);
    this.session = useSessionStore(pinia);
    this.loginService = loginService;
    this.cmd =
      cmd ??
      new CommandClient(
        () => ({
          uid: this.user.uid,
          sid: this.user.sid,
          cid: this.user.cid,
          locked: this.user.locked,
        }),
        {
          global: (action, command, data) => this.onGlobalCommand(action, command, data),
          dialog: (result) => this.onDialogCommand(result),
          city: (type, data) => this.onCityInfoCommand(type, data),
          failure: (f) => this.onFailure(f),
          malformed: (source) =>
            void showAlert(i18n(source === 'city' ? '_CommandSrc_5' : '_CommandSrc_1')),
          fault: (_err, silent) => this.onFault(silent),
          busy: (n) => (this.session.busy = n),
        },
      );
  }

  // ---- login (LoginDialog / BloodWar.doLogin / onLogin / onCheckQueue) ----

  async showLogin(): Promise<void> {
    this.stopTimer();
    this.city.$reset();
    this.session.dialog = null;
    this.session.useGoods = null;
    this.session.screen = 'login';
    setAlertLabels({
      ok: i18n('Login_LoginDialogSrc_4'),
      yes: i18n('Login_LoginDialogSrc_2'),
      no: i18n('Login_LoginDialogSrc_3'),
    });
    try {
      this.session.loginAnnouncement = await this.loginService.getLoginAnnouncement();
    } catch {
      void showAlert(i18n('_BloodWarSrc_20'));
    }
  }

  loginPrefs(): LoginPrefs {
    return loadLoginPrefs();
  }

  async doLogin(
    passport: string,
    password: string,
    prefs: Omit<LoginPrefs, 'username' | 'password'>,
  ): Promise<void> {
    let result: LoginResult;
    try {
      result = await this.loginService.doLogin(passport, password);
    } catch {
      void showAlert(i18n('_BloodWarSrc_20'));
      return;
    }
    if (result.kind === 'error') {
      void showAlert(result.message);
      return;
    }
    if (result.kind === 'redirect') return;
    saveLoginPrefs({ ...prefs, username: passport, password });
    this.user.passport = passport;
    this.user.uid = result.uid;
    this.user.sid = result.sid;
    if (result.kind === 'queued') {
      this.showQueue(result.ahead);
      return;
    }
    this.user.userCardId = result.cardId;
    this.user.isAdult = result.isAdult;
    this.user.lastUpdateServerId = result.lastUpdateServerId;
    this.loginGameNow();
  }

  private showQueue(ahead: number): void {
    this.session.queuePeople = ahead + 1;
    if (!this.queueTimer)
      this.queueTimer = setInterval(() => void this.checkQueue(), QUEUE_POLL_MS);
  }

  cancelQueue(): void {
    clearInterval(this.queueTimer);
    this.queueTimer = undefined;
    this.session.queuePeople = 0;
  }

  async checkQueue(): Promise<void> {
    let result;
    try {
      result = await this.loginService.checkQueue(this.user.uid, this.user.sid);
    } catch {
      void showAlert(i18n('_BloodWarSrc_20'));
      return;
    }
    if (result.kind === 'invalid') {
      this.cancelQueue();
      await showAlert(i18n('_BloodWarSrc_21'));
      window.location.reload();
    } else if (result.kind === 'ready') {
      this.cancelQueue();
      this.loginGameNow();
    } else {
      this.showQueue(result.ahead);
    }
  }

  /** `BloodWar.loginGameNow`. */
  loginGameNow(): void {
    this.cancelQueue();
    this.cmd.open = true;
    setAlertLabels({
      yes: i18n('_BloodWarSrc_17'),
      no: i18n('_BloodWarSrc_18'),
      ok: i18n('_BloodWarSrc_19'),
    });
    void this.cmd.sendGlobalCommand('user', 'loadGlobalData');
    this.loadUserInfo();
    void this.cmd.sendGlobalCommand('battle', 'getBattleNetUrl');
    void this.cmd.sendGlobalCommand('battle', 'getUserBattleInfo');
  }

  loadUserInfo(): void {
    void this.cmd.sendGlobalCommand('user', 'loadUserInfo', [serverTime()]);
  }

  /** `Global.popGame`: stop talking to the server and go back to the login screen. */
  popGame(): void {
    this.cmd.open = false;
    void this.showLogin();
  }

  // ---- command routing (BloodWar.onGlobalCommand) ----

  /** Registers an open dialog for its replies; returns the unregister function. */
  addDialogReceiver(receiver: DialogReceiver): () => void {
    this.dialogReceivers.add(receiver);
    return () => this.dialogReceivers.delete(receiver);
  }

  /** `DialogManager.childOnCommand`: every dialog the reply is addressed to gets it. */
  private onDialogCommand(result: DialogResult): void {
    this.deliverToDialog(result.receiverId, result.receiverParam, result.data, result.ttype);
  }

  /** Hands data to the open dialogs addressed by `receiverId` / `receiverParam`. */
  deliverToDialog(receiverId: number, receiverParam: number, data: unknown, ttype = 0): void {
    for (const receiver of [...this.dialogReceivers]) {
      if (receiver.isTarget(receiverId, receiverParam)) receiver.onData(data, ttype);
    }
  }

  sendDialogCommand(
    command: string,
    receiverId: number,
    receiverParam: number,
    args: CommandArg[],
    ttype = 0,
  ): void {
    void this.cmd.sendDialogCommand(command, receiverId, receiverParam, args, ttype);
  }

  /** `sendGlobalCommand` whose reply goes to whoever registered for `action`. */
  sendGlobalCommand(action: string, command: string, args: CommandArg[] = []): void {
    void this.cmd.sendGlobalCommand(action, command, args);
  }

  /** Lets an open dialog handle the global replies of its own action (e.g. `armyDraft`). */
  addGlobalReceiver(action: string, onData: GlobalReceiver): () => void {
    const receivers = this.globalReceivers.get(action) ?? new Set<GlobalReceiver>();
    receivers.add(onData);
    this.globalReceivers.set(action, receivers);
    return () => receivers.delete(onData);
  }

  onGlobalCommand(action: string, command: string, data: unknown): void {
    if (action === 'user') this.onUserCommand(command, data);
    else if (action === 'city') this.onCityCommand(command, data);
    else if (action === 'openlock') this.onOpenLock(data);
    else if (action === 'guide' && command === 'getGuidesByGroup') this.guide.onGuides(data);
    else if (action === 'modifypassword') {
      const type = int((data as unknown[] | undefined)?.[0]);
      if (type === 1) gameAlert(i18n('ModifySecondaryPassword_set_succ'));
      else if (type === 2) gameAlert(i18n('ModifySecondaryPassword_update_succ'));
    } else if (action === 'buyanduse' && command === 'showDlg') {
      // The shop row behind a `not_enough_goods` error: open the buy-and-use popup.
      const row = asRow((data as unknown[] | undefined)?.[0]);
      if (row) this.session.buyAndUse = { goods: row };
    }
    for (const receiver of [...(this.globalReceivers.get(action) ?? [])]) receiver(command, data);
  }

  private onUserCommand(command: string, data: unknown): void {
    if (Array.isArray(data)) {
      const d = [...(data as unknown[])];
      if (command === 'loadGlobalData') {
        syncServerTime(int(d.shift()));
        this.global.applyGlobalData(d);
      } else if (command === 'loadUserInfo') {
        this.onLoadUserInfo(d);
      } else if (command === 'loadProvinceInfo') {
        this.global.applyProvinceInfo(d);
        this.session.provinceLoaded = true;
      }
    }
    if (command === 'createRole' || command === 'createCity') this.loadUserInfo();
    if (command === 'createRole') this.session.welcome = true;
    // 旌旗 / 名帖: the reply is the new flag / name; update the store, reload, and report.
    if (command === 'changeUserFlagchar' && Array.isArray(data)) {
      this.user.flagchar = String((data as unknown[])[0] ?? '');
      this.loadUserInfo();
      gameAlert(i18n('_BloodWarSrc_14'));
    } else if (command === 'changeUserName' && Array.isArray(data)) {
      this.user.username = String((data as unknown[])[0] ?? '');
      this.loadUserInfo();
      gameAlert(i18n('_BloodWarSrc_15'));
    }
  }

  private onCityCommand(command: string, data: unknown): void {
    if (command === 'setCityProductRate') {
      gameAlert(i18n('_BloodWarSrc_10'));
    } else if (command === 'changeTax') {
      gameAlert(i18n('_BloodWarSrc_11'));
    } else if (command === 'changeCityName') {
      gameAlert(String((data as unknown[] | undefined)?.[0] ?? ''));
      this.loadUserInfo();
    } else if (command === 'levyResource' || command === 'pacifyPeople') {
      gameAlert(String((data as unknown[] | undefined)?.[0] ?? ''));
    } else if (command === 'getUserCities') {
      this.user.cities = parseCities(data);
    } else if (command === 'discardCity') {
      this.user.cities = parseCities((data as unknown[] | undefined)?.[1]);
    } else if (BUILDING_COMMANDS.has(command)) {
      this.onGetCityBuilding(data);
    } else if (command === 'getCityInfo' && Array.isArray(data)) {
      const session = this.session;
      if (session.screen !== 'game' || (session.view !== 'city' && session.view !== 'world')) {
        session.view = 'cityInner';
      }
      session.screen = 'game';
      this.onGetCityInfo([...(data as unknown[])]);
      if (!session.buildingListOpened && this.city.buildings.length > 0) {
        session.buildingListOpened = true;
        session.showBuildingList = !session.showBuildingList;
        session.showLevel = !session.showLevel;
      }
    }
  }

  /** `BloodWar.onGetCityInfo`. */
  private onGetCityInfo(d: unknown[]): void {
    const base = asRow(d.shift());
    if (!base) return;
    const city = this.city;
    city.cid = int(base.cid);
    city.name = String(base.name ?? '');
    city.type = int(base.type);
    city.spacialSid = int(base.spacialSid);
    city.position = cityPosition(city.cid);
    this.user.cid = city.cid;
    const info = Array.isArray(d[0]) ? [...(d.shift() as unknown[])] : [];
    this.onLoadUser(asRow(info.shift()));
    city.applyResource(asRow(info.shift()));
    this.onLoadHeroList(info.shift());
    city.applySoldiers(info.shift());
    city.applyDefences(info.shift());
    city.alarm = asRow(info.shift());
    city.applyBuildings(d.shift(), this.global.buildingDescriptions);
    this.guide.triggerByBuildings(city.buildings);
    city.applyTechnics(d.shift());
    const where = asRow((d.shift() as unknown[] | undefined)?.[0]);
    city.provinceId = int(where?.province);
    city.junId = int(where?.jun);
  }

  /** `BloodWar.onGetCityInfoCommand`: replies of the CityCommand poll. */
  private onCityInfoCommand(type: number, data: unknown): void {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (type === CityInfoType.Resource) {
      this.onLoadUser(asRow(d.shift()));
      this.city.applyResource(asRow(d.shift()));
      this.city.alarm = asRow(d.shift());
      this.city.skillGoldAdd = int(d.shift());
      d.shift(); // server time for the clock widget, which follows the synchronized offset
      const infoCount = int(d.shift());
      const info = asRow(d.shift());
      if (infoCount > 0 && info && int(info.type) === 0) gameAlert(String(info.info ?? ''), false);
    } else if (type === CityInfoType.Hero) {
      this.onLoadHeroList(d);
    } else if (type === CityInfoType.Army) {
      this.city.applySoldiers(d.shift());
    } else if (type === CityInfoType.Defence) {
      this.city.applyDefences(d.shift());
    } else if (type === CityInfoType.Time) {
      syncServerTime(int(d.shift()));
    }
  }

  /** `BloodWar.onLoadUser`: the user fields refreshed with every city load and poll. */
  private onLoadUser(u: Row | null): void {
    if (!u) return;
    const user = this.user;
    user.prestige = int(u.prestige);
    user.ustate = int(u.state);
    user.money = int(u.money);
    user.gift = int(u.gift);
    user.rank = int(u.rank);
    user.honour = int(u.honour);
    user.openLottery = int(u.openLottery);
    user.officepos = this.officeposName(String(u.officepos ?? '0'));
    user.nobilityPos = int(u.nobility);
    user.nobility = this.nobilityName(String(u.nobility ?? '0'));
    const real = u.real_nobility;
    if (real !== '' && real != null && String(real) !== String(u.nobility)) {
      user.nobility += `(${this.nobilityName(String(real))})`;
    }
    user.isAdult = int(u.isAdult);
    user.onLineTime = int(u.onLineTime);
    this.global.openMapIndex = int(u.openIndex);
    user.designations = Array.isArray(u.designations) ? (u.designations as Row[]) : [];
    const year = asRow(u.currentYear);
    user.yearText = this.yearText(year);
  }

  /** `BloodWar.onLoadHeroList`: the king's level also shows on the portrait. */
  onLoadHeroList(rows: unknown): void {
    this.city.applyHeroes(rows);
    const king = this.city.heroes.find((h) => int(h.herotype) === HERO_TYPE_KING);
    if (king) this.user.kingHeroLevel = int(king.level);
  }

  /** `BloodWar.onGetCityBuilding`: a refreshed building list, which may finish a guide step. */
  onGetCityBuilding(data: unknown): void {
    this.city.applyBuildings(data, this.global.buildingDescriptions);
    this.guide.triggerByBuildings(this.city.buildings);
  }

  /** `BloodWar.getCityBuilding`. */
  refreshBuildings(): void {
    void this.cmd.sendGlobalCommand('city', 'getCityBuilding', [this.user.cid]);
  }

  /** `Command.sendCityCommand(0)`: resources and user fields now rather than at the next poll. */
  refreshResource(): void {
    void this.cmd.sendCityCommand(CityInfoType.Resource);
  }

  // ---- city views (TopPanel / CityInnerPanel / CityPanel) ----

  /** `BloodWar.gotoCityInner` / `gotoCity` / ...: switching scenes closes all dialogs. */
  gotoView(view: View): void {
    this.session.view = view;
    this.session.dialog = null;
    this.session.useGoods = null;
    this.session.shop = null;
    this.session.buyAndUse = null;
    this.session.mail = null;
    this.session.mailDetail = null;
    this.session.mailWrite = null;
  }

  /** `TopPanel.onLevelClick`. */
  toggleShowLevel(): void {
    this.session.showLevel = !this.session.showLevel;
  }

  /** `TopPanel.onBuildClick`. */
  toggleBuildingList(): void {
    this.session.showBuildingList = !this.session.showBuildingList;
  }

  /**
   * Click on a building slot (`CityInnerPanel` / `CityPanel.onMouseDown`): the building dialog
   * for an existing building, otherwise the create dialog of that kind of slot.
   */
  openBuildingSlot(
    slot: { inner: boolean; x: number; y: number },
    kind: number,
    building: BuildingState | undefined,
  ): void {
    if (this.session.dialog) return;
    this.session.currentSlot = slot;
    this.session.dialog = building
      ? { name: 'building', building }
      : { name: 'createBuilding', kind };
  }

  /** `DialogManager.showBuildingListDialog` / `showResourceProductDialog` / ...: replaces any dialog. */
  showDialog(name: PlainDialog): void {
    this.session.dialog = { name };
  }

  /** `TopPanel.onHeroClick` / `DialogManager.showHeroDetailDialog`: the city's heroes reloaded. */
  showHeroDetail(hid = 0): void {
    void this.cmd.sendCityCommand(CityInfoType.Hero);
    this.session.dialog = { name: 'heroDetail', hid };
  }

  /** `DialogManager.showOpenLockDialog`: `action` runs once the server accepts the 2级密码. */
  requestUnlock(type: string, action: () => void): void {
    this.pendingUnlock = { type, action };
    this.session.dialog = { name: 'openLock', type };
  }

  /** `[type, notSetYet, matches]`: an unset password has to be changed first. */
  private onOpenLock(data: unknown): void {
    const d = Array.isArray(data) ? data : [];
    const type = String(d[0] ?? '');
    if (d[1]) {
      void showAlert(i18n('OpenLock_title_no_password'), '', ['yes', 'no']).then((button) => {
        if (button === 'yes') this.showDialog('modifyPassword');
      });
      return;
    }
    if (!d[2]) {
      void showAlert(i18n('OpenLock_title_password_wrong'));
      return;
    }
    const pending = this.pendingUnlock;
    this.pendingUnlock = null;
    if (pending?.type === type) pending.action();
  }

  /** `DialogManager.showBuildingDialog`: switches to another building's dialog. */
  showBuildingDialog(building: BuildingState): void {
    this.session.currentSlot = { inner: building.inner === 1, x: building.x, y: building.y };
    this.session.dialog = { name: 'building', building };
  }

  closeDialog(): void {
    this.session.dialog = null;
  }

  /**
   * `DialogManager.showUseGoodsDialog`: picks an item of `type` to use, over the open dialog.
   * `time` is the time left that the 鲁班传人 / 墨家弟子 price is figured from.
   */
  showUseGoodsDialog(time: number, type: number, param: (number | string)[] = []): void {
    this.session.useGoods = { time, type, param };
  }

  /** `DialogManager.showShopDialog`: opens the 商城 over the scene, optionally on a given tab. */
  showShop(tab?: number): void {
    this.session.shop = { tab };
  }

  closeShop(): void {
    this.session.shop = null;
  }

  /**
   * `BottomPanel.onMailClick` / `DialogManager.showMailDialog`: open the 邮件 dialog. It fetches
   * its own list (`getMail`) on mount and clears the bottom-bar unread blink.
   */
  openMail(): void {
    this.session.mailDetail = null;
    this.session.mailWrite = null;
    this.session.mail = { open: true };
  }

  closeMail(): void {
    this.session.mail = null;
    this.session.mailDetail = null;
    this.session.mailWrite = null;
  }

  /** `MailDialog.showMail`: open the detail dialog for a letter in `page` (one of MAIL_PAGE). */
  showMailDetail(mid: number, page: number): void {
    this.session.mailDetail = { mid, page };
  }

  closeMailDetail(): void {
    this.session.mailDetail = null;
  }

  /**
   * `DialogManager.showMailWriteDialog`: open the compose dialog, optionally pre-filled as a reply
   * (`MailDetailDialog.reply` / `setReceiver`).
   */
  showMailWrite(reply: Record<string, unknown> | null = null, receiver = ''): void {
    this.session.mailWrite = { reply, receiver };
  }

  closeMailWrite(): void {
    this.session.mailWrite = null;
  }

  /** The `[cid, inner, x, y, bid]` building commands, acting on `session.currentSlot`. */
  buildingCommand(command: string, bid: number, targetBid?: number): void {
    const [cid, inner, x, y] = this.slotParam(bid);
    void this.cmd.sendGlobalCommand('city', command, [
      cid,
      inner,
      x,
      y,
      ...(targetBid === undefined ? [] : [targetBid]),
      bid,
    ]);
  }

  /** `startAccerateTechnic`: the 墨家 items for the research of the 书院 on `currentSlot`. */
  accelerateTechnic(timeLeft: number): void {
    this.showUseGoodsDialog(timeLeft, UseGoodsType.Technic, this.slotParam(BUILDING_COLLEGE));
  }

  /** `[City.cid, current_inner, current_x, current_y, bid]`. */
  slotParam(bid: number): [number, number, number, number, number] {
    const slot = this.session.currentSlot;
    return [this.city.cid, slot.inner ? 1 : 0, slot.x, slot.y, bid];
  }

  /**
   * `DialogManager.showBuildingExchangePanel`: without a field (using a 地变符) it reopens for
   * the last one, if any.
   */
  showBuildingExchangePanel(building?: BuildingState): void {
    if (building) this.session.exchange = building;
    if (this.session.exchange) this.session.exchangeOpen = true;
  }

  // ---- main screen timer (InfoPanel.startTimer / onTimer) ----

  private startTimer(): void {
    if (this.secondTimer) return;
    this.pollCountdown = { resource: 15, units: 60, time: 600 };
    this.secondTimer = setInterval(() => this.onSecond(), 1000);
  }

  private stopTimer(): void {
    clearInterval(this.secondTimer);
    this.secondTimer = undefined;
  }

  private onSecond(): void {
    // Before a city is loaded (role creation) every poll would fail the ownership check.
    if (this.user.locked || !this.cmd.open || this.city.cid === 0) return;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const c = this.pollCountdown;
    if (--c.resource < 0) {
      c.resource = 15;
      if (visible) void this.cmd.sendCityCommand(CityInfoType.Resource);
    }
    if (--c.units < 0) {
      c.units = 60;
      if (visible) {
        void this.cmd.sendCityCommand(CityInfoType.Hero);
        void this.cmd.sendCityCommand(CityInfoType.Army);
        void this.cmd.sendCityCommand(CityInfoType.Defence);
      }
    }
    if (--c.time < 0) {
      c.time = 600;
      if (visible) void this.cmd.sendCityCommand(CityInfoType.Time);
    }
    this.city.accrue();
    this.checkBuildingsDue();
  }

  /** A finished upgrade or demolition reloads the buildings, at most once per 5s per slot. */
  private checkBuildingsDue(): void {
    if (this.buildingWait.seconds > 0) this.buildingWait.seconds--;
    const now = serverTime();
    const due = this.city.buildings.find((b) => b.state > 0 && b.state_endtime <= now);
    if (!due) return;
    const slot = `${due.inner}:${due.x}:${due.y}`;
    if (this.buildingWait.seconds > 0 && this.buildingWait.slot === slot) return;
    this.refreshBuildings();
    due.state = 0;
    this.buildingWait = { seconds: 5, slot };
  }

  /** `BloodWar.onLoadUserInfo`. */
  private onLoadUserInfo(d: unknown[]): void {
    const u = asRow(d.shift());
    if (!u) {
      void this.showLogin();
      return;
    }
    const user = this.user;
    user.passport = String(u.passport ?? '');
    user.username = String(u.name ?? '');
    user.honour = int(u.honour);
    user.prestige = int(u.prestige);
    user.rank = int(u.rank);
    user.lastcid = int(u.lastcid);
    user.unionid = int(u.union_id);
    user.unionname = u.unionname == null ? '' : String(u.unionname);
    user.unionpos = int(u.union_pos);
    user.unionPosName = this.unionPosName();
    user.userface = int(u.face);
    user.usersex = int(u.sex);
    user.group = int(u.group);
    user.ustate = int(u.state);
    user.flagchar = String(u.flagchar ?? '');
    user.officepos = this.officeposName(String(u.officepos ?? '0'));
    user.nobilityPos = int(u.nobility);
    user.nobility = this.nobilityName(String(u.nobility ?? '0'));
    const real = u.real_nobility;
    if (real !== '' && real != null && String(real) !== String(u.nobility)) {
      user.nobility += `(${this.nobilityName(String(real))})`;
    }
    this.global.openMapIndex = int(u.openIndex);
    user.curDesigName = typeof u.curDesigName === 'string' ? u.curDesigName : '';
    user.curDesigId = int(u.curDesigid);
    user.locked = false;

    const vacation = asRow(d.shift());
    user.cities = parseCities(d.shift());
    d.shift(); // daily reward already taken: hides the reward button
    user.kingLevel = int(d.shift());
    user.kingHeroLevel = int(d.shift());
    syncServerTime(int(d.shift()));
    user.yearText = this.yearText(asRow(d.shift()));
    this.startTimer();

    if (vacation && int(vacation.vacend) !== 0) {
      // Vacation (休假) dialog is not ported yet; the account stays locked.
      user.ustate = 6;
      user.locked = true;
      void showAlert(i18n('_CommandSrc_2'));
      return;
    }
    if (user.ustate === 3 || user.ustate === 4) {
      this.guide.justCreatedRole = user.ustate === 3;
      this.session.createRoleFirstTime = user.ustate === 3;
      this.session.provinceLoaded = false;
      this.session.screen = 'createRole';
      void this.cmd.sendGlobalCommand('user', 'loadProvinceInfo');
    } else if (user.ustate === 5) {
      void this.showLogin();
    } else {
      this.session.screen = 'game';
      this.switchCity(user.lastcid);
    }
  }

  /** `BloodWar.switchCity`. */
  switchCity(cid: number): void {
    void this.cmd.sendGlobalCommand('city', 'getUserCities');
    void this.cmd.sendGlobalCommand('city', 'getCityInfo', [cid, serverTime()]);
  }

  // ---- role creation (CreateRoleDialog.onSubmit) ----

  createRole(name: string, cityName: string, province: number, sex: number, face: number): void {
    this.cmd.open = true;
    void this.cmd.sendGlobalCommand('user', 'createRole', [
      name,
      cityName,
      province,
      name.slice(0, 1),
      sex,
      face,
      '',
    ]);
  }

  /** `JackarooDialog.openJackaroo`: 我知道了 starts the guide. */
  startGuide(): void {
    this.session.welcome = false;
    void this.cmd.sendGlobalCommand('guide', 'getGuidesByGroup', [1]);
  }

  createCity(cityName: string, province: number): void {
    this.cmd.open = true;
    void this.cmd.sendGlobalCommand('user', 'createCity', [cityName, province]);
  }

  // ---- world map (World/WorldPanel, World/WorldActionDialog, Ground favourites) ----

  /** `WorldPanel.sendGlobalCommand("world", ...)`: a world command whose reply the panel/dialog
   *  picks up through its own `addGlobalReceiver('world', ...)`. */
  sendWorldCommand(command: string, args: CommandArg[] = []): void {
    void this.cmd.sendGlobalCommand('world', command, args);
  }

  /** `WorldPanel.onMouseUp` -> `showSpecialPanel`: open the action dialog for a clicked cell. */
  showWorldAction(cid: number): void {
    this.session.dialog = { name: 'worldAction', cid };
  }

  /** `CampaignFavouritesDialog.loadList`: the 收藏 dialog over the scene. */
  showFavourites(): void {
    this.session.dialog = { name: 'favourites' };
  }

  // ---- errors (Command.onReceivedCommand / faultHandler) ----

  private onFailure(f: CommandFailure): void {
    switch (f.kind) {
      case 'needRefresh':
      case 'invalidAuth':
        this.popGame();
        void showAlert(i18n('_CommandSrc_2')).then(() => window.location.reload());
        break;
      case 'serverUpdating':
        void showAlert(i18n('_CommandSrc_3'));
        this.popGame();
        break;
      case 'notUserCity':
        void showAlert(i18n('_CommandSrc_4'));
        this.loadUserInfo();
        break;
      case 'notEnoughGoods':
        // The shop row is fetched by showDlg; its reply opens the buy-and-use popup.
        void this.cmd.sendGlobalCommand('buyanduse', 'showDlg', [f.gid]);
        break;
      case 'ask':
        break;
      case 'panel':
        gameAlert(f.text);
        break;
      case 'alert':
        void showAlert(f.text);
        break;
    }
  }

  private onFault(silent: boolean): void {
    if (silent || this.showingFault) return;
    this.showingFault = true;
    void showAlert(i18n('_CommandSrc_9')).then(() => (this.showingFault = false));
  }

  // ---- Utils helpers ----

  private officeposName(id: string): string {
    return id === '0' ? i18n('_Utils_26') : (this.global.officeposNames[int(id)] ?? '');
  }

  /** `Utils.getNobilityPos`. */
  nobilityName(id: string): string {
    return id === '0' ? i18n('_Utils_27') : (this.global.nobilityNames[int(id)] ?? '');
  }

  /** `Utils.getUnionPos`. */
  private unionPosName(): string {
    if (this.user.unionid <= 0) return '';
    const keys = ['_Utils_11', '_Utils_41', '_Utils_15', '_Utils_14', '_Utils_13', '_Utils_12'];
    const key = keys[this.user.unionpos];
    return key ? i18n(key) : '';
  }

  /** `mCurYearStr` from the Luoyang campaign year row. */
  private yearText(year: Row | null): string {
    return year && int(year.count) > 0
      ? `${String(year.name ?? '')}${this.luoyangYear(int(year.count))}${i18n('_Utils_1')}`
      : i18n('Report_Announcement_12_1');
  }

  /** `Utils.doParseYear`. */
  private luoyangYear(count: number): string {
    return i18n(count >= 1 && count <= 20 ? `LuoYang_Battle_1_${count + 1}` : 'LuoYang_Battle_1_1');
  }
}

export const GAME_KEY: InjectionKey<Game> = Symbol('game');

export function useGame(): Game {
  const game = inject(GAME_KEY);
  if (!game) throw new Error('Game not provided');
  return game;
}
