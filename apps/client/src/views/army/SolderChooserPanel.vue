<script setup lang="ts">
import type { ConvertChoice } from '../../game/soldierConvert';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import SoldierChangerItem from './SoldierChangerItem.vue';

/** Army.SolderChooserPanel: up to twelve soldier types in a 6x2 grid; a click picks one. */
defineProps<{ x: number; y: number; choices: ConvertChoice[] }>();
const emit = defineEmits<{ pick: [choice: ConvertChoice]; close: [] }>();

/** mx.containers.Grid 519x189 with its default 8px/6px gaps. */
const CELL_W = (519 - 5 * 8) / 6 + 8;
const CELL_H = (189 - 6) / 2 + 6;
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="600" :h="358" style-name="PopupDialog">
    <FxCanvas :x="240" :y="20" :w="120" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="120"
        :h="18"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('SolderChooserPanel_tile')"
      />
    </FxCanvas>
    <FxCanvas :x="23" :y="54" :w="550" :h="235" style-name="BoardListUp">
      <SoldierChangerItem
        v-for="(c, i) in choices.slice(0, 12)"
        :key="c.sid"
        :x="16 + (i % 6) * CELL_W"
        :y="25 + Math.floor(i / 6) * CELL_H"
        :item="c"
        @click="emit('pick', c)"
      />
    </FxCanvas>
    <FxButton :x="510" :y="294" label="关闭" @click="emit('close')" />
  </FxCanvas>
</template>
