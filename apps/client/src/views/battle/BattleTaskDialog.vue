<script setup lang="ts">
import type { BattleTaskRow } from '../../game/battleInfor';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.mview.TaskStatusPanel: the 战场任务 list (the 8001 孟获 chain of getLastMainTask);
 * the per-任务 counts come from the cross-server `getUserBattleThingsCount`, which the
 * standalone has no socket for, so the progress column keeps its 0/N placeholder.
 */
defineProps<{ tasks: BattleTaskRow[] }>();
const emit = defineEmits<{ close: [] }>();

// The three headerTexts are hardcoded Chinese in the original AS3.
const columns: { header: string; field: keyof BattleTaskRow; width: number }[] = [
  { header: '任务名称', field: 'name', width: 90 },
  { header: '任务指南', field: 'todo', width: 336 },
  { header: '任务进度', field: 'oklabel', width: 100 },
];
</script>

<template>
  <FxCanvas
    :w="682"
    :h="492"
    :fx="{ backgroundColor: 0, backgroundAlpha: 0 }"
    @click="emit('close')"
  >
    <FxCanvas :x="34" :y="42" :w="614" :h="408" style-name="PanelGreyGreen" @click.stop>
      <FxCanvas :x="200.5" :y="17" :w="201" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="25"
          :y="3"
          :w="151"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleMenu_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="37" :y="60" :w="542" :h="297" style-name="BoardListUp">
        <FxDataGrid
          :x="2"
          :y="2"
          :w="538"
          :h="293"
          :row-height="22"
          :columns="columns"
          :rows="tasks"
        />
      </FxCanvas>
      <FxButton :x="539" :y="370" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
