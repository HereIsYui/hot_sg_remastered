<script setup lang="ts">
import { computed } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, cssColor, skinStyle, styleNumber, styleString, textStyle } from './skin';
import { vTip, type TipValue } from './tooltip';

/** mx.containers.Canvas: absolute layout, optional borderSkin / backgroundImage / background. */
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
  /** Inline Flex styles (`style{...}` in the outlines). */
  fx?: StyleDecl;
  backgroundImage?: string;
  tip?: TipValue;
  /** `buttonMode`/`useHandCursor`. */
  hand?: boolean;
}>();

const decl = computed(() => assets.style('Canvas', props.styleName, props.fx));
const border = computed(() => styleString(decl.value, 'borderSkin'));
const bgImage = computed(() => props.backgroundImage ?? styleString(decl.value, 'backgroundImage'));
const sized = computed(
  () =>
    (props.w !== undefined || (props.left !== undefined && props.right !== undefined)) &&
    (props.h !== undefined || (props.top !== undefined && props.bottom !== undefined)),
);
const style = computed(() => {
  const d = decl.value;
  const alpha = styleNumber(d, 'backgroundAlpha') ?? 1;
  return {
    ...boxStyle(props),
    ...textStyle(d),
    overflow: sized.value ? 'hidden' : 'visible',
    backgroundColor: alpha > 0 ? cssColor(d.backgroundColor, alpha) : undefined,
    cursor: props.hand ? 'pointer' : undefined,
  };
});
</script>

<template>
  <div v-tip="tip" class="fx-canvas" :style="style">
    <div v-if="border" class="fx-fill" :style="skinStyle(border)" />
    <img v-if="bgImage" class="fx-bg" :src="assets.url(bgImage)" alt="" draggable="false" />
    <slot />
  </div>
</template>

<style scoped>
.fx-fill {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.fx-bg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
</style>
