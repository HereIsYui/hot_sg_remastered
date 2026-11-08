<script setup lang="ts">
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
const emit = defineEmits<{ close: [] }>();
</script>
<template>
  <FxCanvas :x="181" :y="110" :w="320" :h="260" style-name="PopupDialog">
    <FxLabel :x="20" :y="20" :w="280" :text="i18n('Good_GetAnswerRewardDialog_1_1')" />
    <FxImage :x="128" :y="70" :w="64" :h="64" source="images/item_150.png" />
    <FxLabel :x="20" :y="150" :w="280" :text="i18n('Good_GetAnswerRewardDialog_2_1')" />
    <FxButton :right="20" :bottom="20" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
