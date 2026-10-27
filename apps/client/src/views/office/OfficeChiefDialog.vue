<script setup lang="ts">
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

const props = defineProps<{
  heroes: Record<string, unknown>[];
  onSave: (args: [number, number][]) => void;
}>();
const emit = defineEmits<{ close: [] }>();
const eligible = computed(() => props.heroes.filter((h) => [0, 1, 7, 8].includes(Number(h.state))));
const labels = computed(() => [
  '不任命',
  ...eligible.value.map((h) => `${String(h.name)}（${Number(h.level) || 0}级）`),
]);
const chief = ref(0);
const general = ref(0);
const counsellor = ref(0);

function initial(type: number): number {
  const index = eligible.value.findIndex((h) => Number(h.state) === type);
  return index < 0 ? 0 : index + 1;
}
chief.value = initial(1);
general.value = initial(7);
counsellor.value = initial(8);

function hid(index: number): number {
  return index === 0 ? 0 : Number(eligible.value[index - 1]?.hid) || 0;
}
function save(): void {
  props.onSave([
    [hid(chief.value), 1],
    [hid(general.value), 7],
    [hid(counsellor.value), 8],
  ]);
}
</script>

<template>
  <FxCanvas :x="156" :y="116" :w="370" :h="260" style-name="PanelGreyGreen">
    <FxCanvas :x="110" :y="10" :w="150" :h="27" style-name="PopupTitle">
      <FxLabel
        :x="5"
        :y="4"
        :w="140"
        :fx="{ textAlign: 'center', color: 15007634 }"
        :text="i18n('Office_OfficeHeroPanel_3_1') || '任命'"
      />
    </FxCanvas>
    <FxLabel :x="30" :y="60" :w="60" text="城守" />
    <FxButton
      v-for="(label, i) in labels"
      :key="`chief-${i}`"
      :x="100 + i * 80"
      :y="55"
      :w="75"
      :h="26"
      :style-name="chief === i ? 'ButtonGreen' : 'ButtonGrey'"
      :label="label"
      @click="chief = i"
    />
    <FxLabel :x="30" :y="110" :w="60" text="主将" />
    <FxButton
      v-for="(label, i) in labels"
      :key="`general-${i}`"
      :x="100 + i * 80"
      :y="105"
      :w="75"
      :h="26"
      :style-name="general === i ? 'ButtonGreen' : 'ButtonGrey'"
      :label="label"
      @click="general = i"
    />
    <FxLabel :x="30" :y="160" :w="60" text="军师" />
    <FxButton
      v-for="(label, i) in labels"
      :key="`counsellor-${i}`"
      :x="100 + i * 80"
      :y="155"
      :w="75"
      :h="26"
      :style-name="counsellor === i ? 'ButtonGreen' : 'ButtonGrey'"
      :label="label"
      @click="counsellor = i"
    />
    <FxButton :x="80" :bottom="18" style-name="Confirm" @click="save" />
    <FxButton :x="200" :bottom="18" style-name="Return" @click="emit('close')" />
  </FxCanvas>
</template>
