<script setup lang="ts">
import { computed, ref } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, skinSize, skinStyle, styleNumber, styleString, textStyle } from './skin';

/** mx.controls.CheckBox / RadioButton: state icon followed by the label. */
const props = withDefaults(
  defineProps<{
    type?: 'CheckBox' | 'RadioButton';
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    styleName?: string;
    fx?: StyleDecl;
    label?: string;
    enabled?: boolean;
  }>(),
  { type: 'CheckBox', enabled: true },
);

const selected = defineModel<boolean>('selected', { default: false });
const emit = defineEmits<{ change: [boolean] }>();

const over = ref(false);
const down = ref(false);
const decl = computed(() => assets.style(props.type, props.styleName, props.fx));

function icon(phase: string): string | undefined {
  const d = decl.value;
  const name = selected.value
    ? `selected${phase[0]!.toUpperCase()}${phase.slice(1)}Icon`
    : `${phase}Icon`;
  return styleString(d, name) ?? styleString(d, selected.value ? 'selectedUpIcon' : 'upIcon');
}

const current = computed(() =>
  icon(!props.enabled ? 'disabled' : down.value ? 'down' : over.value ? 'over' : 'up'),
);
const iconSize = computed(() => skinSize(current.value) ?? [14, 14]);

function onClick() {
  if (!props.enabled) return;
  const next = props.type === 'RadioButton' ? true : !selected.value;
  if (next !== selected.value) {
    selected.value = next;
    emit('change', next);
  }
}

function onDown() {
  if (!props.enabled) return;
  down.value = true;
  window.addEventListener('pointerup', () => (down.value = false), { once: true });
}
</script>

<template>
  <div
    class="fx-toggle"
    :style="{ ...boxStyle(props), ...textStyle(decl), cursor: enabled ? 'pointer' : 'default' }"
    @pointerenter="over = true"
    @pointerleave="over = false"
    @pointerdown="onDown"
    @click="onClick"
  >
    <span
      class="fx-icon"
      :style="{ ...skinStyle(current), width: `${iconSize[0]}px`, height: `${iconSize[1]}px` }"
    />
    <span
      v-if="label"
      class="fx-label"
      :style="{ marginLeft: `${(styleNumber(decl, 'horizontalGap') ?? 0) + 2}px` }"
      >{{ label }}</span
    >
  </div>
</template>

<style scoped>
.fx-toggle {
  display: flex;
  align-items: center;
  user-select: none;
  white-space: pre;
}

.fx-icon {
  flex: none;
  display: inline-block;
}
</style>
