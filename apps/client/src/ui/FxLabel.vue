<script setup lang="ts">
import { computed } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, textStyle } from './skin';
import { vTip, type TipValue } from './tooltip';

/** mx.controls.Label: single line, truncated with an ellipsis when a width is set. */
const props = defineProps<{
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  styleName?: string;
  fx?: StyleDecl;
  text?: string | number | null;
  tip?: TipValue;
  hand?: boolean;
}>();

const decl = computed(() => assets.style('Label', props.styleName, props.fx));
const style = computed(() => ({
  ...boxStyle(props),
  ...textStyle(decl.value),
  cursor: props.hand ? 'pointer' : undefined,
}));
</script>

<template>
  <div v-tip="tip" class="fx-label" :style="style">{{ text ?? '' }}</div>
</template>

<style scoped>
.fx-label {
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 2px;
  box-sizing: border-box;
  line-height: 1.4;
}
</style>
