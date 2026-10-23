<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import {
  buildTroopResourceString,
  buildTroopSoldiersString,
  CAMPAIGN_TASK_SERVER_ID,
  campaignFoodUse,
  campaignPathTime,
  campaignSoldiers,
  campaignTaskName,
  campaignTotalCarry,
  makeEndTimeString,
  makeTimeLeftString,
  parseTroopMaxTime,
  parseTroopScheme,
  targetFromCid,
  type CampaignResource,
  type CampaignSoldier,
} from '../../game/troop';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useGlobalStore } from '../../stores/global';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Ground/CampaignDialog: the 出征 dialog. Pick a target, a task (侦察/掠夺/占领/运输/派遣), a
 * leading hero, soldiers and resources to carry; the dialog figures the marching time, food cost
 * and remaining carry, then sends `StartTroop` through the 校场. 方案 save/load uses getTroopScheme
 * / setTroopScheme; the max time of a non-驻扎 task is read via ExternService.getTroopMaxTime.
 * 洛阳 (luoyangTroopStart) is not open in single-player, so it shows 暂未开放.
 */
const props = defineProps<{
  groundBid: number;
  groundParam: number;
  targetCid: number;
  taskIndex: number;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const global = useGlobalStore();

const target = targetFromCid(props.targetCid);
const destX = ref(String(target.x));
const destY = ref(String(target.y));
const taskIndex = ref(props.taskIndex);
const heroIndex = ref(0); // 0 = 不带将领
const hourAdd = ref('0');
const minuteAdd = ref('0');
const useFlag = ref(false);
let maxTime = 0;

/** Soldier rows: city army counts joined with cfg_soldier stats (`City.soldierList`). */
const soldiers = reactive<CampaignSoldier[]>(campaignSoldiers(city.soldierCounts, global.soldiers));

/** The five carryable resources, in CampaignDialog order: 黄金/粮食/木材/石料/铁矿. */
const resources = reactive<CampaignResource[]>([
  { name: i18n('Ground_CampaignDialogSrc_1') || '黄金', count: city.gold, takecount: 0 },
  {
    name: i18n('Ground_CampaignDialogSrc_2') || '粮食',
    count: Math.floor(city.food_real),
    takecount: 0,
  },
  {
    name: i18n('Ground_CampaignDialogSrc_3') || '木材',
    count: Math.floor(city.wood_real),
    takecount: 0,
  },
  {
    name: i18n('Ground_CampaignDialogSrc_4') || '石料',
    count: Math.floor(city.rock_real),
    takecount: 0,
  },
  {
    name: i18n('Ground_CampaignDialogSrc_5') || '铁矿',
    count: Math.floor(city.iron_real),
    takecount: 0,
  },
]);

/** 不带将领 + the city's idle, healthy heroes (`loadData`: state 0, hero_health 0). */
const heroes = computed(() => {
  const list: { name: string; hid: number; speed: number }[] = [
    { name: i18n('Ground_CampaignDialogSrc_6') || '不带将领', hid: 0, speed: 0 },
  ];
  for (const h of city.heroes) {
    if (Number(h.state) === 0 && Number(h.hero_health) === 0) {
      list.push({
        name: String(h.name ?? ''),
        hid: Number(h.hid) || 0,
        speed: Number(h.speed_add_on) || 0,
      });
    }
  }
  return list;
});

const taskOptions = computed(() => CAMPAIGN_TASK_SERVER_ID.map((_, i) => campaignTaskName(i)));
const heroOptions = computed(() => heroes.value.map((h) => h.name));

/** `City.getTechnicLevel`. */
const tech = (tid: number) => city.technicLevel(tid);
/** 大道馆 speed multiplier (`mSpeedAddRate`, bid 15 in the original — via sys_building). */
const speedAddRate = computed(() => {
  const dak = city.buildings.find((b) => b.bid === 15);
  return dak ? 1 + dak.level * 0.5 : 1;
});

/** The chosen hero's `speed_add_on` multiplier (`1 + speed_add_on/100`). */
const heroSpeedMul = computed(() => {
  const h = heroes.value[heroIndex.value];
  return 1 + (h?.speed ?? 0) / 100;
});

/**
 * `resetResult`: effective per-soldier speed combining the 行军 techs (12/13/26) by soldier id and
 * the hero speed-add. Mirrors the original's per-type branch (sid<7 uses tech 12, 7/8 tech 13,
 * >=10 tech 13+26).
 */
function soldierSpeed(s: CampaignSoldier): number {
  const marchFast = 1 + tech(12) * 0.1;
  const marchHorse = 1 + tech(13) * 0.05;
  const marchSiege = tech(26) * 0.05;
  const hero = heroSpeedMul.value;
  if (s.sid < 7 && s.sid !== 3) return s.speed * marchFast * hero;
  if (s.sid === 7 || s.sid === 8) return s.speed * marchHorse * hero;
  if (s.sid >= 10 && s.sid <= 12) return s.speed * marchHorse * hero + s.speed * marchSiege;
  return s.speed * marchFast * hero;
}

const addSeconds = computed(
  () => (parseInt(hourAdd.value, 10) || 0) * 3600 + (parseInt(minuteAdd.value, 10) || 0) * 60,
);

const pathTime = computed(() =>
  campaignPathTime({
    fromX: city.cid % 1000,
    fromY: Math.floor(city.cid / 1000),
    targetX: parseInt(destX.value, 10) || 0,
    targetY: parseInt(destY.value, 10) || 0,
    soldiers,
    soldierSpeed,
    taskIndex: taskIndex.value,
    speedAddRate: speedAddRate.value,
    addSeconds: addSeconds.value,
    maxTime,
    beaconHalf: false,
  }),
);

const foodUse = computed(() => campaignFoodUse(soldiers, pathTime.value));
const totalCarry = computed(() => campaignTotalCarry(soldiers, tech(11)));
const takenResource = computed(() => resources.reduce((sum, r) => sum + r.takecount, 0));
const carryLeft = computed(() => totalCarry.value - takenResource.value - foodUse.value);

const now = ref(serverTime());
const arriveLabel = computed(() => makeEndTimeString(now.value + pathTime.value, now.value));
let clockTimer: ReturnType<typeof setInterval> | undefined;

// ---- soldier take helpers (take all / none / one type) ----

function takeAllSoldiers(): void {
  for (const s of soldiers) s.takecount = s.count;
}
function takeNoneSoldiers(): void {
  for (const s of soldiers) s.takecount = 0;
}
function changeSoldier(s: CampaignSoldier, raw: string): void {
  const n = Math.max(0, Math.min(s.count, parseInt(raw, 10) || 0));
  s.takecount = n;
}

// ---- resource take helpers ----

function takeMaxResource(r: CampaignResource): void {
  r.takecount = 0;
  const room = totalCarry.value - takenResource.value - foodUse.value;
  r.takecount = Math.max(0, Math.min(r.count, room));
}
function takeAllResources(): void {
  for (const r of resources) takeMaxResource(r);
}
function takeNoneResources(): void {
  for (const r of resources) r.takecount = 0;
}
function changeResource(r: CampaignResource, raw: string): void {
  r.takecount = Math.max(0, Math.min(r.count, parseInt(raw, 10) || 0));
}

// ---- scheme save / load (getTroopScheme / setTroopScheme, ttype 11 / 12) ----

const schemeOptions = [
  i18n('Ground_CampaignDialog_33_1') || '方案一',
  i18n('Ground_CampaignDialog_33_2') || '方案二',
  i18n('Ground_CampaignDialog_33_3') || '方案三',
];
const schemeIndex = ref(0);

function sendGround(cmd: string, args: CommandArg[], ttype = 0): void {
  game.sendDialogCommand(cmd, props.groundBid, props.groundParam, args, ttype);
}

function changeScheme(index: number): void {
  schemeIndex.value = index;
  if (index === 0) {
    takeNoneSoldiers();
    return;
  }
  sendGround('getTroopScheme', [index], 11);
}

/** `onLoadTroopSchme`: apply a `"n,sid,count,..."` scheme to the soldier takes. */
function applyScheme(data: unknown): void {
  const scheme = parseTroopScheme(data);
  takeNoneSoldiers();
  if (!scheme) return;
  const parts = scheme.soldiers.split(',');
  for (const s of soldiers) {
    for (let i = 1; i + 1 < parts.length; i += 2) {
      if (parseInt(parts[i] ?? '', 10) === s.sid) {
        s.takecount = Math.min(s.count, parseInt(parts[i + 1] ?? '', 10) || 0);
      }
    }
  }
}

function saveScheme(): void {
  const soldiersStr = buildTroopSoldiersString(soldiers);
  if (!soldiersStr) {
    void showAlert(i18n('Ground_CampaignDialog_34_1') || '请先选择出征的士兵');
    return;
  }
  if (schemeIndex.value === 0) {
    void showAlert(i18n('Ground_CampaignDialog_34_2') || '请选择要保存的方案');
    return;
  }
  sendGround('setTroopScheme', [schemeIndex.value, soldiersStr], 12);
}

// ---- StartTroop ----

function startTroop(): void {
  if (target.isLuoyang) {
    void showAlert(i18n('LuoYang_Battle_not_from_luoyang') || '暂未开放');
    return;
  }
  const soldiersStr = buildTroopSoldiersString(soldiers);
  if (!soldiersStr) {
    void showAlert(i18n('Ground_CampaignDialogSrc_10') || '请先选择出征的士兵');
    return;
  }
  const hid = heroes.value[heroIndex.value]?.hid ?? 0;
  const tx = parseInt(destX.value, 10) || 0;
  const ty = parseInt(destY.value, 10) || 0;
  const targetcid = ty * 1000 + tx;
  const task = CAMPAIGN_TASK_SERVER_ID[taskIndex.value] ?? 2;
  const resourceStr = buildTroopResourceString(resources);
  sendGround(
    'StartTroop',
    [hid, targetcid, task, addSeconds.value, soldiersStr, resourceStr, useFlag.value],
    6,
  );
  emit('close');
}

async function onStartClick(): Promise<void> {
  // 占领 (index 2) / 运输 (index 3) require a hero in the original
  if (heroIndex.value === 0 && (taskIndex.value === 2 || taskIndex.value === 3)) {
    void showAlert(i18n('Ground_CampaignDialogSrc_7') || '该任务需要带将领');
    return;
  }
  if (useFlag.value) {
    if (
      (await showAlert(i18n('Ground_CampaignDialogSrc_9') || '确定使用军旗出征？', '', [
        'yes',
        'no',
      ])) === 'yes'
    ) {
      startTroop();
    }
    return;
  }
  startTroop();
}

// ---- max time (ExternService.getTroopMaxTime) ----

async function updateMaxTime(): Promise<void> {
  const tx = parseInt(destX.value, 10) || 0;
  const ty = parseInt(destY.value, 10) || 0;
  const res = await game.callExtern('getTroopMaxTime', [tx, ty]);
  maxTime = parseTroopMaxTime(res);
}

watch([destX, destY], updateMaxTime);

const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === props.groundBid && p === props.groundParam,
  onData(data, ttype) {
    if (ttype === 11) applyScheme(data);
    // ttype 12 (setTroopScheme) answers [message]; ttype 6 (StartTroop) routes through the global
    // failure / alert path, so nothing to handle here.
  },
});

const tc = (n: number) => i18n(`Ground_CampaignDialog_${n}_1`);

onMounted(() => {
  void updateMaxTime();
  clockTimer = setInterval(() => (now.value = serverTime()), 1000);
});
onUnmounted(() => {
  clearInterval(clockTimer);
  unregister();
});
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="241" :y="10" :w="200" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="24"
        :y="2"
        :w="151"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="tc(3) || '出征'"
      />
    </FxCanvas>

    <!-- soldier list (left) -->
    <FxCanvas :x="16" :y="55" :w="314" :h="328" style-name="BoardListUp">
      <FxLabel
        :x="11"
        :y="10"
        style-name="ItemTitle"
        :fx="{ fontSize: 15 }"
        :text="tc(4) || '士兵'"
      />
      <FxButton
        :x="84"
        :y="10"
        :w="60"
        :h="30"
        style-name="ButtonGreen"
        :label="tc(5) || '全选'"
        @click="takeAllSoldiers"
      />
      <FxButton
        :x="148"
        :y="10"
        :w="60"
        :h="30"
        style-name="ButtonGreen"
        :label="tc(6) || '清空'"
        @click="takeNoneSoldiers"
      />

      <div class="soldiers">
        <div v-for="s in soldiers" :key="s.sid" class="srow">
          <span class="sname">{{ s.name }}</span>
          <span class="scount">{{ s.count }}</span>
          <FxTextInput
            :w="60"
            :h="20"
            style-name="EmptyTextInput"
            restrict="0-9"
            :model-value="String(s.takecount)"
            :fx="{ textAlign: 'right' }"
            @update:model-value="changeSoldier(s, $event)"
          />
        </div>
        <div v-if="soldiers.length === 0" class="empty">
          {{ i18n('Ground_CampaignDialogSrc_17') || '城中暂无士兵' }}
        </div>
      </div>
    </FxCanvas>

    <!-- target / task / hero / delay (top-right) -->
    <FxCanvas :x="341" :y="54" :w="326" :h="129" style-name="BoardListDown">
      <FxLabel
        :x="5"
        :y="7"
        style-name="ItemTitle"
        :fx="{ fontSize: 13 }"
        :text="tc(9) || '目标坐标'"
      />
      <FxTextInput
        v-model="destX"
        :x="75"
        :y="6"
        :w="40"
        :h="20"
        style-name="EmptyTextInput"
        restrict="0-9"
        :max-chars="3"
        :fx="{ textAlign: 'center' }"
      />
      <FxTextInput
        v-model="destY"
        :x="120"
        :y="6"
        :w="40"
        :h="20"
        style-name="EmptyTextInput"
        restrict="0-9"
        :max-chars="3"
        :fx="{ textAlign: 'center' }"
      />
      <FxButton
        :x="180"
        :y="4"
        :w="75"
        :h="30"
        style-name="ButtonGreen"
        :label="tc(13) || '收藏'"
        @click="game.showFavourites()"
      />

      <FxLabel
        :x="5"
        :y="37"
        style-name="ItemTitle"
        :fx="{ fontSize: 13 }"
        :text="tc(10) || '任务'"
      />
      <FxComboBox
        v-model:selected-index="taskIndex"
        :x="75"
        :y="35"
        :w="114"
        :items="taskOptions"
      />

      <FxLabel
        :x="5"
        :y="67"
        style-name="ItemTitle"
        :fx="{ fontSize: 13 }"
        :text="tc(11) || '将领'"
      />
      <FxComboBox
        v-model:selected-index="heroIndex"
        :x="75"
        :y="65"
        :w="140"
        :items="heroOptions"
      />

      <FxLabel
        :x="5"
        :y="97"
        style-name="ItemTitle"
        :fx="{ fontSize: 13 }"
        :text="tc(12) || '延迟'"
      />
      <FxTextInput
        v-model="hourAdd"
        :x="75"
        :y="96"
        :w="40"
        :h="20"
        style-name="EmptyTextInput"
        restrict="0-9"
        :max-chars="3"
        :fx="{ textAlign: 'center' }"
      />
      <FxLabel :x="118" :y="98" style-name="ItemValue" :text="tc(19) || '时'" />
      <FxTextInput
        v-model="minuteAdd"
        :x="140"
        :y="96"
        :w="40"
        :h="20"
        style-name="EmptyTextInput"
        restrict="0-9"
        :max-chars="2"
        :fx="{ textAlign: 'center' }"
      />
      <FxLabel :x="183" :y="98" style-name="ItemValue" :text="tc(20) || '分'" />
    </FxCanvas>

    <!-- resources (right) -->
    <FxCanvas :x="341" :y="191" :w="326" :h="192" style-name="BoardListDown">
      <FxLabel
        :x="5"
        :y="7"
        style-name="ItemTitle"
        :fx="{ fontSize: 15 }"
        :text="tc(23) || '携带资源'"
      />
      <FxButton
        :x="181"
        :y="5"
        :w="60"
        :h="30"
        style-name="ButtonGreen"
        :label="tc(21) || '全带'"
        @click="takeAllResources"
      />
      <FxButton
        :x="245"
        :y="5"
        :w="60"
        :h="30"
        style-name="ButtonGreen"
        :label="tc(22) || '不带'"
        @click="takeNoneResources"
      />
      <div class="res">
        <div v-for="r in resources" :key="r.name" class="rrow">
          <span class="rname">{{ r.name }}</span>
          <span class="rcount">{{ r.count }}</span>
          <FxTextInput
            :w="84"
            :h="20"
            style-name="EmptyTextInput"
            restrict="0-9"
            :model-value="String(r.takecount)"
            :fx="{ textAlign: 'right' }"
            @update:model-value="changeResource(r, $event)"
          />
          <FxButton :w="28" :h="20" style-name="MaxValue" @click="takeMaxResource(r)" />
        </div>
      </div>
    </FxCanvas>

    <!-- summary row: path time, arrive time, food use, carry left -->
    <FxLabel :x="138" :y="394" style-name="ItemTitle" :text="tc(24) || '行军时间'" />
    <FxLabel
      :x="208"
      :y="394"
      :w="122"
      style-name="ItemValue"
      :fx="{ textAlign: 'center' }"
      :text="makeTimeLeftString(pathTime)"
    />
    <FxLabel :x="341" :y="394" style-name="ItemTitle" :text="tc(25) || '到达时间'" />
    <FxLabel
      :x="411"
      :y="394"
      :w="119"
      style-name="ItemValue"
      :fx="{ textAlign: 'center' }"
      :text="arriveLabel"
    />
    <FxLabel :x="138" :y="420" style-name="ItemTitle" :text="tc(26) || '消耗粮食'" />
    <FxLabel
      :x="208"
      :y="420"
      :w="122"
      style-name="ItemValue"
      :fx="{ textAlign: 'center' }"
      :text="String(Math.floor(foodUse))"
    />
    <FxLabel :x="341" :y="420" style-name="ItemTitle" :text="tc(27) || '剩余载重'" />
    <FxLabel
      :x="411"
      :y="420"
      :w="119"
      :style-name="carryLeft < 0 ? 'ItemInvalid' : 'ItemValue'"
      :fx="{ textAlign: 'center' }"
      :text="String(Math.floor(carryLeft))"
    />

    <!-- scheme + actions -->
    <FxComboBox
      v-model:selected-index="schemeIndex"
      :x="20"
      :y="451"
      :w="100"
      :items="schemeOptions"
      @change="changeScheme"
    />
    <FxButton
      :x="138"
      :y="446"
      :w="77"
      :h="36"
      style-name="ButtonRed"
      :label="tc(28) || '保存方案'"
      @click="saveScheme"
    />
    <FxButton
      :x="341"
      :y="446"
      :w="77"
      :h="36"
      style-name="ButtonGreen"
      :label="tc(29) || '返回'"
      @click="emit('close')"
    />
    <FxButton
      :x="447"
      :y="446"
      :h="36"
      style-name="ButtonGreen"
      :label="tc(28) || '出征'"
      @click="onStartClick"
    />
    <FxButton
      :x="544"
      :bottom="10"
      :h="36"
      style-name="ButtonRed"
      :label="tc(2) || '返回'"
      @click="emit('close')"
    />
    <FxButton
      :x="612"
      :bottom="10"
      :h="36"
      style-name="ButtonRed"
      :label="tc(1) || '关闭'"
      @click="game.closeCampaign()"
    />
  </FxCanvas>
</template>

<style scoped>
.soldiers,
.res {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 46px;
  bottom: 8px;
  overflow: hidden auto;
}

.srow,
.rrow {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  color: #fff;
}

.sname,
.rname {
  width: 90px;
}

.scount,
.rcount {
  width: 60px;
  text-align: right;
  color: #7cfc00;
}

.empty {
  text-align: center;
  color: #9aa;
  padding-top: 20px;
}
</style>
