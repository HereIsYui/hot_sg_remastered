<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import {
  maxDraftCount,
  parseSoldier,
  resourceLines,
  type ArmySoldierState,
  type ResourceLine,
} from '../../game/soldiers';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import FxToggle from '../../ui/FxToggle.vue';

/** Army.ArmyDraftDialog: how many of a soldier type to queue, at single or double cost. */
const props = defineProps<{ soldier: ArmySoldierState }>();
const emit = defineEmits<{ draft: [sid: number, count: number, double: boolean]; close: [] }>();

const game = useGame();
const city = useCityStore();
const t = (key: string) => i18n(`Army_ArmyDraftDialog_${key}`);

/** Replaced by the changeSoldierInfo reply with the costs of the chosen mode. */
const soldier = shallowRef(props.soldier);
const count = ref(1);
const countText = ref('1');
const double = ref(false);

const maxCount = computed(() => maxDraftCount(soldier.value, city));
const draftTime = computed(() => timeLeftText(count.value * soldier.value.draft_time, i18n));
const lines = computed(() =>
  resourceLines(
    soldier.value,
    city,
    (n) => i18n(`Army_ArmyDraftDialogSrc_${n}`),
    (need) => need * count.value,
  ),
);
const columns: { header: string; field: keyof ResourceLine; width: number }[] = [
  { header: t('14_1'), field: 'condition', width: 80 },
  { header: t('15_1'), field: 'countNeed', width: 130 },
  { header: t('16_1'), field: 'countCurrent', width: 127 },
];
const stats = computed(() => {
  const s = soldier.value;
  return [
    [t('2_1'), s.hp],
    [t('3_1'), s.ap],
    [t('4_1'), s.dp],
    [t('5_1'), s.range],
    [t('6_1'), s.speed],
    [t('7_1'), s.carry],
    [t('8_1'), s.food_use],
    [t('9_1'), s.peopleNeed],
  ] as const;
});

function setCount(n: number) {
  count.value = n;
  countText.value = String(n);
}

function onCountChange(text: string) {
  const n = parseInt(text, 10) || 0;
  setCount(n <= 0 ? 1 : n);
}

function onChangeType(isDouble: boolean) {
  double.value = isDouble;
  game.sendGlobalCommand('armyDraft', 'changeSoldierInfo', [isDouble, city.cid, soldier.value.sid]);
}

function onDraft() {
  emit('close');
  if (count.value > 0) emit('draft', soldier.value.sid, count.value, double.value);
}

const unregister = game.addGlobalReceiver('armyDraft', (command, data) => {
  if (command !== 'changeSoldierInfo' || !Array.isArray(data)) return;
  const row = data[0];
  if (row && typeof row === 'object') soldier.value = parseSoldier(row as Record<string, unknown>);
});
onMounted(() => onChangeType(false));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="584"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="160" :y="10" :w="362" :h="485" style-name="PanelGreyGreen">
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
      <FxCanvas :x="10" :y="42" :w="342" :h="131" style-name="BoardListDown">
        <FxCanvas :x="10" :y="3" :w="68" :h="68" style-name="FramePicture">
          <FxImage :x="1" :y="2" :w="64" :h="64" :source="`images/army_${soldier.sid}_big.png`" />
        </FxCanvas>
        <FxCanvas :x="86" :y="4" :w="251" :h="66" style-name="BoardListUp">
          <FxText
            :x="6"
            :y="3"
            :w="245"
            :h="61"
            type="TextArea"
            :fx="{ color: 16777215 }"
            :text="soldier.description"
          />
        </FxCanvas>
        <FxCanvas
          v-for="([label, value], i) in stats"
          :key="i"
          :x="5 + (i % 4) * 84"
          :y="i < 4 ? 74 : 102"
          :w="80"
          :h="25"
          style-name="BoardListDown"
        >
          <FxLabel :x="2" :y="2" :fx="{ color: 16176989, fontWeight: 'bold' }" :text="label" />
          <FxLabel
            :x="31"
            :y="2"
            :w="48"
            :fx="{ color: 16777215, textAlign: 'right' }"
            :text="value"
          />
        </FxCanvas>
      </FxCanvas>
      <FxCanvas :x="10" :y="177" :w="343" :h="131" style-name="BoardListDown">
        <FxDataGrid :x="3" :y="3" :w="337" :h="125" :columns="columns" :rows="lines" />
      </FxCanvas>
      <FxToggle
        type="RadioButton"
        :x="10"
        :y="312"
        :label="t('17_1')"
        :selected="!double"
        @change="onChangeType(false)"
      />
      <FxToggle
        type="RadioButton"
        :x="177"
        :y="312"
        :label="t('18_1')"
        :selected="double"
        @change="onChangeType(true)"
      />
      <FxLabel
        :x="177"
        :bottom="84"
        style-name="ItemTitle"
        :fx="{ color: 16757760 }"
        :text="t('10_1')"
      />
      <FxLabel :x="10" :bottom="123" style-name="ItemTitle" :text="t('11_1')" />
      <FxLabel :x="10" :bottom="84" style-name="ItemTitle" :text="t('12_1')" />
      <FxLabel
        :x="177"
        :bottom="122"
        style-name="ItemTitle"
        :fx="{ color: 16757760 }"
        :text="t('13_1')"
      />
      <FxCanvas :x="240.95" :y="338" :w="83" :h="30" style-name="BoardListDown">
        <FxTextInput
          :x="10"
          :y="3"
          :w="66"
          :h="25"
          :max-chars="6"
          style-name="EmptyTextInput"
          :fx="{ backgroundAlpha: 0, borderStyle: 'none', textAlign: 'right', color: 16777215 }"
          :model-value="countText"
          @update:model-value="onCountChange"
        />
      </FxCanvas>
      <FxButton
        :x="324"
        :y="338"
        :w="28"
        :h="16"
        style-name="MaxValue"
        @click="setCount(maxCount)"
      />
      <FxButton :x="324" :y="353" :w="28" :h="16" style-name="MinValue" @click="setCount(1)" />
      <FxCanvas :x="69" :y="338" :w="100" :h="30" style-name="BoardListDown">
        <FxLabel :x="4" :y="5" :w="90" :fx="{ textAlign: 'right' }" :text="soldier.count" />
      </FxCanvas>
      <FxCanvas :x="69" :y="376" :w="100" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="4"
          :y="5"
          :w="90"
          :fx="{ textAlign: 'right', color: 16777215 }"
          :text="maxCount"
        />
      </FxCanvas>
      <FxCanvas :x="240.95" :y="376" :w="108" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="5"
          :w="108"
          :h="20"
          :fx="{ textAlign: 'center', color: 458496 }"
          :text="draftTime"
        />
      </FxCanvas>
      <FxLabel :x="10" :y="409" :w="342" :h="19" :text="t('19_1')" />
      <FxLabel :x="10" :y="428" :w="342" :h="19" :text="t('19_2')" />
      <FxButton :x="217.9" :bottom="7" style-name="Confirm" @click="onDraft" />
      <FxButton :x="283.95" :bottom="7" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
