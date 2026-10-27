<script setup lang="ts">
import { serverTime } from '../../core/clock';
import { makeEndTimeString } from '../../game/troop';
import { heroStateName } from '../../game/units';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

defineProps<{ heroes: Record<string, unknown>[] }>();
const emit = defineEmits<{ close: [] }>();
const columns = [
  { header: '将领', field: 'name' as const, width: 140 },
  { header: '状态', field: 'hero_health' as const, width: 100 },
  { header: '恢复时间', field: 'endtime' as const, width: 160 },
];
</script>

<template>
  <FxCanvas :x="181" :y="116" :w="320" :h="260" style-name="PanelGreyGreen">
    <FxCanvas :x="85" :y="10" :w="150" :h="27" style-name="PopupTitle">
      <FxLabel :x="5" :y="4" :w="140" :fx="{ textAlign: 'center', color: 15007634 }" text="修养" />
    </FxCanvas>
    <FxDataGrid
      :x="10"
      :y="48"
      :w="300"
      :h="145"
      :columns="columns"
      :rows="heroes"
      :row-height="25"
    >
      <template #cell="{ row, column }">
        <span v-if="column.field === 'hero_health'">{{ heroStateName(row) }}</span>
        <span v-else-if="column.field === 'endtime'">{{
          row.endtime ? makeEndTimeString(Number(row.endtime), serverTime()) : '---'
        }}</span>
        <span v-else>{{ row[column.field] }}</span>
      </template>
    </FxDataGrid>
    <FxLabel
      v-if="heroes.length === 0"
      :x="20"
      :y="110"
      :w="280"
      :fx="{ textAlign: 'center' }"
      text="当前没有需要修养的将领。"
    />
    <FxButton :x="120" :bottom="18" style-name="Return" @click="emit('close')" />
  </FxCanvas>
</template>
