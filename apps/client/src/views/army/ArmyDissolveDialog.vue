<script setup lang="ts">
import { computed, ref } from 'vue';
import { resourceLines, type ArmySoldierState, type ResourceLine } from '../../game/soldiers';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Army.ArmyDissolveDialog: how many soldiers to disband for a third of their cost. */
const props = defineProps<{ soldier: ArmySoldierState }>();
const emit = defineEmits<{ dissolve: [sid: number, count: number]; close: [] }>();

const city = useCityStore();
const t = (key: string) => i18n(`Army_ArmyDissolveDialog_${key}`);

const count = ref(1);
const countText = ref('1');

const lines = computed(() =>
  resourceLines(
    props.soldier,
    city,
    (n) => i18n(`Army_ArmyDissolveDialogSrc_${n}`),
    (need) => Math.round(need * count.value * 0.33),
  ),
);
const columns: { header: string; field: keyof ResourceLine; width: number }[] = [
  { header: t('4_1'), field: 'condition', width: 80 },
  { header: t('5_1'), field: 'countNeed', width: 130 },
  { header: t('6_1'), field: 'countCurrent', width: 130 },
];

function setCount(n: number) {
  count.value = n;
  countText.value = String(n);
}

/** The original asks for the 二级密码 (OpenLockDialog) first, which is not ported. */
function onDissolve() {
  emit('close');
  if (count.value >= 1) emit('dissolve', props.soldier.sid, count.value);
}
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="160" :y="71" :w="362" :h="306" style-name="PanelGreyGreen">
      <FxCanvas :x="108" :y="10" :w="143" :h="27" style-name="PopupTitle">
        <FxLabel
          :x="5"
          :y="4"
          :w="133"
          style-name="PopupTitle"
          :fx="{ fontSize: 12, fontWeight: 'normal', textAlign: 'center', color: 15007634 }"
          :text="t('1_1') + soldier.sname"
        />
      </FxCanvas>
      <FxLabel :x="29" :bottom="103" style-name="ItemTitle" :text="t('2_1')" />
      <FxLabel :x="30" :bottom="64" style-name="ItemTitle" :text="t('3_1')" />
      <FxCanvas :x="91" :y="178" :w="108" :h="30" style-name="BoardListDown">
        <FxLabel :x="3" :y="5" :w="101" :fx="{ textAlign: 'right' }" :text="soldier.count" />
      </FxCanvas>
      <FxCanvas :x="8" :y="44" :w="346" :h="125" style-name="BoardListDown">
        <FxDataGrid :x="3" :y="3" :w="340" :h="119" :columns="columns" :rows="lines" />
      </FxCanvas>
      <FxButton
        :x="171"
        :y="216"
        :w="28"
        :h="16"
        style-name="MaxValue"
        @click="setCount(soldier.count)"
      />
      <FxButton :x="171" :y="232" :w="28" :h="16" style-name="MinValue" @click="setCount(1)" />
      <FxCanvas :x="91" :y="217" :w="83" :h="30" style-name="BoardListDown">
        <FxTextInput
          :x="3"
          :y="5"
          :w="73"
          :h="20"
          :max-chars="6"
          style-name="EmptyTextInput"
          :fx="{ backgroundAlpha: 0, borderStyle: 'none', textAlign: 'right', color: 16777215 }"
          :model-value="countText"
          @update:model-value="setCount(parseInt($event, 10) || 0)"
        />
      </FxCanvas>
      <FxButton :x="216.9" :bottom="13" style-name="Confirm" @click="onDissolve" />
      <FxButton :x="282.9" :bottom="13" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
