<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  convertRate,
  convertedCount,
  maxConvertFrom,
  maxConvertTo,
  sourceCount,
  type ConvertChoice,
} from '../../game/soldierConvert';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import SoldierChangerItem from './SoldierChangerItem.vue';
import SolderChooserPanel from './SolderChooserPanel.vue';

/**
 * Army.SoldierChangerPanel: pick a soldier type to give up and one to get, and how many; the
 * day's remaining military population limits both.
 */
const props = defineProps<{
  from: ConvertChoice[];
  to: ConvertChoice[];
  rates: unknown[][];
  remain: number;
}>();
const emit = defineEmits<{
  convert: [fromSid: number, fromCount: number, toSid: number, toCount: number];
  close: [];
}>();
const t = (n: number) => i18n(`SolderChangePanel_1_${n}`);

const fromType = ref<ConvertChoice | null>(null);
const toType = ref<ConvertChoice | null>(null);
const fromNum = ref(0);
const toNum = ref(0);
const choosing = ref<'from' | 'to' | null>(null);

const rate = computed(() =>
  fromType.value && toType.value
    ? convertRate(props.rates, fromType.value.sid, toType.value.sid)
    : '',
);
const maxSource = computed(() => maxConvertFrom(props.remain, fromType.value));
const maxTarget = computed(() =>
  maxConvertTo(props.remain, fromType.value, toType.value, rate.value),
);

function pick(choice: ConvertChoice) {
  if (choosing.value === 'from') fromType.value = choice;
  else toType.value = choice;
  choosing.value = null;
}

function changeFrom(count: number) {
  toNum.value = convertedCount(count, rate.value, maxTarget.value, toNum.value);
}

function convert() {
  const from = fromType.value;
  const to = toType.value;
  if (!from || !to) return;
  if (from.sid === to.sid) {
    void showAlert(i18n('SolderChangePanel_DifSoldier'));
    return;
  }
  if (toNum.value === 0 || fromNum.value === 0) {
    void showAlert(i18n('SolderChangePanel_NoneZero'));
    return;
  }
  fromNum.value = sourceCount(toNum.value, rate.value, maxSource.value, fromNum.value);
  emit('convert', from.sid, fromNum.value, to.sid, toNum.value);
}
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PopupDialog">
    <FxCanvas :x="29" :y="64" :w="619.5" :h="64" style-name="BoardListUp">
      <FxText :x="0" :y="0" :w="609.5" :h="64" scroll :text="i18n('SolderChooserPanel_des')" />
    </FxCanvas>
    <FxCanvas :x="281" :y="20" :w="120" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="120"
        :h="18"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('SolderChangePanel_tile')"
      />
    </FxCanvas>
    <FxCanvas :x="31" :y="156" :w="619.5" :h="256" style-name="BoardListUp">
      <FxLabel :x="36" :y="35" :text="t(1)" />
      <FxLabel :x="360" :y="35" :text="t(2)" />
      <FxLabel :x="137" :y="80" :text="t(3)" />
      <FxLabel :x="446" :y="83" :text="t(3)" />
      <FxNumericStepper
        v-model="fromNum"
        :x="179"
        :y="75"
        :enabled="fromType !== null"
        :maximum="maxSource"
        @change="changeFrom"
      />
      <FxNumericStepper v-model="toNum" :x="479" :y="78" :enabled="false" :maximum="maxTarget" />
      <FxLabel :x="189.5" :y="166" :text="t(4)" />
      <FxTextInput
        :x="255.25"
        :y="164"
        :w="80"
        style-name="DownEmptyInput"
        :editable="false"
        :model-value="rate"
      />
      <SoldierChangerItem :x="36" :y="61" :item="fromType" @click="choosing = 'from'" />
      <SoldierChangerItem :x="360" :y="64" :item="toType" @click="choosing = 'to'" />
      <FxButton
        :x="262.75"
        :y="210"
        style-name="ButtonGreen"
        :label="t(5)"
        :enabled="fromType !== null && toType !== null"
        @click="convert"
      />
    </FxCanvas>
    <FxButton :x="587.5" :y="431" :label="t(6)" @click="emit('close')" />
    <FxCanvas :x="28.5" :y="444" :w="105" :h="26" style-name="BoardListUp">
      <FxLabel
        :x="4"
        :y="4"
        :w="91"
        style-name="ItemTitle"
        :text="i18n('SolderChangePanel_remain')"
      />
    </FxCanvas>
    <FxCanvas :x="150.5" :y="444" :w="84" :h="26" style-name="BoardListDown">
      <FxLabel :x="4" :y="4" :w="72" style-name="ItemValue" :text="String(remain)" />
    </FxCanvas>
    <SolderChooserPanel
      v-if="choosing"
      :x="41"
      :y="67"
      :choices="choosing === 'from' ? from : to"
      @pick="pick"
      @close="choosing = null"
    />
  </FxCanvas>
</template>
