<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  CITY_SLOTS,
  isLegalTarget,
  parseLYBattleData,
  type LuoyangCity,
  type LyUserTroop,
} from '../../game/luoyang';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import BattleFiledViewDialog from './BattleFiledViewDialog.vue';
import BattleTroopEmptyItem from './BattleTroopEmptyItem.vue';
import BattleTroopViewDialog from './BattleTroopViewDialog.vue';
import CityNameLabel from './CityNameLabel.vue';
import PathLeavingTime from './PathLeavingTime.vue';
import ViewPointPanel from './ViewPointPanel.vue';

/**
 * LuoYang.LuoYangBattlePanel (`showLuoYangBattlePanel`): the 洛阳战场 map. `getLYBattleData`
 * fills the eleven city slots (cfg_luoyang_city_add), the own troops and the two-hour leaving
 * time; a selected troop + a clicked adjacent city opens the city's troop list
 * (BattleFiledViewDialog → luoyangAttack), a marching troop shows PathLeavingTime, and 查看积分
 * opens ViewPointPanel. 出征 into a city reuses the CampaignDialog with `fromLuoyang`.
 */
const game = useGame();
const user = useUserStore();

const cities = ref<LuoyangCity[]>([]);
const leavingTime = ref(0);
const userTroops = ref<LyUserTroop[]>([]);
const openSecond = ref(0);
const selectedTroop = ref<LyUserTroop | null>(null);
const selectedCity = ref<number | null>(null);
const showFiled = ref(false);
const showTroopDetail = ref(false);
const detailTroop = ref<Record<string, unknown> | null>(null);
const showPoint = ref(false);
const marching = ref<{ hid: number; name: string; time: number } | null>(null);

const formatLeft = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};
const leftText = computed(() => formatLeft(leavingTime.value));
const timer = setInterval(() => {
  if (leavingTime.value > 0) leavingTime.value--;
}, 1000);
onUnmounted(() => clearInterval(timer));

/** `loadInitBattleData`. */
function load(): void {
  game.sendGlobalCommand('LuoYangBattle', 'getLYBattleData');
}
onMounted(load);

const unregister = game.addGlobalReceiver('LuoYangBattle', (command, data) => {
  if (command === 'getLYBattleData') {
    const parsed = parseLYBattleData(data);
    cities.value = parsed.cities;
    leavingTime.value = parsed.leavingTime;
    openSecond.value = parsed.isOpenSecond;
    userTroops.value = parsed.userTroops;
  } else if (command === 'luoyangCityTroops') {
    showFiled.value = true;
  } else if (command === 'luoyangChangeCity') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    const troop = (d.shift() ?? null) as Record<string, unknown> | null;
    gameAlert(String(d.shift() ?? ''));
    if (troop) {
      const local = userTroops.value.find((t) => t.hid === Number(troop.hid));
      if (local) {
        local.cid = Number(troop.cid);
        marching.value = {
          hid: local.hid,
          name: String(local.heroname ?? ''),
          time: Number(troop.pathtime ?? 0),
        };
      }
    }
  } else if (command === 'luoyangYuanjun') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      gameAlert(String(d.shift() ?? ''));
      openSecond.value = 1;
    }
  } else if (command === 'luoyangTroopStart') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      gameAlert(String(d.shift() ?? ''));
      game.closeDialog();
    }
  } else if (command === 'luoyangAttack') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      // `showBattleDialog(battleid, 0, 0, true)` — the 战斗 view of the type-5 battle.
      game.showBattle(Number(d.shift()), true);
    }
  } else if (command === 'luoyangCallbackTroop') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      gameAlert(String(d.shift() ?? ''));
      selectedTroop.value = null;
      marching.value = null;
      load();
    }
  }
});
onUnmounted(unregister);

/** `showBattleFieldDialog(city)`: the troop already in the city views its list, otherwise the
 *  march is confirmed (`luoyangChangeCity [troopId, cid, targetcid]`, AS3:1018-1051). */
function onCityClick(cityInfo: LuoyangCity): void {
  selectedCity.value = cityInfo.cid;
  if (userTroops.value.length === 0) {
    void showAlert(i18n('LuoYang_battle_troop_empty'));
    return;
  }
  if (selectedTroop.value && Number(selectedTroop.value.cid) === cityInfo.cid) {
    game.sendGlobalCommand('LuoYangBattle', 'luoyangCityTroops', [
      Number(cityInfo.cid),
      Number(selectedTroop.value.hid),
    ]);
    return;
  }
  if (!selectedTroop.value) {
    void showAlert(i18n('LuoYang_battle_troop_empty'));
    return;
  }
  void showAlert(
    `${i18n('LuoYang_battle_go_tip').replace('{0}', String(cityInfo.name ?? ''))}`,
    '',
    ['yes', 'no'],
  ).then((button) => {
    if (button !== 'yes' || !selectedTroop.value) return;
    if (marching.value) {
      void showAlert(i18n('LuoYang_Battle_leaveTime_still'));
      return;
    }
    if (!isLegalTarget(cities.value, Number(selectedTroop.value!.cid), Number(cityInfo.cid))) {
      void showAlert(i18n('LuoYang_battle_can_not_pass'));
      return;
    }
    game.sendGlobalCommand('LuoYangBattle', 'luoyangChangeCity', [
      Number(selectedTroop.value!.id),
      Number(selectedTroop.value!.cid),
      Number(cityInfo.cid),
    ]);
  });
}

/** A troop on the map: 选军队 re-selects it, 撤离战场 marches it home (`luoyangChangeCity`). */
function onTroopClick(troop: LyUserTroop): void {
  selectedTroop.value = troop;
}

/** `LuoYangBattlePanel.Button2` → ViewPointPanel. */
function viewPoint(): void {
  showPoint.value = true;
  game.sendGlobalCommand('LuoYangBattle', 'getUnionRankPoint');
}

/** The 援军 (元宝 100, `luoyangYuanjun`) entry when the second troop is still locked. */
function addTroop(): void {
  game.sendGlobalCommand('LuoYangBattle', 'luoyangYuanjun');
}

/** `onAttack` of BattleFiledViewDialog. */
function attack(resistHid: number, cid: number): void {
  if (!selectedTroop.value) return;
  game.sendGlobalCommand('LuoYangBattle', 'luoyangAttack', [
    selectedTroop.value.hid,
    resistHid,
    cid,
  ]);
}

/** 出征: open the CampaignDialog preset for 洛阳 with fromLuoyang (mIsFromLuoYang). */
function dispatchTroop(): void {
  game.showCampaign(0, 0, 215265, 4, true);
}
</script>

<template>
  <FxCanvas :w="736" :h="535" style-name="PopupDialog">
    <FxImage :x="2" :y="1" source="images/luoyangBattle/luoyang_battle_bg.png" />
    <FxCanvas :w="'100%' as never" :h="'100%' as never">
      <CityNameLabel
        v-for="(slot, i) in CITY_SLOTS"
        :key="i"
        :x="slot.x"
        :y="slot.y"
        :index="i"
        :city="cities.find((c) => c.slot === i) ?? null"
        :selected="selectedCity === (cities.find((c) => c.slot === i)?.cid ?? -1)"
        @click="onCityClick($event)"
      />
      <!-- own troop slots -->
      <FxCanvas :x="672" :y="13" :w="63" :h="139">
        <BattleTroopEmptyItem
          v-for="(troop, i) in userTroops.slice(0, 2)"
          :key="troop.hid"
          :y="i * 68"
          :troop="troop"
          :selected="selectedTroop?.hid === troop.hid"
          :user-sex="user.usersex"
          :user-face="user.userface"
          @select="onTroopClick"
        />
        <BattleTroopEmptyItem
          v-if="userTroops.length < 2"
          :y="userTroops.length * 68"
          :troop="null"
          :selected="false"
          :user-sex="user.usersex"
          :user-face="user.userface"
        />
        <FxButton
          v-if="openSecond === 0 && userTroops.length < 2"
          :y="userTroops.length * 68"
          :w="60"
          :h="20"
          style-name="ButtonYellow"
          :fx="{ fontSize: 11 }"
          :tip="i18n('LuoYang_Battle_select_add_troop_tip')"
          @click="addTroop"
        />
      </FxCanvas>
      <FxCanvas :x="297" :y="4" :w="135" :h="26" style-name="BoardListDown">
        <FxLabel
          :w="135"
          :h="26"
          :fx="{ textAlign: 'center', color: 16777215, fontSize: 12, paddingTop: 3 }"
          :text="leftText"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton
      :x="662"
      :y="485"
      :w="71"
      :label="i18n('Guide_Other_2')"
      @click="game.closeDialog()"
    />
    <FxButton
      :x="662"
      :y="435"
      :w="71"
      style-name="ButtonYellow"
      :label="i18n('LuoYang_Battle_view_point')"
      @click="viewPoint"
    />
    <FxButton
      v-if="selectedTroop && selectedTroop.cid === 0"
      :x="560"
      :y="435"
      :w="95"
      style-name="ButtonYellow"
      :fx="{ fontSize: 12 }"
      :label="i18n('Ground_CampaignDialog_3_1')"
      @click="dispatchTroop"
    />
    <PathLeavingTime
      v-if="marching"
      :troop-hid="marching.hid"
      :hero-name="marching.name"
      :leave-time="marching.time"
      @close="marching = null"
    />
    <BattleFiledViewDialog
      v-if="showFiled"
      :city="cities.find((c) => c.cid === selectedCity) ?? null"
      :selected-hid="selectedTroop?.hid ?? 0"
      @attack="attack"
      @detail="(troop) => ((detailTroop = troop), (showTroopDetail = true))"
      @close="showFiled = false"
    />
    <BattleTroopViewDialog
      v-if="showTroopDetail"
      :troop="detailTroop"
      @close="showTroopDetail = false"
    />
    <ViewPointPanel v-if="showPoint" @close="showPoint = false" />
  </FxCanvas>
</template>
