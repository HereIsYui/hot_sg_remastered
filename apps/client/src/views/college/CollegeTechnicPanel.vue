<script setup lang="ts">
import { computed, watch } from 'vue';
import { parseTechnicInfo, type TechnicState } from '../../game/technics';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import CollegeTechnicItem from './CollegeTechnicItem.vue';
import UpgradeTechItem from './UpgradeTechItem.vue';

/** College.CollegeTechnicPanel: research in this and the other 书院, and every technic. */
const props = defineProps<{
  x: number;
  y: number;
  /** `onLoadTechnicInfo`'s argument: the reply element after the two building levels. */
  raw: unknown;
  now: number;
}>();
const emit = defineEmits<{ start: [tid: number]; stop: [tid: number]; reload: [] }>();

const city = useCityStore();

const info = computed(() => parseTechnicInfo(props.raw));
const technics = computed(() => info.value?.technics ?? []);
const collegeCount = computed(() => info.value?.collegeCount ?? 0);
const researching = computed(() => technics.value.filter((t) => t.state === 1));
const mine = computed(() => researching.value.find((t) => t.cid === city.cid) ?? null);
/** One box per other 书院, filled in list order with the research of the other cities. */
const others = computed(() => {
  const list = researching.value.filter((t) => t.cid !== city.cid);
  return Array.from(
    { length: Math.max(0, collegeCount.value - 1) },
    (_, i): TechnicState | null => list[i] ?? null,
  );
});

/** `CollegeTechnicItem.onTimer`: reloads once a research is due, then waits 5 seconds. */
let waitSeconds = 0;
watch(
  () => props.now,
  () => {
    if (waitSeconds > 0) waitSeconds--;
    const due = researching.value.some((t) => t.state_endtime <= props.now);
    if (due && waitSeconds <= 0) {
      waitSeconds = 5;
      emit('reload');
    }
  },
);
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="646" :h="314" style-name="BoardListUp" :fx="{ fontSize: 12 }">
    <FxCanvas
      :left="0"
      :top="0"
      :bottom="0"
      :w="226"
      style-name="BoardListDown"
      :fx="{ borderStyle: 'inset' }"
      scroll-y
    >
      <FxLabel
        :x="5"
        :y="6"
        :text="`${i18n('College_CollegeTechnicPanel_1_1')}${collegeCount}${i18n('College_CollegeTechnicPanel_1_2')}`"
      />
      <FxLabel :x="5" :y="27" :text="i18n('College_CollegeTechnicPanel_2_1')" />
      <UpgradeTechItem
        :x="5"
        :y="48"
        :technic="mine"
        :cid="city.cid"
        :now="now"
        @cancel="emit('stop', $event)"
      />
      <FxLabel :x="9" :y="98" :text="i18n('College_CollegeTechnicPanel_3_1')" />
      <FxCanvas :x="5" :y="119" :w="200" :h="others.length * 55 + 20">
        <UpgradeTechItem
          v-for="(t, i) in others"
          :key="i"
          :x="0"
          :y="2 + i * 55"
          :technic="t"
          :cid="city.cid"
          :now="now"
        />
      </FxCanvas>
    </FxCanvas>
    <FxCanvas
      :right="0"
      :top="0"
      :bottom="0"
      :w="408"
      style-name="BoardListDown"
      :fx="{ borderStyle: 'inset' }"
      scroll-y
    >
      <CollegeTechnicItem
        v-for="(t, i) in technics"
        :key="t.tid"
        :x="8"
        :y="10 + i * 82"
        :technic="t"
        :now="now"
        @start="emit('start', $event)"
        @stop="emit('stop', $event)"
      />
    </FxCanvas>
  </FxCanvas>
</template>
