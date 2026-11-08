<script setup lang="ts">
import { computed, ref } from 'vue';
import type { MedalExchangeRow } from '../../game/battleShop';
import { medalChangeRate } from '../../game/battleShop';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Shop.BattleMedalChangeDialog: the 勋章兑换 — pick a campaign medal, trade `rate` of it for one
 * 汉室勋章 (`medalChange [count, medalTypeId]`).
 */
const props = defineProps<{ rows: MedalExchangeRow[] }>();
const emit = defineEmits<{ close: []; change: [count: number, medalTypeId: number] }>();

const selected = ref(0);
const countInput = ref('1');

const items = computed(() => props.rows.map((row) => row.name));
/** `onChange`: `rate×name=1汉室勋章` for the picked medal. */
const rateLine = computed(() => {
  const row = props.rows[selected.value];
  return row ? medalChangeRate(row) : '';
});

/** `onSubmit`: a non-positive count alerts and stays open. */
async function onSubmit(): Promise<void> {
  const count = parseInt(countInput.value, 10) || 0;
  if (count <= 0) {
    void showAlert(i18n('Shop_BattleMedalChangeDialog_13_1'));
    return;
  }
  const row = props.rows[selected.value];
  if (!row) return;
  emit('change', count, row.tid);
}
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
          :text="i18n('Shop_BattleMedalChangeDialog_3_1')"
        />
      </FxCanvas>
      <FxLabel
        :x="20"
        :y="46"
        :w="120"
        style-name="ItemTitle"
        :text="i18n('Shop_BattleMedalChangeDialog_5_1')"
      />
      <FxComboBox
        v-model:selected-index="selected"
        :x="20"
        :y="70"
        :w="260"
        :row-count="5"
        :items="items"
      />
      <FxLabel :x="20" :y="106" :w="260" :fx="{ textAlign: 'center' }" :text="rateLine" />
      <FxTextInput
        v-model="countInput"
        :x="20"
        :y="130"
        :w="120"
        :h="25"
        :max-chars="9"
        @enter="onSubmit"
      />
      <FxButton
        :x="160"
        :y="128"
        :w="120"
        :h="28"
        style-name="ButtonYellow"
        :label="i18n('Shop_BattleMedalChangeDialog_4_1')"
        @click="onSubmit"
      />
      <FxButton :x="270" :y="170" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
