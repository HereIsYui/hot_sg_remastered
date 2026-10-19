<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../assets/registry';
import { boxStyle } from './skin';
import { vTip, type TipValue } from './tooltip';

/** mx.controls.Image: natural size unless sized explicitly (then scaled to fit, as Flex does). */
const props = defineProps<{
  source?: string | null;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  tip?: TipValue;
  hand?: boolean;
}>();

const style = computed(() => ({
  ...boxStyle(props),
  objectFit: 'contain' as const,
  objectPosition: 'left top',
  cursor: props.hand ? 'pointer' : undefined,
}));
</script>

<template>
  <img
    v-if="source"
    v-tip="tip"
    class="fx-image"
    :src="assets.url(source)"
    :style="style"
    alt=""
    draggable="false"
  />
</template>

<style scoped>
.fx-image {
  user-select: none;
}
</style>
