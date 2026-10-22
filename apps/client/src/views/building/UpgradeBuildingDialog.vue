<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { serverTime } from '../../core/clock';
import { parseBuildingInfo, type BuildingInfo } from '../../game/buildings';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import UpgradeBuildingItem from './UpgradeBuildingItem.vue';

/**
 * Building.UpgradeBuildingDialog: the dialog of a building without its own (houses, fields...),
 * and the base of those that have one, which fill the slot with what follows the two levels.
 */
const props = withDefaults(
  defineProps<{ x: number; y: number; h?: number; building: BuildingState }>(),
  { h: 166 },
);
const emit = defineEmits<{
  destroyPanel: [handlers: { all: () => void; level: () => void }];
  /** Every building info reply, after it has been shown. */
  reply: [data: unknown[]];
}>();
defineSlots<{
  default(props: {
    /** The reply elements after the two levels (e.g. the 书院's technic list). */
    extra: unknown[];
    /** The level of the reply's current-level info. */
    level: number;
    now: number;
    /** `sendDialogCommand` addressed to this dialog, as the special dialogs' commands are. */
    send: (cmd: string, args: CommandArg[]) => void;
    reload: () => void;
  }): unknown;
}>();

const game = useGame();
const city = useCityStore();

const state = ref<BuildingState>({ ...props.building });
const current = ref<BuildingInfo | null>(null);
const next = ref<BuildingInfo | null>(null);
const extra = shallowRef<unknown[]>([]);
const now = ref(serverTime());
let waitSeconds = 0;

const title = computed(
  () => `${state.value.bname}${i18n('Building_UpgradeBuildingDialogSrc_1')}${state.value.level})`,
);
const param = computed(() => state.value.y * 10 + state.value.x);

/** `DialogManager.updateBuilding`: a refreshed building list replaces the shown state. */
watch(
  () => city.buildings,
  (list) => {
    const s = state.value;
    const b = list.find(
      (o) => o.bid === s.bid && o.inner === s.inner && o.x === s.x && o.y === s.y,
    );
    if (!b) return;
    // A speed-up finishes the building before the countdown below does.
    const finished = s.state !== 0 && b.state === 0;
    state.value = { ...b };
    if (finished) reloadBuildingInfo();
  },
);

function send(cmd: string, args: CommandArg[]) {
  game.sendDialogCommand(cmd, state.value.bid, param.value, args);
}

function reloadBuildingInfo() {
  const s = state.value;
  send('getBuildingInfo', [s.inner, s.x, s.y, s.bid]);
}

const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === state.value.bid && p === param.value,
  onData(reply, ttype) {
    // A building dialog with its own sibling dialogs (the 客栈's 市井传闻 / 结交名将) shares the
    // (bid, param) address; only the building-info reply (ttype 0) belongs here.
    if (ttype !== 0 || !Array.isArray(reply)) return;
    let data: unknown[] = reply;
    // `ArmyDialog.onBuildingInfo`: dissolveSoldier wraps the reply as `[info, message]`.
    if (data.length === 2 && Array.isArray(data[0])) {
      void showAlert(String(data[1]));
      data = data[0] as unknown[];
    }
    current.value = parseBuildingInfo(data[0]);
    next.value = parseBuildingInfo(data[1]);
    extra.value = data.slice(2);
    emit('reply', data);
  },
});

/** `UpgradeBuildingItem.onTimer`: a finished upgrade or demolition reloads the dialog. */
function onTimer() {
  now.value = serverTime();
  if (waitSeconds > 0) waitSeconds--;
  const s = state.value;
  if (s.state > 0 && s.state_endtime <= now.value && waitSeconds <= 0) {
    waitSeconds = 5;
    game.refreshBuildings();
    state.value = { ...s, state: 0 };
    reloadBuildingInfo();
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  reloadBuildingInfo();
  timer = setInterval(onTimer, 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  unregister();
});
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="682" :h="h" style-name="PanelGreyGreen">
    <FxImage :x="218" :y="11" source="images/title.png" />
    <FxLabel
      :x="266"
      :y="16"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="title"
    />
    <FxButton
      :right="20"
      :bottom="10"
      style-name="Close"
      :fx="{ paddingLeft: 2, paddingRight: 2, fontSize: 16 }"
      @button-down="game.closeDialog()"
    />
    <UpgradeBuildingItem
      :x="18"
      :y="46"
      :state="state"
      :current="current"
      :next="next"
      :now="now"
      @hide="game.closeDialog()"
      @destroy-panel="emit('destroyPanel', $event)"
    />
    <FxButton
      v-if="state.bid < 5 && state.state === 0"
      :x="20"
      :y="120"
      :label="i18n('buildingExchangePanel_change_btn')"
      @click="game.showBuildingExchangePanel(state)"
    />
    <slot
      :extra="extra"
      :level="current?.level ?? 0"
      :now="now"
      :send="send"
      :reload="reloadBuildingInfo"
    />
  </FxCanvas>
</template>
