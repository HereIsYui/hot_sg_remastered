<script setup lang="ts">
import { computed } from 'vue';
import { recruitCommand, recruitNameColor, type HeroRecruit } from '../../game/hotel';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';

/**
 * Hotel.HotelRecruitPanel: the heroes on offer and the 客栈's errands. The list does not sort
 * by column as the SortableDatagrid did.
 */
const props = defineProps<{ x: number; y: number; recruits: HeroRecruit[] }>();
const emit = defineEmits<{
  reset: [];
  rumor: [];
  makeFriends: [];
  treasure: [];
  recruit: [recruit: HeroRecruit];
}>();

const t = (key: string) => i18n(`Hotel_HotelRecruitPanel_${key}`);

interface Row {
  recruit: HeroRecruit;
  hname: string;
  level: number;
  affairs: number;
  bravery: number;
  wisdom: number;
  command: number;
  gold_need: number;
}

const rows = computed<Row[]>(() =>
  props.recruits.map((r) => ({
    recruit: r,
    hname: r.hname,
    level: r.level,
    affairs: r.affairs_base + r.affairs_add,
    bravery: r.bravery_base + r.bravery_add,
    wisdom: r.wisdom_base + r.wisdom_add,
    command: recruitCommand(r),
    gold_need: r.gold_need,
  })),
);

type Column = { header: string; field: keyof Row; width: number; color?: (row: Row) => number };
const columns: Column[] = [
  { header: t('6_1'), field: 'hname', width: 80, color: (row) => recruitNameColor(row.recruit) },
  { header: t('7_1'), field: 'level', width: 79 },
  { header: t('8_1'), field: 'affairs', width: 80 },
  { header: t('9_1'), field: 'bravery', width: 79 },
  { header: t('10_1'), field: 'wisdom', width: 80 },
  { header: t('11_2'), field: 'command', width: 79 },
  { header: t('12_1'), field: 'gold_need', width: 80 },
  { header: '', field: 'recruit', width: 79 },
];

const buttons = [
  { x: 5, label: t('1_1'), event: 'reset' },
  { x: 95, label: t('2_1'), event: 'rumor' },
  { x: 185, label: t('15_1'), event: 'makeFriends' },
  { x: 275, label: t('3_1'), event: 'treasure' },
] as const;

function onButton(event: (typeof buttons)[number]['event']) {
  if (event === 'reset') emit('reset');
  else if (event === 'rumor') emit('rumor');
  else if (event === 'makeFriends') emit('makeFriends');
  else emit('treasure');
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="642" :h="318" style-name="BoardListUp" :fx="{ fontSize: 12 }">
    <FxButton
      v-for="b in buttons"
      :key="b.event"
      :x="b.x"
      :y="2"
      :w="75"
      style-name="ButtonYellow"
      :label="b.label"
      @click="onButton(b.event)"
    />
    <FxDataGrid :x="3" :y="38" :w="636" :h="276" :row-height="25" :columns="columns" :rows="rows">
      <template #cell="{ row, column }">
        <div v-if="column.field === 'recruit'" class="action">
          <FxButton
            :x="15"
            :y="0"
            :w="50"
            :h="25"
            style-name="ButtonRed"
            :label="t('13_1')"
            @click="emit('recruit', row.recruit)"
          />
        </div>
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
  </FxCanvas>
</template>

<style scoped>
.action {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
