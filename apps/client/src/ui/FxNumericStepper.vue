<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, skinSize, skinStyle, styleString, textStyle } from './skin';

/** mx.controls.NumericStepper: an integer field with up/down arrows, clamped to its range. */
const props = withDefaults(
  defineProps<{
    x?: number;
    y?: number;
    minimum?: number;
    maximum?: number;
    styleName?: string;
    fx?: StyleDecl;
  }>(),
  { minimum: 0, maximum: 10 },
);

const value = defineModel<number>({ default: 0 });
const emit = defineEmits<{ change: [number] }>();

const decl = computed(() => assets.style('NumericStepper', props.styleName, props.fx));
const border = computed(() => styleString(decl.value, 'borderSkin'));
const field = computed(() => skinSize(border.value) ?? [46, 26]);
const arrow = computed(() => skinSize(styleString(decl.value, 'upArrowUpSkin')) ?? [26, 13]);
const pressed = ref<'up' | 'down' | null>(null);
const text = ref(String(value.value));
watch(value, (v) => (text.value = String(v)));

function arrowSkin(which: 'up' | 'down'): string | undefined {
  const phase = pressed.value === which ? 'Down' : 'Up';
  return styleString(decl.value, `${which}Arrow${phase}Skin`);
}

function set(n: number) {
  const clamped = Math.min(props.maximum, Math.max(props.minimum, Math.trunc(n)));
  text.value = String(clamped);
  if (clamped === value.value) return;
  value.value = clamped;
  emit('change', clamped);
}

function commit() {
  const n = Number(text.value);
  set(Number.isNaN(n) ? value.value : n);
}
</script>

<template>
  <div
    class="stepper"
    :style="boxStyle({ x, y, w: field[0] + arrow[0], h: Math.max(field[1], arrow[1] * 2) })"
  >
    <input
      v-model="text"
      class="field"
      :style="{
        ...skinStyle(border),
        ...textStyle(decl),
        width: `${field[0]}px`,
        height: `${field[1]}px`,
      }"
      autocomplete="off"
      spellcheck="false"
      @change="commit"
      @keydown.enter="commit"
      @keydown.up.prevent="set(value + 1)"
      @keydown.down.prevent="set(value - 1)"
    />
    <div
      v-for="(which, i) in ['up', 'down'] as const"
      :key="which"
      class="arrow"
      :style="{
        ...skinStyle(arrowSkin(which)),
        left: `${field[0]}px`,
        top: `${i * arrow[1]}px`,
        width: `${arrow[0]}px`,
        height: `${arrow[1]}px`,
      }"
      @pointerdown="pressed = which"
      @pointerup="pressed = null"
      @pointerleave="pressed = null"
      @click="set(value + (which === 'up' ? 1 : -1))"
    />
  </div>
</template>

<style scoped>
.field {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  text-align: center;
  background-color: transparent;
  font: inherit;
}

.arrow {
  position: absolute;
  cursor: pointer;
}
</style>
