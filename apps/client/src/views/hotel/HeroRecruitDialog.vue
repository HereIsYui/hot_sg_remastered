<script setup lang="ts">
import { computed } from 'vue';
import { recruitFace, type HeroRecruit } from '../../game/hotel';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Hotel.HeroRecruitDialog: a recruit's attributes and what hiring takes. */
const props = defineProps<{ recruit: HeroRecruit; validPosition: number }>();
const emit = defineEmits<{ recruit: [id: number]; close: [] }>();

const city = useCityStore();
const t = (n: number) => i18n(`Hotel_HeroRecruitDialog_${n}_1`);

type Condition = { condition: string; countNeed: number; countCurrent: number };
const columns: { header: string; field: keyof Condition; width: number }[] = [
  { header: t(2), field: 'condition', width: 112 },
  { header: t(3), field: 'countNeed', width: 112 },
  { header: t(4), field: 'countCurrent', width: 112 },
];
/** `resetCondition`. */
const conditions = computed<Condition[]>(() => [
  {
    condition: i18n('Hotel_HeroRecruitDialogSrc_1'),
    countNeed: 1,
    countCurrent: props.validPosition,
  },
  {
    condition: i18n('Hotel_HeroRecruitDialogSrc_2'),
    countNeed: props.recruit.gold_need,
    countCurrent: Math.round(city.gold),
  },
]);

const stats = computed(() => {
  const r = props.recruit;
  return [
    [90, 86, t(5), r.level],
    [90, 115, t(6), r.bravery_base + r.bravery_add],
    [90, 144, t(8), r.loyalty],
    [224, 86, t(9), r.affairs_base + r.affairs_add],
    [224, 115, t(10), r.wisdom_base + r.wisdom_add],
    [224, 144, t(11), r.level * 20],
  ] as const;
});

/** `onRecruitHero`. */
function onRecruit() {
  emit('recruit', props.recruit.id);
  emit('close');
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
    <FxCanvas :x="160" :y="81" :w="362" :h="355" style-name="PanelGreyGreen">
      <FxCanvas :x="144.5" :y="10" :w="73" :h="26" style-name="PopupTitle">
        <FxLabel :x="11" :y="3" style-name="PopupDialogTitle" :text="t(7)" />
      </FxCanvas>
      <FxCanvas :x="130.5" :y="45" :w="101" :h="33" style-name="BoardListDown">
        <FxLabel
          :x="3.25"
          :y="3"
          :w="97.75"
          :h="26"
          style-name="ItemValue"
          :fx="{ fontWeight: 'bold', textAlign: 'center', fontSize: 16, fontStyle: 'normal' }"
          :text="recruit.hname"
        />
      </FxCanvas>
      <FxCanvas :x="14" :y="86" :w="68" :h="84" style-name="FramePicture">
        <FxImage :x="2" :y="2" :w="64" :h="80" :source="recruitFace(recruit)" />
      </FxCanvas>
      <template v-for="[x, y, label, value] in stats" :key="`${x},${y}`">
        <FxCanvas :x="x" :y="y" :w="48" :h="25" style-name="BoardListUp">
          <FxLabel :x="8" :y="2" style-name="ItemTitle" :text="label" />
        </FxCanvas>
        <FxCanvas :x="x + 51" :y="y" :w="73" :h="25" style-name="BoardListDown">
          <FxLabel
            :x="2"
            :y="3"
            :w="69"
            style-name="ItemValue"
            :fx="{ textAlign: 'center' }"
            :text="value"
          />
        </FxCanvas>
      </template>
      <FxCanvas :x="10" :y="175" :w="340" :h="72" style-name="BoardListUp">
        <FxDataGrid :x="2" :y="2" :w="336" :h="68" :columns="columns" :rows="conditions" />
      </FxCanvas>
      <FxCanvas :x="10" :y="251" :w="340" :h="52" style-name="BoardListDown">
        <FxText :x="5" :y="3" :w="325" :h="48" type="TextArea" :text="t(12)" />
      </FxCanvas>
      <FxButton
        :x="218"
        :bottom="10"
        :w="65"
        :h="36"
        style-name="ButtonRed"
        :fx="{ fontSize: 16 }"
        :label="t(1)"
        @click="onRecruit"
      />
      <FxButton
        :x="287"
        :bottom="10"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
