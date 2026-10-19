import { defineStore } from 'pinia';

type Row = Record<string, unknown>;

const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

function mapOf(rows: Row[], key: string, value: string): Record<number, string> {
  const map: Record<number, string> = {};
  for (const r of rows) map[Number(r[key])] = String(r[value] ?? '');
  return map;
}

/** Static game data and server settings of `Global`, filled by user/loadGlobalData. */
export const useGlobalStore = defineStore('global', {
  state: () => ({
    loaded: false,
    buildingNames: {} as Record<number, string>,
    buildingDescriptions: {} as Record<number, string>,
    technicNames: {} as Record<number, string>,
    soldiers: [] as Row[],
    soldierNames: {} as Record<number, string>,
    defences: [] as Row[],
    defenceNames: {} as Record<number, string>,
    heroUpgradeExp: {} as Record<number, number>,
    heroTotalExp: {} as Record<number, number>,
    thingsNames: {} as Record<number, string>,
    countDesc: [] as Row[],
    officeposNames: {} as Record<number, string>,
    nobilityNames: {} as Record<number, string>,
    chatHost: '',
    chatPort: 0,
    machineMark: '',
    serverName: '',
    battlenetEnabled: false,
    chibinetEnabled: false,
    yysType: 0,
    openMapIndex: 0,
    /** loadProvinceInfo: per province (1..13) users, occupied cities, city slots. */
    provinceUsers: [] as number[],
    provinceCities: [] as number[],
    provinceLands: [] as number[],
  }),
  actions: {
    /** `BloodWar.onLoadGlobalData` (the server timestamp is consumed by the caller). */
    applyGlobalData(data: unknown[]): void {
      const d = [...data];
      const buildings = rowsOf(d.shift());
      this.buildingNames = mapOf(buildings, 'bid', 'name');
      this.buildingDescriptions = mapOf(buildings, 'bid', 'description');
      this.technicNames = mapOf(rowsOf(d.shift()), 'tid', 'name');
      this.soldiers = rowsOf(d.shift());
      this.soldierNames = mapOf(this.soldiers, 'sid', 'name');
      this.defences = rowsOf(d.shift());
      this.defenceNames = mapOf(this.defences, 'did', 'name');
      const levels = rowsOf(d.shift());
      this.heroUpgradeExp = Object.fromEntries(
        levels.map((r) => [Number(r.level), Number(r.upgrade_exp)]),
      );
      this.heroTotalExp = Object.fromEntries(
        levels.map((r) => [Number(r.level), Number(r.total_exp)]),
      );
      this.thingsNames = mapOf(rowsOf(d.shift()), 'tid', 'name');
      this.countDesc = rowsOf(d.shift());
      this.officeposNames = mapOf(rowsOf(d.shift()), 'id', 'name');
      this.nobilityNames = mapOf(rowsOf(d.shift()), 'id', 'name');
      this.chatHost = String(d.shift() ?? '');
      this.chatPort = parseInt(String(d.shift())) || 0;
      this.machineMark = String(d.shift() ?? '');
      this.serverName = String(d.shift() ?? '');
      this.battlenetEnabled = Boolean(d.shift());
      d.shift();
      d.shift();
      this.chibinetEnabled = Boolean(d.shift());
      d.shift();
      d.shift();
      this.yysType = parseInt(String(d.shift())) || 0;
      this.loaded = true;
    },
    applyProvinceInfo(data: unknown[]): void {
      const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => parseInt(String(x)) || 0) : []);
      this.provinceUsers = nums(data[0]);
      this.provinceCities = nums(data[1]);
      this.provinceLands = nums(data[2]);
    },
  },
});
