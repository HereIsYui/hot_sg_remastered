<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { BUILDING_GOVERNMENT, BUILDING_GROUND } from '../../game/cityGrid';
import { governBlockAlert, governGate, parseGovernInfo, type GovernInfo } from '../../game/govern';
import {
  cid2wid,
  makeCid,
  parseWorldFieldInfo,
  provinceName,
  worldStateName,
  worldTypeName,
  type WorldFieldInfo,
} from '../../game/world';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useUserStore } from '../../stores/user';
import { useWorldStore } from '../../stores/world';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import GovernPanel from './GovernPanel.vue';

/**
 * World/WorldActionDialog (shell): shows the clicked cell's field/city info and wires 收藏
 * (addFavourites), 标记 (markCity) and the army actions. 出征 / 侦察 / 掠夺 / 占领 / 运输 / 派遣 open
 * the CampaignDialog preset with this cell as the target (task combo indices per the AS3
 * `showCampaignDialog` / `setTask`: 运输=0, 派遣=1, 侦察=2, 掠夺=3, 占领=4); one of the player's own
 * fields shows 进入 (the `onEnterField` 附属野地 detail, where a flatland offers 筑城) instead.
 * 管辖 (`onGovern`) opens the embedded GovernPanel for a 名城 owner; an own city offers 合城
 * (`showMergeCityDialog`, which preselects it as the 分城).
 */
const props = defineProps<{ cid: number }>();

const game = useGame();
const user = useUserStore();
const world = useWorldStore();
const city = useCityStore();

const t = (n: number) => i18n(`World_WorldActionDialogSrc_${n}`);

const cell = computed(() => world.cells.get(props.cid));
const cityInfo = computed(() => world.cityInfo.get(props.cid));
/** getWorldFieldInfo reply for a field cell (type > 0). */
const field = ref<WorldFieldInfo | null>(null);

const isCity = computed(() => cell.value?.type === 0);

/** `WorldActionDialog.setGridInfo`: the title line. */
const title = computed(() => {
  if (isCity.value) return cityInfo.value?.cityname || makeCid(props.cid);
  return worldTypeName(cell.value?.type ?? 1);
});

const ownerName = computed(() => {
  if (isCity.value) return cityInfo.value?.username || t(19);
  return field.value?.username || t(19);
});
const unionName = computed(() => {
  const n = isCity.value ? cityInfo.value?.unionname : field.value?.unionname;
  return !n || n === 'null' ? t(10) : n;
});
const prestige = computed(() => {
  const p = isCity.value ? cityInfo.value?.prestige : field.value?.prestige;
  return p ? String(p) : '';
});
const stateName = computed(() => worldStateName(cell.value?.state ?? 0));
const provName = computed(() => provinceName(cell.value?.provinceid ?? 0));
const levelText = computed(() => String(cell.value?.level ?? 0));

/** `User.canMark()`: union officer (pos >= 4) can mark a famous city. */
const canMark = computed(
  () => user.unionid > 0 && user.unionpos >= 4 && (cityInfo.value?.citytype ?? 0) > 0,
);
/** Own cell: no hostile actions, only 收藏. */
const isSelf = computed(
  () => cityInfo.value?.flag === 0 || (isCity.value && cityInfo.value?.uid === user.uid),
);

/**
 * `setGridInfo` (AS3 2933-3013): the 管辖 (label 政令, `World_WorldActionDialog_45_1`) button shows
 * on city cells whose relationship flag is 2..8 — not for self (0), allies (1) or the 洛阳 overlay (9).
 */
const canGovern = computed(() => {
  const flag = cityInfo.value?.flag ?? -1;
  return isCity.value && flag >= 2 && flag <= 8;
});

/** `City.govermentLevel` (BloodWar.as:8083-8085): the 官府 (bid 6) building level, 0 without one. */
const govermentLevel = computed(
  () => city.buildings.find((b) => b.bid === BUILDING_GOVERNMENT)?.level ?? 0,
);

/**
 * The army-action buttons. Each opens the CampaignDialog preset with this cell as the target and
 * the matching task combo index (per the AS3 `onPatrol`→2, `onPlunder`→3, `onInvade`→4,
 * `onTransport`→0, `onDispatch`→1; 出征 leaves the combo at its default first item). 管辖 is the
 * GovernPanel (`onGovern`); an own city offers 合城 (`showMergeCityDialog`).
 */
const CAMPAIGN_ACTIONS: { key: string; label: string; taskIndex: number }[] = [
  { key: 'dispatch', label: '出征', taskIndex: 0 },
  { key: 'scout', label: '侦察', taskIndex: 2 },
  { key: 'plunder', label: '掠夺', taskIndex: 3 },
  { key: 'invade', label: '占领', taskIndex: 4 },
  { key: 'transport', label: '运输', taskIndex: 0 },
  { key: 'depute', label: '派遣', taskIndex: 1 },
];

/** One of the player's own fields (`getUserFields`): the original shows only 派遣 + 进入. */
const isOwnField = computed(() => !isCity.value && world.userFieldCids.includes(props.cid));

/** `onEnterField` (AS3 2281-2285): the 附属野地 list opened on this field's detail. */
function onEnterField(): void {
  game.closeDialog();
  game.showCityFieldDialog(cell.value?.wid ?? cid2wid(props.cid));
}

/** `WorldActionDialog.showCampaignDialog`: open 出征 from the current city's 校场 at this target. */
function onCampaign(taskIndex: number): void {
  const ground = city.buildings.find((b) => b.bid === BUILDING_GROUND && b.level > 0);
  if (!ground) {
    gameAlert(i18n('World_WorldActionDialogSrc_noground') || '需要先建造校场');
    return;
  }
  game.closeDialog();
  game.showCampaign(ground.bid, ground.y * 10 + ground.x, props.cid, taskIndex);
}

function onAddFavourites(): void {
  // addFavourites throws its result as a `**`/plain message -> handled by the global failure path
  game.sendWorldCommand('addFavourites', [props.cid]);
}

async function onMark(): Promise<void> {
  if (
    (await showAlert(i18n('World_WorldActionDialog_Mark_1') || '确定标记该城池？', '', [
      'yes',
      'no',
    ])) === 'yes'
  ) {
    game.sendWorldCommand('markCity', [props.cid]);
  }
}

/**
 * `mGovernPanel` (AS3 167, 2654-2665): the embedded 下达政令 pop-up, hidden (null) until the
 * `getGovernInfo` reply allows it — the original toggles `mGovernPanel.visible` the same way.
 */
const governInfo = ref<GovernInfo | null>(null);

/** `onGovern` (AS3 2489-2536): the client-side gates, then `getGovernInfo [City.cid]`. */
function onGovern(): void {
  const gate = governGate(
    {
      cid: city.cid,
      type: city.type,
      govermentLevel: govermentLevel.value,
      junId: city.junId,
      provinceId: city.provinceId,
    },
    { cid: props.cid, junid: cell.value?.junid ?? 0, provinceid: cell.value?.provinceid ?? 0 },
  );
  if (gate) {
    void showAlert(i18n(gate));
    return;
  }
  game.sendWorldCommand('getGovernInfo', [city.cid]);
}

/** `WorldPanel.as:9334-9348` (getGovernInfo reply): `setGovernInfo` + `setFlag(1)`. */
function onGetGovernInfo(data: unknown): void {
  const info = parseGovernInfo(data);
  const block = governBlockAlert(city.type, info);
  if (block) {
    void showAlert(block);
    return;
  }
  governInfo.value = info;
}

/** `onSendMessage`: compose a mail to this cell's lord. */
const lordName = computed(() =>
  isCity.value ? (cityInfo.value?.username ?? '') : (field.value?.username ?? ''),
);
function onSendMessage(): void {
  game.showMailWrite(null, lordName.value);
}

const unregister = game.addGlobalReceiver('world', (command, data) => {
  if (command === 'getWorldFieldInfo') field.value = parseWorldFieldInfo(data);
  else if (command === 'getGovernInfo') onGetGovernInfo(data);
});

onMounted(() => {
  // a field cell loads its detail; a city uses the already-loaded getWorldCityInfo row
  if (!isCity.value) game.sendWorldCommand('getWorldFieldInfo', [cid2wid(props.cid)]);
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="168" :y="98" :w="400" :h="360" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxButton
      style-name="Close"
      :right="16"
      :top="12"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <FxCanvas :x="143" :y="16" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="114"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="title"
      />
    </FxCanvas>

    <!-- info panel -->
    <FxCanvas :x="20" :y="54" :w="360" :h="150" style-name="BoardListDown" :fx="{ fontSize: 12 }">
      <FxText :x="12" :y="10" :w="336" :fx="{ color: 16777215 }" :text="`坐标：${makeCid(cid)}`" />
      <FxText
        :x="12"
        :y="32"
        :w="336"
        :fx="{ color: 16777215 }"
        :text="`地形：${worldTypeName(cell?.type ?? 1)}  等级：${levelText}`"
      />
      <FxText :x="12" :y="54" :w="336" :fx="{ color: 16777215 }" :text="`州郡：${provName}`" />
      <FxText :x="12" :y="76" :w="336" :fx="{ color: 16777215 }" :text="`状态：${stateName}`" />
      <template v-if="isCity || field">
        <FxText :x="12" :y="98" :w="336" :fx="{ color: 16777215 }" :text="`城主：${ownerName}`" />
        <FxText
          :x="12"
          :y="120"
          :w="336"
          :fx="{ color: 16777215 }"
          :text="`联盟：${unionName}  声望：${prestige}`"
        />
      </template>
    </FxCanvas>

    <!-- 收藏 / 标记 -->
    <FxButton
      :x="20"
      :y="214"
      :w="80"
      :h="26"
      style-name="ButtonGreen"
      :label="i18n('World_WorldActionDialogSrc_6') || '收藏'"
      @click="onAddFavourites"
    />
    <FxButton
      v-if="canMark"
      :x="110"
      :y="214"
      :w="80"
      :h="26"
      style-name="ButtonRed"
      :label="i18n('World_WorldActionDialog_Mark_btn') || '标记'"
      @click="onMark"
    />

    <FxButton
      v-if="!isSelf && lordName"
      :x="200"
      :y="214"
      :w="80"
      :h="26"
      style-name="ButtonGreen"
      label="写信"
      @click="onSendMessage"
    />

    <!-- own field: 进入 (the detail dialog, where a flatland offers 筑城) + 派遣 -->
    <div v-if="isOwnField" class="actions">
      <FxButton
        :x="20"
        :y="256"
        :w="80"
        :h="28"
        style-name="ButtonGreen"
        :label="i18n('World_WorldActionDialog_40_1') || '进入'"
        @click="onEnterField"
      />
      <FxButton
        :x="110"
        :y="256"
        :w="80"
        :h="28"
        style-name="ButtonGreen"
        :label="i18n('World_WorldActionDialog_38_1') || '派遣'"
        @click="onCampaign(1)"
      />
    </div>
    <!-- army-action buttons: campaign targets wired, 管辖 opens GovernPanel -->
    <div v-else-if="!isSelf" class="actions">
      <FxButton
        v-for="(a, i) in CAMPAIGN_ACTIONS"
        :key="a.key"
        :x="20 + (i % 4) * 90"
        :y="256 + Math.floor(i / 4) * 34"
        :w="80"
        :h="28"
        style-name="ButtonGreen"
        :label="a.label"
        @click="onCampaign(a.taskIndex)"
      />
      <!-- 管辖 (`govern`, AS3 1557): city cells with relationship flag 2..8 -->
      <FxButton
        v-if="canGovern"
        :x="20 + (CAMPAIGN_ACTIONS.length % 4) * 90"
        :y="256 + Math.floor(CAMPAIGN_ACTIONS.length / 4) * 34"
        :w="80"
        :h="28"
        style-name="ButtonGreen"
        :label="i18n('World_WorldActionDialog_45_1') || '政令'"
        @click="onGovern"
      />
    </div>
    <!-- own city: 合城 (`showMergeCityDialog`, AS3 2249-2253) preselects it as the 分城 -->
    <div v-else-if="isCity" class="actions">
      <FxButton
        :x="150"
        :y="256"
        :w="80"
        :h="28"
        style-name="ButtonGreen"
        :label="i18n('World_WorldActionDialog_47_1') || '合城'"
        @click="game.showCityMergeDialog(cid)"
      />
    </div>
  </FxCanvas>
  <!-- `mGovernPanel` (AS3 2654-2665): the embedded 下达政令 pop-up covering the dialog area -->
  <GovernPanel
    v-if="governInfo"
    :target-cid="cid"
    :target-uid="cityInfo?.uid ?? 0"
    :info="governInfo"
    @close="governInfo = null"
  />
</template>

<style scoped>
.actions {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.actions > :deep(*) {
  pointer-events: auto;
}
</style>
