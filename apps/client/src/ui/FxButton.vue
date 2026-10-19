<script setup lang="ts">
import { computed, ref } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, skinSize, skinStyle, styleNumber, styleString, textStyle } from './skin';
import { vTip, type TipValue } from './tooltip';

/** mx.controls.Button with bitmap state skins (up/over/down/disabled, selected variants). */
const props = withDefaults(
  defineProps<{
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
    label?: string;
    selected?: boolean;
    enabled?: boolean;
    tip?: TipValue;
  }>(),
  { enabled: true },
);

const emit = defineEmits<{ click: [MouseEvent]; buttonDown: [PointerEvent] }>();

const over = ref(false);
const down = ref(false);
const decl = computed(() => assets.style('Button', props.styleName, props.fx));
const phase = computed(() =>
  !props.enabled ? 'disabled' : down.value ? 'down' : over.value ? 'over' : 'up',
);

function skin(name: string): string | undefined {
  const d = decl.value;
  if (props.selected) {
    const selected = styleString(d, `selected${name[0]!.toUpperCase()}${name.slice(1)}Skin`);
    if (selected) return selected;
  }
  return styleString(d, `${name}Skin`);
}

const current = computed(() => skin(phase.value) ?? skin('up'));
const color = computed(() => {
  const d = decl.value;
  if (!props.enabled) return d.disabledColor ?? d.color;
  if (props.selected) return d.textSelectedColor ?? d.color;
  if (over.value) return d.textRollOverColor ?? d.color;
  return d.color;
});
const style = computed(() => {
  const d = decl.value;
  return {
    ...boxStyle(props, skinSize(skin('up'))),
    ...textStyle(d, color.value),
    paddingLeft: `${styleNumber(d, 'paddingLeft') ?? 0}px`,
    paddingRight: `${styleNumber(d, 'paddingRight') ?? 0}px`,
    paddingTop: `${styleNumber(d, 'paddingTop') ?? 0}px`,
    paddingBottom: `${styleNumber(d, 'paddingBottom') ?? 0}px`,
    cursor: props.enabled ? 'pointer' : 'default',
  };
});

function onDown(e: PointerEvent) {
  if (!props.enabled || e.button !== 0) return;
  down.value = true;
  emit('buttonDown', e);
  window.addEventListener('pointerup', () => (down.value = false), { once: true });
}

function onClick(e: MouseEvent) {
  if (props.enabled) emit('click', e);
}
</script>

<template>
  <div
    v-tip="tip"
    class="fx-button"
    :style="style"
    @pointerenter="over = true"
    @pointerleave="over = false"
    @pointerdown="onDown"
    @click="onClick"
  >
    <div class="fx-fill" :style="skinStyle(current)" />
    <span v-if="label" class="fx-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.fx-button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  user-select: none;
  white-space: nowrap;
}

.fx-fill {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.fx-label {
  position: relative;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
