<script setup lang="ts">
import { computed, ref } from 'vue';
import { timeLeftText } from '../../core/clock';
import { maxReinforceCount, type WallDefenceState } from '../../game/defences';
import { resourceLines, type ResourceLine } from '../../game/soldiers';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Wall.WallReinforceDialog: how many of a defence type to queue. */
const props = defineProps<{ defence: WallDefenceState }>();
const emit = defineEmits<{ reinforce: [did: number, count: number]; close: [] }>();

const city = useCityStore();
const t = (key: string) => i18n(`Wall_WallReinforceDialog_${key}`);

/** The original's `onShow`: the maximum is fixed when the dialog opens. */
const maxCount = maxReinforceCount(props.defence, city);
const count = ref(1);
const countText = ref('1');

const reinforceTime = computed(() =>
  timeLeftText(count.value * props.defence.reinforce_time, i18n),
);
const lines = computed(() =>
  resourceLines(
    props.defence,
    city,
    (n) => i18n(`Wall_WallReinforceDialogSrc_${n}`),
    (need) => need * count.value,
  ),
);
/** The third column's item renderer turns red when the city is short. */
const columns: {
  header: string;
  field: keyof ResourceLine;
  width: number;
  color?: (row: ResourceLine) => number;
}[] = [
  { header: t('5_1'), field: 'condition', width: 80 },
  { header: t('6_1'), field: 'countNeed', width: 130 },
  {
    header: t('7_1'),
    field: 'countCurrent',
    width: 126,
    color: (row) => (row.countCurrent >= row.countNeed ? 16777215 : 16711680),
  },
];
const stats = computed(() => {
  const d = props.defence;
  return [
    [t('9_1'), d.hp],
    [t('10_1'), d.ap],
    [t('11_1'), d.dp],
    [t('12_1'), d.range],
    [t('13_1'), d.areaNeed],
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

function onReinforce() {
  emit('close');
  if (count.value > 0) emit('reinforce', props.defence.did, count.value);
}
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, borderStyle: 'none', backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="160" :y="9" :w="362" :h="429" style-name="PanelGreyGreen">
      <FxCanvas :x="108" :y="10" :w="143" :h="27" style-name="PopupTitle">
        <FxLabel
          :x="5"
          :y="4"
          :w="133"
          style-name="PopupTitle"
          :fx="{ fontSize: 12, fontWeight: 'normal', textAlign: 'center', color: 15007634 }"
          :text="t('8_1') + defence.dname"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="42" :w="342" :h="131" style-name="BoardListDown">
        <FxCanvas :x="10" :y="3" :w="68" :h="68" style-name="FramePicture">
          <FxImage
            :x="1"
            :y="2"
            :w="64"
            :h="64"
            :source="`images/defence_${defence.did}_big.png`"
          />
        </FxCanvas>
        <FxCanvas :x="86" :y="4" :w="251" :h="66" style-name="BoardListUp">
          <FxText
            :x="6"
            :y="3"
            :w="245"
            :h="61"
            type="TextArea"
            :fx="{ color: 16777215 }"
            :text="defence.description"
          />
        </FxCanvas>
        <FxCanvas
          v-for="i in 8"
          :key="i"
          :x="[5, 89, 173, 257][(i - 1) % 4]"
          :y="i <= 4 ? 74 : 102"
          :w="80"
          :h="25"
          style-name="BoardListDown"
        >
          <template v-if="stats[i - 1]">
            <FxLabel
              :x="2"
              :y="2"
              :fx="{ color: 16176989, fontWeight: 'bold' }"
              :text="stats[i - 1]![0]"
            />
            <FxLabel
              :x="31"
              :y="2"
              :w="48"
              :fx="{ color: 16777215, textAlign: 'right' }"
              :text="stats[i - 1]![1]"
            />
          </template>
        </FxCanvas>
      </FxCanvas>
      <FxCanvas :x="10" :y="177" :w="343" :h="131" style-name="BoardListDown">
        <FxDataGrid :x="3.5" :y="4" :w="336" :h="124" :columns="columns" :rows="lines" />
      </FxCanvas>
      <FxLabel
        :x="177"
        :bottom="59"
        style-name="ItemTitle"
        :fx="{ color: 16757760 }"
        :text="t('1_1')"
      />
      <FxLabel :x="10" :bottom="90" style-name="ItemTitle" :text="t('2_1')" />
      <FxLabel :x="10" :bottom="57" style-name="ItemTitle" :text="t('3_1')" />
      <FxLabel
        :x="176"
        :bottom="91"
        style-name="ItemTitle"
        :fx="{ color: 16757760 }"
        :text="t('4_1')"
      />
      <FxCanvas :x="237" :y="313" :w="83" :h="30" style-name="BoardListDown">
        <FxTextInput
          :x="3"
          :y="5"
          :w="73"
          :h="20"
          :max-chars="6"
          style-name="EmptyTextInput"
          :fx="{ backgroundAlpha: 0, borderStyle: 'none', textAlign: 'right', color: 16777215 }"
          :model-value="countText"
          @update:model-value="onCountChange"
        />
      </FxCanvas>
      <FxButton
        :x="317"
        :y="312"
        :w="28"
        :h="16"
        style-name="MaxValue"
        @click="setCount(maxCount)"
      />
      <FxButton :x="317" :y="328" :w="28" :h="16" style-name="MinValue" @click="setCount(1)" />
      <FxCanvas :x="69" :y="314" :w="100" :h="30" style-name="BoardListDown">
        <FxLabel :x="4" :y="5" :w="90" :fx="{ textAlign: 'right' }" :text="defence.count" />
      </FxCanvas>
      <FxCanvas :x="69" :y="347" :w="100" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="4"
          :y="5"
          :w="90"
          :fx="{ textAlign: 'right', color: 16777215 }"
          :text="maxCount"
        />
      </FxCanvas>
      <FxCanvas :x="237" :y="346" :w="108" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="5"
          :w="108"
          :h="20"
          :fx="{ textAlign: 'center', color: 458496 }"
          :text="reinforceTime"
        />
      </FxCanvas>
      <FxButton :x="217.9" :bottom="10" style-name="Confirm" @click="onReinforce" />
      <FxButton :x="283.95" :bottom="10" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
