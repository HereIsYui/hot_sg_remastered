<script setup lang="ts" generic="T extends object">
import { computed } from 'vue';
import { assets } from '../assets/registry';
import { boxStyle, cssColor, skinStyle, styleString, textStyle } from './skin';

/**
 * mx.controls.DataGrid as the dialogs use it: read-only, unsorted, header row plus alternating
 * rows separated by horizontal lines.
 */
const props = defineProps<{
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  columns: { header: string; field: keyof T & string; width: number }[];
  rows: T[];
}>();

const ROW_HEIGHT = 22;

const decl = computed(() => assets.style('DataGrid'));
const header = computed(() => ({
  ...skinStyle(styleString(decl.value, 'headerBackgroundSkin')),
  ...textStyle(assets.style('Label', 'dataGridHeader')),
  height: `${ROW_HEIGHT}px`,
}));
const colors = computed(() => {
  const list = decl.value.alternatingItemColors;
  return Array.isArray(list) ? list.map((c) => cssColor(c as number)) : [];
});
const line = computed(() => cssColor(decl.value.horizontalGridLineColor));
</script>

<template>
  <div class="grid" :style="{ ...boxStyle(props), ...textStyle(decl) }">
    <div class="row" :style="header">
      <div v-for="c in columns" :key="c.field" class="cell" :style="{ width: `${c.width}px` }">
        {{ c.header }}
      </div>
    </div>
    <div
      v-for="(row, i) in rows"
      :key="i"
      class="row"
      :style="{
        height: `${ROW_HEIGHT}px`,
        background: colors[i % colors.length],
        borderBottom: `1px solid ${line}`,
      }"
    >
      <div v-for="c in columns" :key="c.field" class="cell" :style="{ width: `${c.width}px` }">
        {{ row[c.field] }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid {
  position: absolute;
  overflow: hidden;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.cell {
  overflow: hidden;
  text-align: center;
  white-space: nowrap;
}
</style>
