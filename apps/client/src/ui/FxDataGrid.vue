<script setup lang="ts" generic="T extends object">
import { computed } from 'vue';
import { assets } from '../assets/registry';
import { boxStyle, cssColor, skinStyle, styleString, textStyle } from './skin';

type Column = {
  header: string;
  field: keyof T & string;
  width: number;
  color?: (row: T) => number;
};

/**
 * mx.controls.DataGrid as the dialogs use it: read-only, unsorted, header row plus alternating
 * rows separated by horizontal lines.
 */
const props = withDefaults(
  defineProps<{
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    /** `color`: a cell's text colour (an item renderer's binding); the grid's otherwise. */
    columns: Column[];
    rows: T[];
    rowHeight?: number;
    headerHeight?: number;
    /** `selectable`: rows highlight under the pointer; `selectedIndex` is drawn selected. */
    selectable?: boolean;
    selectedIndex?: number;
  }>(),
  { rowHeight: 22, headerHeight: undefined, selectable: false, selectedIndex: -1 },
);
const emit = defineEmits<{ itemClick: [row: T, index: number] }>();
defineSlots<{
  /** An item renderer; the field's text by default. */
  cell?(props: { row: T; column: Column; index: number }): unknown;
}>();

const decl = computed(() => assets.style('DataGrid'));
const header = computed(() => ({
  ...skinStyle(styleString(decl.value, 'headerBackgroundSkin')),
  ...textStyle(assets.style('Label', 'dataGridHeader')),
  height: `${props.headerHeight ?? props.rowHeight}px`,
}));
const colors = computed(() => {
  const list = decl.value.alternatingItemColors;
  return Array.isArray(list) ? list.map((c) => cssColor(c as number)) : [];
});
const line = computed(() => cssColor(decl.value.horizontalGridLineColor));
const rollOver = computed(() => ({
  '--rollover': cssColor(decl.value.rollOverColor),
  '--rollover-text': cssColor(decl.value.textRollOverColor),
}));

function rowBackground(i: number) {
  if (i === props.selectedIndex) {
    return {
      background: cssColor(decl.value.selectionColor),
      color: cssColor(decl.value.textSelectedColor),
    };
  }
  return { background: colors.value[i % colors.value.length] };
}
</script>

<template>
  <div class="grid" :style="{ ...boxStyle(props), ...textStyle(decl), ...rollOver }">
    <div class="row" :style="header">
      <div v-for="(c, j) in columns" :key="j" class="cell" :style="{ width: `${c.width}px` }">
        {{ c.header }}
      </div>
    </div>
    <div
      v-for="(row, i) in rows"
      :key="i"
      class="row"
      :class="{ selectable: selectable && i !== selectedIndex }"
      :style="{
        height: `${rowHeight}px`,
        ...rowBackground(i),
        borderBottom: `1px solid ${line}`,
      }"
      @click="emit('itemClick', row, i)"
    >
      <div
        v-for="(c, j) in columns"
        :key="j"
        class="cell"
        :style="{
          width: `${c.width}px`,
          height: '100%',
          color: c.color ? cssColor(c.color(row)) : undefined,
        }"
      >
        <slot name="cell" :row="row" :column="c" :index="i">{{ row[c.field] }}</slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid {
  position: absolute;
  overflow: hidden auto;
  font-size: 12px;
  /* Keeps the sticky header under pop-ups drawn over the grid. */
  isolation: isolate;
}

.grid > .row:first-child {
  position: sticky;
  top: 0;
  z-index: 1;
}

.row {
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.row.selectable:hover {
  background: var(--rollover) !important;
  color: var(--rollover-text);
}

.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}
</style>
