<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Bar.BottomPanel: chat input bar and the right-aligned function buttons. */
defineProps<{ x?: number; y?: number }>();

/** Right-anchored function buttons, 31px apart (friend ... shop). */
const FUNCTIONS = [
  'ButtonFriend',
  'ButtonReport',
  'ButtonMail',
  'ButtonRank',
  'ButtonStat',
  'ButtonUnion',
  'ButtonAchievement',
  'ButtonSystem',
  'ButtonCharge',
  'ButtonShop',
] as const;

const chatText = ref('');
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="736" :h="44" style-name="FrameScreenBoard">
    <FxButton
      v-for="(name, i) in FUNCTIONS"
      :key="name"
      :style-name="name"
      :right="4 + 31 * (FUNCTIONS.length - 1 - i)"
      :bottom="4"
    />
    <FxImage :left="3" :top="4" :w="428" source="images/chatbar.png" />
    <FxButton :x="348" :y="9" :w="28" :h="24" style-name="ButtonSend" />
    <FxButton :x="378" :y="9" :w="28" :h="24" style-name="ButtonChatControl1" />
    <FxTextInput
      v-model="chatText"
      :x="102"
      :y="12"
      :w="250"
      :h="20"
      :max-chars="100"
      style-name="EmptyTextInput"
      :fx="{ backgroundAlpha: 0, borderStyle: 'none', color: 16777215 }"
    />
    <FxButton
      :x="15"
      :y="8"
      :w="84"
      :h="26"
      style-name="ChatChannel"
      :label="i18n('Bar_BottomPanel_1_1')"
    />
  </FxCanvas>
</template>
