<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * LuoYang.PathLeavingTime: the marching bar under the map while one of the own troops is en
 * route — 剩余时间 and the countdown (`setTime(pathtime, hid, name, …)`).
 */
const props = defineProps<{ troopHid: number; heroName: string; leaveTime: number }>();

const left = ref(props.leaveTime);
watch(
  () => [props.troopHid, props.leaveTime],
  () => (left.value = props.leaveTime),
);
const timer = setInterval(() => {
  if (left.value > 0) left.value--;
}, 1000);
onUnmounted(() => clearInterval(timer));

const timeText = computed(() => {
  const h = Math.floor(left.value / 3600);
  const m = Math.floor((left.value % 3600) / 60);
  const s = left.value % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${props.heroName} ${pad(h)}:${pad(m)}:${pad(s)}`;
});
</script>

<template>
  <FxCanvas :x="240" :y="26" :w="500" :h="30" style-name="AlertPanel">
    <FxLabel
      :x="2"
      :y="3"
      style-name="ItemTitle"
      :fx="{ fontSize: 13 }"
      :text="i18n('LuoYang_Battle_leaving_time')"
    />
    <FxLabel
      :x="69"
      :y="5"
      :w="421"
      :fx="{ textAlign: 'left', fontSize: 12, color: 16777215 }"
      :text="timeText"
    />
  </FxCanvas>
</template>
