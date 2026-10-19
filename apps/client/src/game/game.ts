import type { Pinia } from 'pinia';
import { inject, type InjectionKey } from 'vue';
import { serverTime, syncServerTime } from '../core/clock';
import { i18n } from '../i18n';
import { CommandClient, type CommandFailure } from '../net/command';
import { LoginService, type LoginResult } from '../net/login';
import { useCityStore } from '../stores/city';
import { useGlobalStore } from '../stores/global';
import { useSessionStore } from '../stores/session';
import { parseCities, useUserStore } from '../stores/user';
import { gameAlert, setAlertLabels, showAlert } from '../ui/alert';
import { loadLoginPrefs, saveLoginPrefs, type LoginPrefs } from './loginPrefs';

type Row = Record<string, unknown>;

const QUEUE_POLL_MS = 30_000;

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
  private queueTimer: ReturnType<typeof setInterval> | undefined;
  private showingFault = false;

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
          dialog: () => {},
          city: () => {},
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

  onGlobalCommand(action: string, command: string, data: unknown): void {
    if (action === 'user') this.onUserCommand(command, data);
    else if (action === 'city') this.onCityCommand(command, data);
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
  }

  private onCityCommand(command: string, data: unknown): void {
    if (command === 'getUserCities') {
      this.user.cities = parseCities(data);
    } else if (command === 'getCityInfo' && Array.isArray(data)) {
      const base = asRow(data[0]);
      if (!base) return;
      this.city.cid = int(base.cid);
      this.city.name = String(base.name ?? '');
      this.city.type = int(base.type);
      this.city.position = `(${this.city.cid % 1000},${Math.floor(this.city.cid / 1000)})`;
      this.user.cid = this.city.cid;
    }
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
    const year = asRow(d.shift());
    user.yearText =
      year && int(year.count) > 0
        ? `${String(year.name ?? '')}${this.luoyangYear(int(year.count))}${i18n('_Utils_1')}`
        : i18n('Report_Announcement_12_1');

    if (vacation && int(vacation.vacend) !== 0) {
      // Vacation (休假) dialog is not ported yet; the account stays locked.
      user.ustate = 6;
      user.locked = true;
      void showAlert(i18n('_CommandSrc_2'));
      return;
    }
    if (user.ustate === 3 || user.ustate === 4) {
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

  createCity(cityName: string, province: number): void {
    this.cmd.open = true;
    void this.cmd.sendGlobalCommand('user', 'createCity', [cityName, province]);
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
        // Buy-and-use dialog arrives with the shop (phase 6).
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

  private nobilityName(id: string): string {
    return id === '0' ? i18n('_Utils_27') : (this.global.nobilityNames[int(id)] ?? '');
  }

  /** `Utils.getUnionPos`. */
  private unionPosName(): string {
    if (this.user.unionid <= 0) return '';
    const keys = ['_Utils_11', '_Utils_41', '_Utils_15', '_Utils_14', '_Utils_13', '_Utils_12'];
    const key = keys[this.user.unionpos];
    return key ? i18n(key) : '';
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
