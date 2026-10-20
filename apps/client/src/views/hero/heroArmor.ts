import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import {
  ARMOR_SPARTS,
  armorInfo,
  dealWithOtherInfoOfArmor,
  needsRenovate,
  needsRepair,
  parseArmor,
  renovateCost,
  repairCost,
  type Armor,
} from '../../game/armor';
import { useGame } from '../../game/game';
import type { HeroDetail } from '../../game/hero';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { gameAlert, showAlert } from '../../ui/alert';

/** What `ArmorRenovatePayDialog` is opened with: the command's arguments and its price. */
export interface RenovateRequest {
  all: boolean;
  param: (number | string)[];
  cost: number;
}

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const flag = (v: unknown) => Boolean(v) && v !== '0';

/**
 * The armor half of `HeroDetailDialog` plus `HeroArmorPanel`'s handlers: the worn pieces of the
 * shown hero, the replies of the armor commands, and the confirmations before sending them.
 */
export function useHeroArmor(hero: Ref<HeroDetail | null>) {
  const game = useGame();
  const city = useCityStore();
  const src = (n: number | string) => i18n(`Hero_HeroArmorPanelSrc_${n}`);
  const done = (n: number) => i18n(`Hero_HeroDetailDialogSrc_${n}`);

  /** Worn pieces by `spart`. */
  const armors = ref<Partial<Record<number, Armor>>>({});
  const finishOneTie = ref(false);
  const hasSomeDeified = ref(false);
  const hasArmors = computed(() => Object.keys(armors.value).length > 0);
  const changePart = ref<number | null>(null);
  const renovate = ref<RenovateRequest | null>(null);

  const hid = computed(() => hero.value?.hid ?? 0);
  const healthy = computed(() => hero.value?.healthy ?? false);

  function send(command: string, ...args: (number | string)[]) {
    game.sendGlobalCommand('hero', command, args);
  }

  /** `HeroArmorPanel.onLoadData` */
  function load(list: unknown) {
    const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
    const next: Partial<Record<number, Armor>> = {};
    for (const row of rows) {
      const spart = int(row.spart);
      if (ARMOR_SPARTS.includes(spart) && !next[spart]) next[spart] = parseArmor(row);
    }
    armors.value = next;
  }

  /** `[hid, armors, setComplete, setDeified, ...other info]` */
  function applyHeroArmor(data: unknown) {
    const rest = Array.isArray(data) ? [...(data as unknown[])] : [];
    const owner = int(rest.shift());
    const list = rest.shift();
    const complete = flag(rest.shift());
    const deified = flag(rest.shift());
    if (owner === hid.value) {
      load(list);
      finishOneTie.value = complete;
      hasSomeDeified.value = deified;
    }
    dealWithOtherInfoOfArmor(armorInfo, rest);
  }

  function forEachArmor(fn: (a: Armor) => void) {
    for (const spart of ARMOR_SPARTS) {
      const a = armors.value[spart];
      if (a) fn(a);
    }
  }

  function restore(a: Armor) {
    a.hpMax = a.oriHpMax;
    a.hp = a.hpMax;
  }

  watch(
    hid,
    (id) => {
      armors.value = {};
      finishOneTie.value = false;
      hasSomeDeified.value = false;
      changePart.value = null;
      if (id) send('getHeroArmor', id);
    },
    { immediate: true },
  );

  const unregister = game.addGlobalReceiver('hero', (command, data) => {
    const d = Array.isArray(data) ? (data as unknown[]) : [];
    switch (command) {
      case 'getHeroArmor':
        applyHeroArmor(d);
        break;
      case 'equipArmor':
      case 'offloadArmor':
      case 'offloadAllArmor':
        city.replaceHero(d[0]);
        applyHeroArmor(d[1]);
        break;
      case 'deifyArmor':
        void showAlert(String(d[0] ?? ''));
        city.replaceHero(d[1]);
        applyHeroArmor(d[2]);
        break;
      case 'repairArmor': {
        forEachArmor((a) => {
          if (a.sid === int(d[0])) {
            a.hpMax = int(d[1]);
            a.hp = a.hpMax;
          }
        });
        if (int(d[2]) === city.cid) city.gold = int(d[3]);
        gameAlert(done(5));
        break;
      }
      case 'renovateArmor':
      case 'renovateArmorWithGift':
        forEachArmor((a) => {
          if (a.sid === int(d[0])) restore(a);
        });
        gameAlert(done(6));
        break;
      case 'repairAllArmor':
        if (int(d[0]) === hid.value) send('getHeroArmor', hid.value);
        if (int(d[1]) === city.cid) city.gold = int(d[2]);
        gameAlert(done(7));
        break;
      case 'renovateAllArmor':
      case 'renovateAllArmorWithGift':
        if (int(d[0]) === hid.value) forEachArmor(restore);
        gameAlert(done(8));
        break;
    }
  });
  onUnmounted(unregister);

  /** The slot menu's 装备 / 卸下 / 修理 / 修复. */
  async function onSlotAction(action: string, spart: number) {
    const h = hero.value;
    if (!h) return;
    const a = armors.value[spart];
    if (action === 'equip') {
      changePart.value = spart;
    } else if (action === 'offload') {
      send('offloadArmor', h.hid, spart);
    } else if (action === 'repair' && a) {
      if (!needsRepair(a)) {
        void showAlert(src(7));
      } else if ((await showAlert(src(5) + repairCost(a) + src(6), '', ['yes', 'no'])) === 'yes') {
        send('repairArmor', city.cid, a.sid);
      }
    } else if (action === 'renovate' && a) {
      if (needsRenovate(a)) renovate.value = { all: false, param: [a.sid], cost: renovateCost(a) };
      else void showAlert(src(10));
    }
  }

  function unhealthy(): boolean {
    if (healthy.value) return false;
    gameAlert(src(18));
    return true;
  }

  /** `onClickRepairAll` */
  async function onRepairAll() {
    if (unhealthy()) return;
    const sids: number[] = [];
    let cost = 0;
    forEachArmor((a) => {
      if (needsRepair(a)) {
        sids.push(a.sid);
        cost += repairCost(a);
      }
    });
    if (cost === 0) {
      void showAlert(src(13));
    } else if ((await showAlert(src(11) + cost + src(12), '', ['yes', 'no'])) === 'yes') {
      send('repairAllArmor', city.cid, hid.value, sids.join(','));
    }
  }

  /** `onClickRenovateAll` */
  function onRenovateAll() {
    if (unhealthy()) return;
    const sids: number[] = [];
    let cost = 0;
    forEachArmor((a) => {
      if (needsRenovate(a)) {
        sids.push(a.sid);
        cost += renovateCost(a);
      }
    });
    if (cost === 0) void showAlert(src(16));
    else renovate.value = { all: true, param: [hid.value, sids.join(',')], cost };
  }

  /** `onClickOffloadArmor` */
  async function onOffloadAll() {
    if (unhealthy()) return;
    if ((await showAlert(src(24), '', ['yes', 'no'])) === 'yes') send('offloadAllArmor', hid.value);
  }

  /** `onClickDeifyArmor` */
  async function onDeify() {
    if (unhealthy()) return;
    const text = src(hasSomeDeified.value ? '17_2' : '17_1');
    if ((await showAlert(text, '', ['yes', 'no'])) === 'yes') send('deifyArmor', hid.value);
  }

  /** `ChangeArmorDialog.onClickArmor` passed the checks. */
  function equip(sid: number, spart: number) {
    send('equipArmor', hid.value, sid, spart);
  }

  /** `ArmorRenovatePayDialog.onSubmit` for a hero's piece or pieces. */
  function payRenovation(req: RenovateRequest, byGift: boolean) {
    const command = (req.all ? 'renovateAllArmor' : 'renovateArmor') + (byGift ? 'WithGift' : '');
    send(command, ...req.param);
  }

  return {
    armors,
    finishOneTie,
    hasSomeDeified,
    hasArmors,
    healthy,
    changePart,
    renovate,
    unhealthy,
    onSlotAction,
    onRepairAll,
    onRenovateAll,
    onOffloadAll,
    onDeify,
    equip,
    payRenovation,
  };
}

export type HeroArmorState = ReturnType<typeof useHeroArmor>;
