<script setup lang="ts">
import { computed } from 'vue';
import {
  armorInfo,
  armorItemColor,
  armorItemName,
  armorTip,
  armorTipRow,
  type Armor,
} from '../../game/armor';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import type { TipValue } from '../../ui/tooltip';

/**
 * Armor.UserArmorItem: a stored piece; the click (menu or batch selection) is the dialog's.
 * `selected` shows the batch frame.
 */
const props = defineProps<{ x: number; y: number; armor: Armor; selected?: boolean }>();
const emit = defineEmits<{ pick: [e: MouseEvent] }>();

const name = computed(() => armorItemName(props.armor.row));
const color = computed(() => armorItemColor(props.armor.row));
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
        @click="emit('pick', $event)"
      />
    </FxCanvas>
    <FxLabel :x="3" :y="70" :w="75" :h="20" :fx="{ textAlign: 'center', color }" :text="name" />
    <FxImage
      v-if="selected"
      :x="4"
      :y="3"
      :w="70"
      :h="70"
      source="images/selected_armor_frame.png"
      :tip="tip"
      hand
      @click="emit('pick', $event)"
    />
  </FxCanvas>
</template>
