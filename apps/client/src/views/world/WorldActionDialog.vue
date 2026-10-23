<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
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
import { useUserStore } from '../../stores/user';
import { useWorldStore } from '../../stores/world';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * World/WorldActionDialog (shell): shows the clicked cell's field/city info and wires 收藏
 * (addFavourites) and 标记 (markCity). The army-action buttons (出征 / 侦察 / 掠夺 / 占领 / 运输 /
 * 建城 / 合城 / 管辖) are not ported yet, so they open the shared 暂未开放 placeholder.
 */
const props = defineProps<{ cid: number }>();

const game = useGame();
const user = useUserStore();
const world = useWorldStore();

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

/** The army-action buttons, all deferred to the 暂未开放 placeholder for now. */
const UNPORTED: { key: string; label: string }[] = [
  { key: 'dispatch', label: '出征' },
  { key: 'scout', label: '侦察' },
  { key: 'plunder', label: '掠夺' },
  { key: 'invade', label: '占领' },
  { key: 'transport', label: '运输' },
  { key: 'build', label: '建城' },
  { key: 'merge', label: '合城' },
  { key: 'govern', label: '管辖' },
];

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

    <!-- army-action buttons (暂未开放) -->
    <div v-if="!isSelf" class="actions">
      <FxButton
        v-for="(a, i) in UNPORTED"
        :key="a.key"
        :x="20 + (i % 4) * 90"
        :y="256 + Math.floor(i / 4) * 34"
        :w="80"
        :h="28"
        style-name="ButtonGreen"
        :label="a.label"
        @click="onUnported"
      />
    </div>
    <FxText
      v-if="!isSelf"
      :x="20"
      :y="330"
      :w="360"
      :fx="{ color: 14329120, fontSize: 11 }"
      :text="
        i18n('_CommonSrc_notOpen') ||
        '出征 / 侦察 / 掠夺 / 占领 / 运输 / 建城 / 合城 / 管辖 暂未开放'
      "
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
