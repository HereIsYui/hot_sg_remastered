<script setup lang="ts">
import type { TipValue } from '../../ui/tooltip';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * GuoGuanZhanJiang.BattleItem: one chapter tile of the ladder strip — the serial image, a dim
 * cover while `locked`, and the name label under it. `selected` paints the highlight frame.
 */
const props = defineProps<{
  label: string;
  image: string;
  locked: boolean;
  selected: boolean;
  tip: TipValue;
}>();
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <FxCanvas :w="80" :h="92">
    <FxCanvas :x="6" :y="3" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="props.image"
        :tip="props.tip"
        hand
        @click="emit('click')"
      />
      <!-- the dim cover of a locked chapter (`BattleItem.setItem`, backgroundColor 0 alpha .6) -->
      <FxCanvas
        v-if="props.locked"
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :tip="props.tip"
        :fx="{ backgroundAlpha: 0.6, backgroundColor: 0 }"
        hand
        @click="emit('click')"
      />
      <!-- selection frame (`BattleItem.setItem` highlights the picked chapter) -->
      <FxCanvas
        v-if="props.selected"
        :x="0"
        :y="0"
        :w="68"
        :h="68"
        :fx="{ backgroundAlpha: 0.12, backgroundColor: 16776960 }"
        hand
        @click="emit('click')"
      />
    </FxCanvas>
    <FxLabel
      :x="0"
      :y="72"
      :w="80"
      :h="18"
      style-name="ItemValue"
      :fx="{ textAlign: 'center' }"
      :text="props.label"
    />
  </FxCanvas>
</template>
