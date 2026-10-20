<script setup lang="ts">
import { computed } from 'vue';
import { armorInfo, armorTip, armorTipRow, type Armor } from '../../game/armor';
import { skillImage, skillTip } from '../../game/skill';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import type { TipValue } from '../../ui/tooltip';

/** Armor.ChangeArmorItem: a piece, or a skill book, the hero could put on. */
const props = defineProps<{
  x: number;
  y: number;
  armor?: Armor;
  book?: Record<string, unknown>;
}>();
const emit = defineEmits<{ pick: [] }>();

/** `setItem`: name colours by armor type; others keep the first one. */
const TYPE_COLORS: Partial<Record<string, number>> = {
  1: 7368816,
  2: 16777215,
  3: 3385344,
  4: 37119,
  5: 10040319,
  6: 16776960,
};

const row = computed(() => props.armor?.row ?? props.book ?? {});
const name = computed(() => {
  const level = String(row.value.combine_level ?? '');
  const prefix = /^[1-7]$/.test(level) ? i18n(`BlackSmith_ArmorQuailtyDesc_${level}`) : '';
  return prefix + String(row.value.name ?? '');
});
const color = computed(() => TYPE_COLORS[String(row.value.type)] ?? 7368816);
const image = computed(() =>
  props.armor ? props.armor.imageName : skillImage(row.value.bid, row.value.level),
);
const count = computed(() =>
  props.book ? `${String(row.value.level ?? '')}${i18n('Hero_Skilltip_1')}` : '',
);
const tip = computed<TipValue>(() => {
  const a = props.armor;
  return a ? { armor: () => armorTip(armorInfo, armorTipRow(a)) } : { skill: skillTip(row.value) };
});
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="78" :h="90" style-name="BoardListDown">
    <FxCanvas :x="5" :y="4" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="image"
        :tip="tip"
        hand
        @click="emit('pick')"
      />
      <FxLabel
        :x="0"
        :y="49"
        :w="68"
        :h="19"
        class="count"
        :fx="{ color: 16777215, textAlign: 'right' }"
        :text="count"
      />
    </FxCanvas>
    <FxLabel
      :x="3"
      :y="70"
      :w="75"
      :h="20"
      :fx="{ textAlign: 'center', color }"
      :text="name"
      @click="emit('pick')"
    />
  </FxCanvas>
</template>

<style scoped>
.count {
  pointer-events: none;
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
