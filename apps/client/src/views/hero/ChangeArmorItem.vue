<script setup lang="ts">
import { computed } from 'vue';
import { armorInfo, armorTip, armorTipRow, type Armor } from '../../game/armor';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import type { TipValue } from '../../ui/tooltip';

/** Armor.ChangeArmorItem: a piece the hero could put on. */
const props = defineProps<{ x: number; y: number; armor: Armor }>();
const emit = defineEmits<{ pick: [armor: Armor] }>();

/** `setItem`: name colours by armor type. */
const TYPE_COLORS: Partial<Record<string, number>> = {
  1: 7368816,
  2: 16777215,
  3: 3385344,
  4: 37119,
  5: 10040319,
  6: 16776960,
};

const name = computed(() => {
  const row = props.armor.row;
  const level = String(row.combine_level ?? '');
  const prefix = /^[1-7]$/.test(level) ? i18n(`BlackSmith_ArmorQuailtyDesc_${level}`) : '';
  return prefix + String(row.name ?? '');
});
const color = computed(() => TYPE_COLORS[String(props.armor.row.type)] ?? 16777215);
const tip = computed<TipValue>(() => ({
  armor: () => armorTip(armorInfo, armorTipRow(props.armor)),
}));
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="78" :h="90" style-name="BoardListDown">
    <FxCanvas :x="5" :y="4" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="armor.imageName"
        :tip="tip"
        hand
        @click="emit('pick', armor)"
      />
    </FxCanvas>
    <FxLabel
      :x="3"
      :y="70"
      :w="75"
      :h="20"
      :fx="{ textAlign: 'center', color }"
      :text="name"
      @click="emit('pick', armor)"
    />
  </FxCanvas>
</template>
