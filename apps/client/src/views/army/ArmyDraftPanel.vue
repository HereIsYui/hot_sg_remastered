<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { parseArmyInfo, type ArmySoldierState } from '../../game/soldiers';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import ArmyDraftItem from './ArmyDraftItem.vue';
import ArmySoldierItem from './ArmySoldierItem.vue';

/** Army.ArmyDraftPanel: the 兵营's queue on the left, its soldier types on the right. */
const props = defineProps<{
  x: number;
  y: number;
  /** The reply elements after the two building levels. */
  extra: unknown[];
  /** The 兵营's level: as many waiting entries as levels. */
  level: number;
  now: number;
}>();
const emit = defineEmits<{
  draft: [ArmySoldierState];
  dissolve: [ArmySoldierState];
  cancel: [qid: number];
  reload: [];
}>();

/** `ArmyDraftPanel.DRAFT_ITEM_HEIGHT` */
const DRAFT_ITEM_HEIGHT = 55;

const info = computed(() => parseArmyInfo(props.extra));
const queue = computed(() => info.value?.queue ?? []);
const training = computed(() => (queue.value[0]?.state === 1 ? queue.value[0] : null));
/** Waiting entries are only shown behind one in training. */
const waiting = computed(() => (training.value ? queue.value.slice(1, props.level + 1) : []));
const boxes = computed(() =>
  Array.from({ length: props.level }, (_, i) => waiting.value[i] ?? null),
);
const currentQueue = computed(() => Math.max(queue.value.length - 1, 0));

/** The training entry's end, from the seconds left when the reply arrived. */
const trainingEnd = ref(0);
watch(
  training,
  (t) => {
    trainingEnd.value = t ? serverTime() + t.time_left : 0;
  },
  { immediate: true },
);
const trainingLeft = computed(() => Math.max(0, trainingEnd.value - props.now));
const allTimeLeft = computed(
  () =>
    (training.value ? trainingLeft.value : 0) +
    waiting.value.reduce((sum, d) => sum + d.time_left, 0),
);

/** `ArmyDraftPanel.onTimer`: reloads once the batch is due, then waits 5 seconds. */
let waitSeconds = 0;
watch(
  () => props.now,
  () => {
    if (waitSeconds > 0) waitSeconds--;
    if (training.value && trainingLeft.value <= 0 && waitSeconds <= 0) {
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
      <FxCanvas :x="50" :y="10" :w="117" :h="45" style-name="BoardListDown">
        <FxLabel
          :x="12"
          :y="2"
          :w="97"
          :fx="{ fontWeight: 'bold', textAlign: 'center' }"
          :text="i18n('Army_ArmyDraftPanel_1_1')"
        />
        <FxLabel
          :x="2"
          :y="21"
          :w="113"
          :fx="{ textAlign: 'center' }"
          :text="timeLeftText(allTimeLeft, i18n)"
        />
      </FxCanvas>
      <FxLabel
        :x="10"
        :y="59"
        :fx="{ color: 2031360, fontWeight: 'bold' }"
        :text="i18n('Army_ArmyDraftPanel_2_1')"
      />
      <FxLabel
        :x="10"
        :y="130"
        :fx="{ color: 16759296, fontWeight: 'bold' }"
        :text="i18n('Army_ArmyDraftPanel_3_1')"
      />
      <ArmyDraftItem
        :x="5"
        :y="79"
        :draft="training"
        :time-left="trainingLeft"
        :need-text="i18n('Army_ArmyDraftPanelSrc_1')"
        @cancel="emit('cancel', $event)"
      />
      <FxCanvas :x="5" :y="150" :w="200" :h="level * DRAFT_ITEM_HEIGHT">
        <ArmyDraftItem
          v-for="(d, i) in boxes"
          :key="i"
          :x="0"
          :y="i * DRAFT_ITEM_HEIGHT"
          :draft="d"
          :time-left="d?.time_left ?? 0"
          @cancel="emit('cancel', $event)"
        />
      </FxCanvas>
      <FxLabel
        :x="122"
        :y="130"
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
      <ArmySoldierItem
        v-for="(s, i) in info?.soldiers ?? []"
        :key="s.sid"
        :x="11"
        :y="13 + i * 96"
        :soldier="s"
        @draft="emit('draft', $event)"
        @dissolve="emit('dissolve', $event)"
      />
    </FxCanvas>
  </FxCanvas>
</template>
