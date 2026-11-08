<script setup lang="ts">
import type { HonourStatList } from '../../game/battleHonour';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleHonourStatDialog + BattleHonourStatList: the 贡献排行 — one camp panel per
 * unionid with the camp's average honour and the per-player contribution list.
 */
defineProps<{ lists: HonourStatList[] }>();
const emit = defineEmits<{ close: [] }>();

const columns: { header: string; field: keyof HonourStatList['users'][number]; width: number }[] = [
  { header: i18n('Battle_BattleHonourStatList_1_1'), field: 'name', width: 97 },
  { header: i18n('Battle_BattleHonourStatList_2_1'), field: 'honour', width: 97 },
  { header: i18n('Battle_BattleHonourStatList_3_1'), field: 'contribute', width: 70 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxCanvas
      v-for="(list, i) in lists"
      :key="list.unionid"
      :x="i === 0 ? 21 : 345"
      :y="50"
      :w="316"
      :h="380"
      style-name="PanelGreyGreen"
    >
      <FxCanvas :x="8" :y="4" :w="300" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="300"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="list.title"
        />
      </FxCanvas>
      <FxLabel
        :x="10"
        :y="38"
        :w="300"
        style-name="ItemTitle"
        :fx="{ textAlign: 'center' }"
        :text="list.avgHonourDesc"
      />
      <FxCanvas :x="8" :y="66" :w="300" :h="270" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="294"
          :h="264"
          :row-height="24"
          :columns="columns"
          :rows="list.users"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton :x="593" :y="447" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
