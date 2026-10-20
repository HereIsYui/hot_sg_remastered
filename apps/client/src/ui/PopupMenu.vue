<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { assets } from '../assets/registry';
import { closeMenu, menuState, type MenuItem } from './menu';
import { cssColor, textStyle } from './skin';

/** mx.controls.Menu shown by `showMenu`; a press anywhere else closes it. */
const root = ref<HTMLDivElement>();
const over = ref(-1);
const decl = computed(() => assets.style('Menu', menuState.styleName));
const boxStyle = computed(() => {
  const d = decl.value;
  return {
    ...textStyle(d),
    left: `${Math.min(menuState.x, 1000 - 80)}px`,
    top: `${Math.min(menuState.y, 600 - menuState.items.length * 20 - 4)}px`,
    backgroundColor: cssColor(d.backgroundColor ?? 0xffffff),
    border: `1px solid ${cssColor(d.borderColor ?? 0) ?? '#000'}`,
  };
});

function rowStyle(item: MenuItem, i: number) {
  const d = decl.value;
  if (item.enabled === false) return { color: cssColor(d.disabledColor) };
  if (i === over.value) {
    return { backgroundColor: cssColor(d.rollOverColor), color: cssColor(d.textRollOverColor) };
  }
  return {};
}

function choose(item: MenuItem) {
  if (item.enabled === false) return;
  closeMenu(item.data);
}

function onDocumentDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) closeMenu(null);
}

watch(
  () => menuState.visible,
  (visible) => {
    over.value = -1;
    if (visible) document.addEventListener('pointerdown', onDocumentDown, true);
    else document.removeEventListener('pointerdown', onDocumentDown, true);
  },
);
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentDown, true));
</script>

<template>
  <div v-if="menuState.visible" ref="root" class="popup-menu" :style="boxStyle">
    <div
      v-for="(item, i) in menuState.items"
      :key="item.data"
      class="row"
      :style="rowStyle(item, i)"
      @mouseenter="over = i"
      @mouseleave="over = -1"
      @click="choose(item)"
    >
      {{ item.label }}
    </div>
  </div>
</template>

<style scoped>
.popup-menu {
  position: absolute;
  padding: 1px 0;
  pointer-events: auto;
  box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.row {
  height: 20px;
  line-height: 20px;
  padding: 0 18px;
  white-space: nowrap;
  cursor: default;
}
</style>
