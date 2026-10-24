<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { BUILDING_GROUND } from '../../game/cityGrid';
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

/**
 * World/WorldActionDialog (shell): shows the clicked cell's field/city info and wires 收藏
 * (addFavourites), 标记 (markCity) and the army actions. 出征 / 侦察 / 掠夺 / 占领 / 运输 / 派遣 open
 * the CampaignDialog preset with this cell as the target (task combo indices per the AS3
 * `showCampaignDialog` / `setTask`: 运输=0, 派遣=1, 侦察=2, 掠夺=3, 占领=4); one of the player's own
 * fields shows 进入 (the `onEnterField` 附属野地 detail, where a flatland offers 筑城) instead.
 * 合城 / 管辖 are later waves and stay 暂未开放.
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
 * The army-action buttons. Each opens the CampaignDialog preset with this cell as the target and
 * the matching task combo index (per the AS3 `onPatrol`→2, `onPlunder`→3, `onInvade`→4,
 * `onTransport`→0, `onDispatch`→1; 出征 leaves the combo at its default first item). 合城 / 管辖
 * stay 暂未开放 (building merge / govern are later waves).
 */
const CAMPAIGN_ACTIONS: { key: string; label: string; taskIndex: number }[] = [
  { key: 'dispatch', label: '出征', taskIndex: 0 },
  { key: 'scout', label: '侦察', taskIndex: 2 },
  { key: 'plunder', label: '掠夺', taskIndex: 3 },
  { key: 'invade', label: '占领', taskIndex: 4 },
  { key: 'transport', label: '运输', taskIndex: 0 },
  { key: 'depute', label: '派遣', taskIndex: 1 },
];
const UNPORTED: { key: string; label: string }[] = [
  { key: 'merge', label: '合城' },
  { key: 'govern', label: '管辖' },
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

/** `onSendMessage`: compose a mail to this cell's lord. */
const lordName = computed(() =>
  isCity.value ? (cityInfo.value?.username ?? '') : (field.value?.username ?? ''),
);
function onSendMessage(): void {
  game.showMailWrite(null, lordName.value);
}

function onUnported(): void {
  gameAlert(i18n('_CommonSrc_notOpen') || '暂未开放');
}

const unregister = game.addGlobalReceiver('world', (command, data) => {
  if (command === 'getWorldFieldInfo') field.value = parseWorldFieldInfo(data);
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
    <!-- army-action buttons: campaign targets wired, 合城/管辖 暂未开放 -->
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
      <FxButton
        v-for="(a, i) in UNPORTED"
        :key="a.key"
        :x="20 + ((i + CAMPAIGN_ACTIONS.length) % 4) * 90"
        :y="256 + Math.floor((i + CAMPAIGN_ACTIONS.length) / 4) * 34"
        :w="80"
        :h="28"
        style-name="ButtonGrey"
        :label="a.label"
        @click="onUnported"
      />
    </div>
    <FxText
      v-if="!isSelf && !isOwnField"
      :x="20"
      :y="330"
      :w="360"
      :fx="{ color: 14329120, fontSize: 11 }"
      :text="i18n('_CommonSrc_notOpen') || '合城 / 管辖 暂未开放'"
    />
  </FxCanvas>
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
