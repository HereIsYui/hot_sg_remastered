<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '../../i18n';
import type { PickerHero } from '../../game/campaign-pk';
import { heroStateName } from '../../game/units';
import type { TipValue } from '../../ui/tooltip';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * GuoGuanZhanJiang.HeroItem: one own-hero row of SelectHeroPanel — the small portrait, the name,
 * the level 级 and the busy state name.
 */
const props = defineProps<{ item: PickerHero; heroImage: string; tip: TipValue }>();
const emit = defineEmits<{ select: [PickerHero] }>();
const statename = computed(() => heroStateName(props.item));
</script>

<template>
  <FxCanvas :w="122" :h="40" :fx="{ fontSize: 12 }">
    <FxCanvas :x="4" :y="0" :w="33" :h="40" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="29"
        :h="36"
        :source="props.heroImage"
        :tip="props.tip"
        hand
        @click="emit('select', props.item)"
      />
    </FxCanvas>
    <FxCanvas
      :x="40"
      :y="0"
      :w="80"
      :h="40"
      style-name="BoardListDown"
      hand
      @click="emit('select', props.item)"
    >
      <FxLabel
        :x="4"
        :y="2"
        :w="75"
        :fx="{ color: 12368744, fontWeight: 'bold' }"
        :text="String(props.item.name ?? '')"
      />
      <FxLabel
        :x="4"
        :y="20"
        :w="45"
        :fx="{ color: 16777215 }"
        :text="`${Number(props.item.level ?? 0)}${i18n('Hero_InfoHeroItem_1_1')}`"
      />
      <FxLabel
        :x="44"
        :y="20"
        :w="32"
        :fx="{ color: 4179426, textAlign: 'center' }"
        :text="statename"
      />
    </FxCanvas>
  </FxCanvas>
</template>
