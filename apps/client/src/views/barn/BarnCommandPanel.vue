<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import {
  BARN_TABS,
  EMBED_HOLE_POS,
  GOODS_BOLE,
  GOODS_HIGH_LINGTONG,
  GOODS_LINGTONG,
  GOODS_SHIHUANG,
  holeAction,
  horseStrongCheck,
  parseZuojiArmor,
} from '../../game/barn';
import { strongResultText } from '../../game/blacksmith';
import { useGame } from '../../game/game';
import { armorImage } from '../../game/goods';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import ArmorPickGrid from '../armor/ArmorPickGrid.vue';
import UpgradeArmorTab from '../blacksmith/UpgradeArmorTab.vue';
import MyZuojiArmorDialog from './MyZuojiArmorDialog.vue';
import UnActiveHorseDialog from './UnActiveHorseDialog.vue';

/**
 * Barn.BarnCommandDialog: the 粮仓 command dialog — 驯服 (initHoles), 强化 (doStrong on a
 * mount), 镶嵌 (doEmbed / doUnlade of 马装) and 升级 (doUpgradeArmor).
 */
type Row = Record<string, unknown>;
const game = useGame();
const city = useCityStore();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);

const tab = ref<number>(BARN_TABS.Active);

/** loadBarnGoods: gid -> goods row. */
const goods = ref<Record<number, Row>>({});
const useBole = ref(false);
const useShiHuang = ref(false);

/** The tamed mount of the 强化 / 镶嵌 / 升级 tabs, and its picker. */
const horse = shallowRef<Armor | null>(null);
const picking = ref(false);
const horses = shallowRef<Armor[]>([]);
const zuoji = computed(() => (horse.value ? parseZuojiArmor(horse.value.row) : null));

/** 驯服: the untamed mount and its picker. */
const untamed = shallowRef<Armor | null>(null);
const choosingUntamed = ref(false);

/** 镶嵌: the hole whose 马装 is being chosen. */
const embedPos = ref<number | null>(null);

const TAB_BAR = [
  { id: BARN_TABS.Active, label: 'Barn_Active' },
  { id: BARN_TABS.Strong, label: 'Barn_Strong' },
  { id: BARN_TABS.Embed, label: 'Barn_Armor' },
  { id: BARN_TABS.Upgrade, label: 'Barn_Armor_upgrade' },
];

const count = (gid: number) => int(goods.value[gid]?.count);
const highLevel = computed(() => int(horse.value?.row.strong_level) >= 10);

// --------------------------------------------------------------- receivers

const unregister = game.addGlobalReceiver('barn', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadBarnGoods') {
    const map: Record<number, Row> = {};
    for (const g of rowsOf(d.shift())) map[int(g.gid)] = g;
    goods.value = map;
  } else if (command === 'initHoles') {
    untamed.value = null;
    void showAlert(i18n('Barn_ActiveArmorSucc') + int(d[0]));
  } else if (command === 'doStrong') {
    onDoStrong(d);
  } else if (command === 'doEmbed') {
    onDoEmbed(d);
  } else if (command === 'doUnlade') {
    if (int(d.shift()) === 0) {
      d.shift(); // pos
      setPearls(str(d.shift()));
      gameAlert(i18n('Barn_EmbedSucc'));
    }
  }
});

const unregisterArmor = game.addGlobalReceiver('armor', (command, data) => {
  if (command !== 'loadUserPartArmor' || !picking.value || !Array.isArray(data)) return;
  const rest = [...(data as unknown[])];
  horses.value = rowsOf(rest.shift()).map(parseArmor);
  dealWithOtherInfoOfArmor(armorInfo, rest);
});

onMounted(refreshGoods);
onUnmounted(() => {
  unregister();
  unregisterArmor();
});

function refreshGoods() {
  game.sendGlobalCommand('barn', 'loadBarnGoods', [0]);
}

function showTab(t: number) {
  tab.value = t;
  picking.value = false;
  embedPos.value = null;
}

// ----------------------------------------------------------------- picker

/** `showMyArmor(12)`: the player's unworn mounts. */
function pickHorse() {
  picking.value = true;
  horses.value = [];
  game.sendGlobalCommand('armor', 'loadUserPartArmor', [12]);
}

/** `setArmor`: an untamed mount must be tamed first. */
function chooseHorse(a: Armor) {
  picking.value = false;
  if (str(a.row.embed_holes) === '') {
    void showAlert(i18n('Barn_InActiveHorse'));
    return;
  }
  horse.value = a;
}

// ------------------------------------------------------------------ 驯服

/** `doActive` */
function tame() {
  const a = untamed.value;
  if (!a) {
    void showAlert(i18n('Barn_NoHorse'));
    return;
  }
  game.sendGlobalCommand('barn', 'initHoles', [city.cid, a.sid]);
}

// ------------------------------------------------------------------ 强化

/** `doStrong` / `doStrongCommit` */
async function strengthen() {
  const check = horseStrongCheck(
    horse.value?.row ?? null,
    count(GOODS_LINGTONG),
    count(GOODS_HIGH_LINGTONG),
  );
  if (check && 'block' in check) {
    void showAlert(check.block);
    return;
  }
  if (check && (await showAlert(check.confirm, '', ['yes', 'no'])) !== 'yes') return;
  const a = horse.value!;
  game.sendGlobalCommand('barn', 'doStrong', [
    city.cid,
    GOODS_BOLE,
    useBole.value ? 1 : 0,
    GOODS_SHIHUANG,
    useShiHuang.value ? 1 : 0,
    a.sid,
    1,
  ]);
}

function onDoStrong(d: unknown[]) {
  const ok = int(d.shift());
  const a = horse.value;
  if (ok === 1 && a) {
    const result = int(d.shift());
    const row: Row = { ...a.row, strong_value: d.shift() };
    const best = d.shift();
    if (best != null) row.best_quality = best;
    const level = int(a.row.strong_level);
    if (result === 0) {
      void showAlert(strongResultText(0, ''));
      row.strong_level = level + 1;
    } else {
      void showAlert(i18n(`Barn_StrongFailure${result}`));
      if (result === 1) row.strong_level = 0;
      else if (result === 2) row.strong_level = level - 1;
    }
    horse.value = parseArmor(row);
    refreshGoods();
  } else if (ok === 0) {
    horse.value = null;
    void showAlert(str(d.shift()));
  }
}

// ------------------------------------------------------------------ 镶嵌

function setPearls(pearls: string) {
  const a = horse.value;
  if (a) horse.value = parseArmor({ ...a.row, embed_pearls: pearls });
}

/** `selectEmbedZuoji`: a filled hole unlades after confirming; an open one picks a 马装. */
async function selectHole(pos: number) {
  const z = zuoji.value;
  if (!z) {
    void showAlert(i18n('Barn_NoHorse'));
    return;
  }
  const action = holeAction(z, pos);
  if (action.kind === 'unlade') {
    const name = str(z.row[`pearl${pos}name`]);
    if ((await showAlert(i18n('Barn_Unlade') + name, '', ['yes', 'no'])) === 'yes') {
      game.sendGlobalCommand('barn', 'doUnlade', [z.sid, action.gid, pos]);
    }
  } else if (action.kind === 'embed') {
    embedPos.value = pos;
  }
}

/** `doEmbed` */
function embed(row: Row) {
  const a = horse.value;
  const pos = embedPos.value;
  if (!a || pos == null) return;
  game.sendGlobalCommand('barn', 'doEmbed', [a.sid, pos, int(row.gid), 1]);
}

function onDoEmbed(d: unknown[]) {
  const ok = int(d.shift());
  if (ok === 1) {
    if (int(d.shift()) === 0) {
      setPearls(str(d.shift()));
      embedPos.value = null;
      gameAlert(i18n('Barn_EmbedSucc'));
    }
  } else if (ok === 0) {
    horse.value = null;
    embedPos.value = null;
    void showAlert(str(d.shift()));
  }
}
</script>

<template>
  <FxCanvas :x="14" :y="75" :w="650" :h="370" style-name="PopupDialog">
    <FxButton :right="8" :y="6" style-name="Close" @click="game.closeDialog()" />

    <!-- tab bar -->
    <FxCanvas :x="4" :y="8" :w="647" :h="43" style-name="BoardListUp">
      <FxButton
        v-for="(t, i) in TAB_BAR"
        :key="t.id"
        :x="2 + i * 85"
        :y="2"
        :w="74"
        :h="37"
        style-name="ButtonYellow"
        :label="i18n(t.label)"
        :selected="tab === t.id"
        @click="showTab(t.id)"
      />
    </FxCanvas>

    <!-- 驯服 -->
    <FxCanvas
      v-if="tab === BARN_TABS.Active"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxLabel :x="150" :y="30" :w="120" :text="i18n('Barn_HorseSelect')" />
      <FxImage
        v-if="untamed"
        :x="170"
        :y="60"
        :w="64"
        :h="64"
        :source="armorImage(untamed.row)"
        hand
        @click="choosingUntamed = true"
      />
      <FxButton v-else :x="170" :y="60" :w="64" :h="64" label="+" @click="choosingUntamed = true" />
      <FxLabel
        v-if="untamed"
        :x="102"
        :y="128"
        :w="200"
        :fx="{ textAlign: 'center' }"
        :text="str(untamed.row.name)"
      />
      <FxButton
        :x="160"
        :y="210"
        style-name="ButtonYellow"
        :label="i18n('Barn_Active')"
        @click="tame()"
      />
      <FxText :x="440" :y="20" :w="190" :h="270" :html="i18n('Barn_ActiveDesc')" />
    </FxCanvas>

    <!-- 强化 -->
    <FxCanvas
      v-else-if="tab === BARN_TABS.Strong"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxLabel :x="90" :y="10" :w="120" :text="i18n('Barn_ZuojiSelect')" />
      <FxImage
        v-if="horse"
        :x="90"
        :y="40"
        :w="64"
        :h="64"
        :source="armorImage(horse.row)"
        hand
        @click="pickHorse()"
      />
      <FxButton v-else :x="90" :y="40" :w="64" :h="64" label="+" @click="pickHorse()" />
      <FxLabel
        v-if="horse"
        :x="90"
        :y="108"
        :w="160"
        :text="`${str(horse.row.name)} +${int(horse.row.strong_level)}`"
      />
      <FxLabel
        :x="240"
        :y="40"
        :w="200"
        :text="
          highLevel
            ? `${str(goods[GOODS_HIGH_LINGTONG]?.name)}: ${count(GOODS_HIGH_LINGTONG)}`
            : `${str(goods[GOODS_LINGTONG]?.name)}: ${count(GOODS_LINGTONG)}`
        "
      />
      <FxButton
        :x="240"
        :y="80"
        :w="150"
        style-name="ButtonYellow"
        :selected="useBole"
        :label="`${str(goods[GOODS_BOLE]?.name)}(${count(GOODS_BOLE)})`"
        @click="useBole = !useBole"
      />
      <FxButton
        :x="240"
        :y="120"
        :w="150"
        style-name="ButtonYellow"
        :selected="useShiHuang"
        :label="`${str(goods[GOODS_SHIHUANG]?.name)}(${count(GOODS_SHIHUANG)})`"
        @click="useShiHuang = !useShiHuang"
      />
      <FxButton
        :x="160"
        :y="210"
        style-name="ButtonYellow"
        :label="i18n('Barn_Strong')"
        @click="strengthen()"
      />
    </FxCanvas>

    <!-- 镶嵌 -->
    <FxCanvas
      v-else-if="tab === BARN_TABS.Embed"
      :x="4"
      :y="55"
      :w="647"
      :h="310"
      style-name="BoardListUp"
    >
      <FxCanvas :x="10" :y="7" :w="419" :h="257" style-name="BoardListUp">
        <FxImage
          v-if="horse"
          :x="168"
          :y="115"
          :w="64"
          :h="64"
          :source="armorImage(horse.row)"
          hand
          @click="pickHorse()"
        />
        <FxButton v-else :x="168" :y="115" :w="64" :h="64" label="+" @click="pickHorse()" />
        <FxButton
          v-for="(p, pos) in EMBED_HOLE_POS"
          :key="pos"
          :x="p.x"
          :y="p.y"
          :w="32"
          :h="32"
          :label="zuoji && zuoji.pearls[pos] ? '●' : zuoji && zuoji.holes[pos] === 0 ? '○' : '×'"
          @click="selectHole(pos)"
        />
        <FxLabel
          :x="171"
          :y="211"
          :w="79"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Barn_ZuojiSelect')"
        />
      </FxCanvas>
      <FxCanvas :x="438" :y="7" :w="197" :h="255" style-name="BoardListUp">
        <FxText :x="17" :y="10" :w="170" :h="219" :html="i18n('Barn_EmbedDesc')" />
      </FxCanvas>
    </FxCanvas>

    <!-- 升级 -->
    <UpgradeArmorTab
      v-else
      action="barn"
      :armor="horse"
      :goods="goods"
      :desc="i18n('Barn_upgradeArmorDesc')"
      @pick="pickHorse()"
      @replace="horse = $event"
      @refresh="refreshGoods()"
    />

    <!-- mount picker (loadUserPartArmor 12) -->
    <FxCanvas v-if="picking" :x="4" :y="4" :w="642" :h="362" style-name="PopupDialog">
      <FxButton :right="6" :y="6" style-name="Close" @click="picking = false" />
      <FxLabel :x="12" :y="10" :w="200" style-name="ItemTitle" :text="i18n('Barn_HorseSelect')" />
      <ArmorPickGrid :x="3" :y="30" :armors="horses" @pick="chooseHorse" />
    </FxCanvas>

    <UnActiveHorseDialog
      v-if="choosingUntamed"
      @pick="untamed = $event"
      @close="choosingUntamed = false"
    />
    <MyZuojiArmorDialog
      v-if="embedPos !== null && horse"
      :pos="embedPos"
      :armorid="int(horse.row.armorid)"
      @pick="embed"
      @close="embedPos = null"
    />
  </FxCanvas>
</template>
