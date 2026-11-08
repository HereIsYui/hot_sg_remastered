<script setup lang="ts">
import type { MedalRecordRow } from '../../game/battleShop';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/** Shop.BattleMetalRecord: the 勋章记录 — the player's stock of every campaign medal. */
defineProps<{ rows: MedalRecordRow[] }>();
const emit = defineEmits<{ close: [] }>();

const columns: { header: string; field: keyof MedalRecordRow; width: number }[] = [
  { header: i18n('Shop_BattleMetalRecord_4_1'), field: 'name', width: 150 },
  { header: i18n('Shop_BattleMetalRecord_5_1'), field: 'count', width: 100 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12 }" @click="emit('close')">
    <FxCanvas :x="191" :y="146" :w="300" :h="200" style-name="PanelGreyGreen" @click.stop>
      <FxCanvas :x="75" :y="8" :w="150" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="150"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Shop_BattleMetalRecord_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="20" :y="46" :w="260" :h="110" style-name="BoardListUp">
        <FxDataGrid
          :x="2"
          :y="2"
          :w="256"
          :h="106"
          :row-height="22"
          :columns="columns"
          :rows="rows"
        />
      </FxCanvas>
      <FxButton :x="270" :y="170" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
