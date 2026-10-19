<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, cssColor, skinStyle, styleNumber, styleString, textStyle } from './skin';

/** mx.controls.ComboBox (non-editable): skinned button plus a drop-down list of `rowCount` rows. */
const props = withDefaults(
  defineProps<{
    items: readonly string[];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    styleName?: string;
    fx?: StyleDecl;
    rowCount?: number;
    enabled?: boolean;
  }>(),
  { rowCount: 5, enabled: true },
);

const selectedIndex = defineModel<number>('selectedIndex', { default: 0 });
const emit = defineEmits<{ change: [number] }>();

const ROW = 20;
const open = ref(false);
const over = ref(false);
const root = ref<HTMLDivElement>();
const decl = computed(() => assets.style('ComboBox', props.styleName, props.fx));
const dropdown = computed(() => assets.style('List', styleString(decl.value, 'dropdownStyleName')));
const skin = computed(() => {
  const d = decl.value;
  if (!props.enabled) return styleString(d, 'disabledSkin') ?? styleString(d, 'upSkin');
  return (
    styleString(d, open.value ? 'downSkin' : over.value ? 'overSkin' : 'upSkin') ??
    styleString(d, 'upSkin')
  );
});
const height = computed(() => props.h ?? 22);
const listStyle = computed(() => {
  const d = dropdown.value;
  return {
    ...textStyle(d),
    top: `${height.value}px`,
    maxHeight: `${props.rowCount * ROW}px`,
    backgroundColor: cssColor(
      d.backgroundColor ??
        (Array.isArray(d.alternatingItemColors) ? d.alternatingItemColors[0] : 0xffffff),
    ),
    '--rollover': cssColor(d.rollOverColor ?? 0xb2e1ff),
    border: `${styleNumber(d, 'borderThickness') ?? 1}px solid ${cssColor(d.borderColor ?? decl.value.borderColor ?? 0) ?? '#000'}`,
  };
});

function rowStyle(i: number) {
  const d = dropdown.value;
  if (i === selectedIndex.value)
    return { backgroundColor: cssColor(d.selectionColor), color: cssColor(d.textSelectedColor) };
  return {};
}

function onDocumentDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false;
}

function toggle() {
  if (!props.enabled) return;
  open.value = !open.value;
  if (open.value) document.addEventListener('pointerdown', onDocumentDown);
  else document.removeEventListener('pointerdown', onDocumentDown);
}

function choose(i: number) {
  open.value = false;
  document.removeEventListener('pointerdown', onDocumentDown);
  if (i !== selectedIndex.value) {
    selectedIndex.value = i;
    emit('change', i);
  }
}

onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentDown));
</script>

<template>
  <div
    ref="root"
    class="fx-combo"
    :style="{ ...boxStyle(props), height: `${height}px`, ...textStyle(decl) }"
    @pointerenter="over = true"
    @pointerleave="over = false"
  >
    <div class="fx-face" :style="skinStyle(skin)" @click="toggle">
      <span class="fx-value">{{ items[selectedIndex] ?? '' }}</span>
    </div>
    <ul v-if="open" class="fx-list" :style="listStyle">
      <li
        v-for="(item, i) in items"
        :key="i"
        :style="[{ height: `${ROW}px`, lineHeight: `${ROW}px` }, rowStyle(i)]"
        @click="choose(i)"
      >
        {{ item }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fx-combo {
  user-select: none;
  z-index: 10;
}

.fx-face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 24px 0 6px;
  box-sizing: border-box;
  cursor: pointer;
}

.fx-value {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fx-list {
  position: absolute;
  left: 0;
  right: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  box-sizing: border-box;
  z-index: 100;
}

.fx-list li {
  padding: 0 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fx-list li:hover {
  background-color: var(--rollover);
}
</style>
