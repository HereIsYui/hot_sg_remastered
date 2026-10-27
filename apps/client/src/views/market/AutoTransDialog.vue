<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { onUnmounted, ref, watch } from 'vue';
import { useGame } from '../../game/game';
import { parseAutoTrans, type AutoTransRow, type MarketSend } from '../../game/market';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import AddAutoTransDialog from './AddAutoTransDialog.vue';

const props = defineProps<{ open: boolean; send: MarketSend }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const rows = ref<AutoTransRow[]>([]);
const adding = ref(false);
let pending: CommandArg[] | null = null;

function load(): void {
  props.send('getAutoTrans', [], 4);
}

function submitPending(): void {
  if (!pending) return;
  props.send('addAutoTrans', pending, 3);
}

function onSubmit(args: CommandArg[]): void {
  pending = args;
  props.send('hasAutoTrans', [], 6);
}

function onReply(data: unknown[], ttype: number): void {
  if (ttype === 3) {
    rows.value = parseAutoTrans(data);
    adding.value = false;
    void showAlert(i18n('Market_MarketDialogSrc_1'));
  } else if (ttype === 4) {
    rows.value = parseAutoTrans(data);
  } else if (ttype === 5) {
    const id = Number(data[0] ?? 0);
    rows.value = rows.value.filter((row) => row.id !== id);
  } else if (ttype === 6) {
    if (data[0] === false || data[0] === 0) {
      void showAlert(i18n('Market_AddAutoTransDialogSrc_18'), '', ['yes', 'no']).then((button) => {
        if (button === 'yes') submitPending();
      });
    } else {
      submitPending();
    }
  }
}

const unregister = game.addGlobalReceiver('buybeforeuse', (command, data) => {
  if (command === 'buyGoodsBeforeUse' && Number((data as unknown[])?.[0]) === 120) submitPending();
});

watch(
  () => props.open,
  (open) => {
    if (open) load();
  },
  { immediate: true },
);
onUnmounted(unregister);
defineExpose({ onReply });
</script>

<template>
  <FxCanvas v-show="open" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="272.5" :y="21" :w="137" :h="23" style-name="PopupTitle">
      <FxLabel
        :x="5"
        :y="2"
        :w="127"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Market_AutoTransDialog_10_1')"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="63" :w="642" :h="362" style-name="BoardListDown">
      <FxDataGrid
        :w="642"
        :h="362"
        :rows="rows"
        :row-height="30"
        :columns="[
          { header: i18n('Market_AutoTransDialog_1_1'), field: 'resname', width: 50 },
          { header: i18n('Market_AutoTransDialog_2_1'), field: 'count', width: 80 },
          { header: i18n('Market_AutoTransDialog_3_1'), field: 'fromcity', width: 80 },
          { header: i18n('Market_AutoTransDialog_4_1'), field: 'fromcid', width: 70 },
          { header: i18n('Market_AutoTransDialog_5_1'), field: 'tocity', width: 80 },
          { header: i18n('Market_AutoTransDialog_6_1'), field: 'tocid', width: 70 },
          { header: i18n('Market_AutoTransDialog_7_1'), field: 'start_time', width: 132 },
          { header: i18n('Market_AutoTransDialog_8_1'), field: 'id', width: 80 },
        ]"
      >
        <template #cell="{ row, column }">
          <FxButton
            v-if="column.header === i18n('Market_AutoTransDialog_8_1')"
            :y="2"
            :w="52"
            :h="27"
            style-name="ButtonRed"
            :label="i18n('Market_AutoTransDialog_9_1')"
            @click="send('removeAutoTrans', [row.id], 5)"
          />
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxButton
      :x="481"
      :bottom="14"
      :w="80"
      style-name="ButtonGreen"
      :label="i18n('Market_AutoTransDialog_11_1')"
      @click="adding = true"
    />
    <FxButton
      :x="598"
      :bottom="14"
      style-name="Return"
      :fx="{ fontSize: 16 }"
      @click="emit('close')"
    />
    <AddAutoTransDialog v-if="adding" @close="adding = false" @submit="onSubmit" />
  </FxCanvas>
</template>
