<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { parseWallInfo, type WallDefenceState } from '../../game/defences';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import WallDefenceItem from './WallDefenceItem.vue';
import WallReinforceItem from './WallReinforceItem.vue';

/** Wall.WallReinforcePanel: the 城墙's queue on the left, its defence types on the right. */
const props = defineProps<{
  x: number;
  y: number;
  /** The reply elements after the two building levels. */
  extra: unknown[];
  /** The 城墙's level: as many waiting entries as levels. */
  level: number;
  now: number;
}>();
const emit = defineEmits<{
  reinforce: [WallDefenceState];
  dissolve: [WallDefenceState];
  cancel: [qid: number];
  accelerate: [qid: number];
  reload: [];
}>();

/** `WallReinforcePanel.DRAFT_ITEM_HEIGHT`: the 50 tall boxes overlap by 5. */
const DRAFT_ITEM_HEIGHT = 45;

const info = computed(() => parseWallInfo(props.extra));
const queue = computed(() => info.value?.queue ?? []);
const building = computed(() => (queue.value[0]?.state === 1 ? queue.value[0] : null));
/** Waiting entries are only shown behind one being built. */
const waiting = computed(() => (building.value ? queue.value.slice(1, props.level + 1) : []));
const boxes = computed(() =>
  Array.from({ length: props.level }, (_, i) => waiting.value[i] ?? null),
);
const currentQueue = computed(() => Math.max(queue.value.length - 1, 0));

/** The built entry's end, from the seconds left when the reply arrived. */
const buildingEnd = ref(0);
watch(
  building,
  (b) => {
    buildingEnd.value = b ? serverTime() + b.time_left : 0;
  },
  { immediate: true },
);
const buildingLeft = computed(() => Math.max(0, buildingEnd.value - props.now));
const allTimeLeft = computed(
  () =>
    (building.value ? buildingLeft.value : 0) +
    waiting.value.reduce((sum, r) => sum + r.time_left, 0),
);

/** `WallReinforcePanel.onTimer`: reloads once the entry is due, then waits 5 seconds. */
let waitSeconds = 0;
watch(
  () => props.now,
  () => {
    if (waitSeconds > 0) waitSeconds--;
    if (building.value && buildingLeft.value <= 0 && waitSeconds <= 0) {
      waitSeconds = 5;
      emit('reload');
    }
  },
);
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="646" :h="314" :fx="{ fontSize: 12, borderStyle: 'solid' }">
    <FxCanvas
      :left="0"
      :top="0"
      :bottom="0"
      :w="226"
      style-name="BoardListUp"
      :fx="{ borderStyle: 'inset' }"
      scroll-y
    >
      <FxCanvas :x="46.25" :y="10" :w="122" :h="45" style-name="BoardListDown">
        <FxLabel
          :x="12"
          :y="2"
          :w="97"
          :fx="{ fontWeight: 'bold', textAlign: 'center' }"
          :text="i18n('Wall_WallReinforcePanel_1_1')"
        />
        <FxLabel
          :x="10"
          :y="21"
          :w="102"
          :fx="{ textAlign: 'center' }"
          :text="timeLeftText(allTimeLeft, i18n)"
        />
      </FxCanvas>
      <FxLabel
        :x="9"
        :y="59"
        :fx="{ color: 3270400, fontWeight: 'bold' }"
        :text="i18n('Wall_WallReinforcePanel_2_1')"
      />
      <FxLabel
        :x="9"
        :y="132"
        :fx="{ color: 16759296, fontWeight: 'bold' }"
        :text="i18n('Wall_WallReinforcePanel_3_1')"
      />
      <WallReinforceItem
        :x="5"
        :y="79"
        :reinforce="building"
        :time-left="buildingLeft"
        :need-text="i18n('Wall_WallReinforcePanelSrc_1')"
        @cancel="emit('cancel', $event)"
        @accelerate="emit('accelerate', $event)"
      />
      <FxCanvas :x="5" :y="155" :w="200" :h="level * DRAFT_ITEM_HEIGHT + 10">
        <WallReinforceItem
          v-for="(r, i) in boxes"
          :key="i"
          :x="0"
          :y="i * DRAFT_ITEM_HEIGHT"
          :reinforce="r"
          :time-left="r?.time_left ?? 0"
          @cancel="emit('cancel', $event)"
          @accelerate="emit('accelerate', $event)"
        />
      </FxCanvas>
      <FxLabel
        :x="111"
        :y="132"
        :w="74"
        :fx="{ textAlign: 'right' }"
        :text="`(${currentQueue}/${level})`"
      />
    </FxCanvas>
    <FxCanvas
      :right="0"
      :top="0"
      :bottom="0"
      :w="408"
      style-name="BoardListUp"
      :fx="{ borderStyle: 'inset' }"
      scroll-y
    >
      <WallDefenceItem
        v-for="(d, i) in info?.defences ?? []"
        :key="d.did"
        :x="7"
        :y="9 + i * 96"
        :defence="d"
        @reinforce="emit('reinforce', $event)"
        @dissolve="emit('dissolve', $event)"
      />
    </FxCanvas>
  </FxCanvas>
</template>
