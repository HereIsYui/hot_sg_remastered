<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

defineProps<{ heroes: Record<string, unknown>[]; need: string }>();
const emit = defineEmits<{ try: [hid: number]; sure: [hid: number]; close: [] }>();
const selected = ref(0);
const columns = [
  { header: '将领', field: 'name' as const, width: 120 },
  { header: '等级', field: 'level' as const, width: 50 },
  { header: '统率', field: 'command' as const, width: 70 },
  { header: '内政', field: 'affairs' as const, width: 70 },
  { header: '勇武', field: 'bravery' as const, width: 70 },
  { header: '智谋', field: 'wisdom' as const, width: 70 },
  { header: '忠诚', field: 'loyalty' as const, width: 70 },
];
</script>

<template>
  <FxCanvas :x="81" :y="66" :w="520" :h="360" style-name="PanelGreyGreen">
    <FxCanvas :x="185" :y="10" :w="150" :h="27" style-name="PopupTitle">
      <FxLabel
        :x="5"
        :y="4"
        :w="140"
        :fx="{ textAlign: 'center', color: 15007634 }"
        :text="i18n('Office_OfficeHeroPanel_4_1') || '召回旧部'"
      />
    </FxCanvas>
    <FxDataGrid
      :x="10"
      :y="48"
      :w="500"
      :h="210"
      :columns="columns"
      :rows="heroes"
      :row-height="25"
      selectable
      :selected-index="heroes.findIndex((h) => Number(h.hid) === selected)"
      @item-click="(hero) => (selected = Number(hero.hid))"
    />
    <FxText v-if="need" :x="20" :y="268" :w="480" :h="42" :text="need" :fx="{ color: 0xe7d18d }" />
    <FxLabel v-else :x="20" :y="270" :w="480" text="选择一名流亡将领查看召回条件。" />
    <FxButton :x="300" :bottom="18" style-name="Return" @click="emit('close')" />
    <FxButton
      v-if="!need"
      :x="200"
      :bottom="18"
      :w="100"
      :h="30"
      style-name="ButtonGreen"
      label="查看条件"
      @click="selected > 0 && emit('try', selected)"
    />
    <FxButton
      v-for="hero in need ? heroes.filter((h) => Number(h.hid) === selected) : []"
      :key="Number(hero.hid)"
      :x="130"
      :bottom="18"
      :w="100"
      :h="30"
      style-name="ButtonGreen"
      label="确认召回"
      @click="emit('sure', selected)"
    />
  </FxCanvas>
</template>
