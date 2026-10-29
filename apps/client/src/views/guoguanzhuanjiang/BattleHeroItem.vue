<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '../../i18n';
import type { TipValue } from '../../ui/tooltip';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * GuoGuanZhanJiang.BattleHeroItem: one NPC tile of the ladder strip — the hero portrait with the
 * `showState` overlays (dim cover -1 未解锁, has_passed 1 已过), the selection frame and the
 * 第N楼 caption.
 */
const props = defineProps<{
  heroImage: string;
  name: string;
  levelid: number;
  showState: number;
  selected: boolean;
  tip: TipValue;
}>();
const emit = defineEmits<{ click: [] }>();
const floor = computed(
  () =>
    i18n('Hero_Battle_Dialog_battle_hero_1') +
    props.levelid +
    i18n('Hero_Battle_Dialog_battle_hero_2'),
);
</script>

<template>
  <FxCanvas :w="71" :h="108" style-name="FramePicture">
    <FxImage
      :x="3"
      :y="3"
      :w="64"
      :h="80"
      :source="props.heroImage"
      :tip="props.tip"
      hand
      @click="emit('click')"
    />
    <!-- showState -1: the level is beyond reach — dim it -->
    <FxCanvas
      v-if="props.showState === -1"
      :x="2"
      :y="0"
      :w="66"
      :h="85"
      :tip="props.tip"
      :fx="{ backgroundColor: 0, backgroundAlpha: 0.6 }"
      hand
      @click="emit('click')"
    />
    <!-- showState 1: already passed -->
    <FxImage
      v-if="props.showState === 1"
      :x="3"
      :y="3"
      :w="64"
      :h="80"
      source="images/has_passed.png"
      :tip="props.tip"
      hand
      @click="emit('click')"
    />
    <!-- the selected frame (selectedHeroCav) -->
    <FxCanvas
      v-if="props.selected"
      :x="0"
      :y="0"
      :w="71"
      :h="85"
      :tip="props.tip"
      :fx="{ backgroundColor: 16776960, backgroundAlpha: 0.18 }"
      hand
      @click="emit('click')"
    />
    <FxLabel
      :x="23"
      :y="66"
      :w="45"
      :fx="{ color: 16777215, textAlign: 'right' }"
      :text="props.name"
    />
    <FxCanvas :x="3" :y="84" :w="64" :h="23" style-name="BoardListDown">
      <FxLabel
        :x="3"
        :w="64"
        style-name="ItemValue"
        :fx="{ paddingTop: 3, textAlign: 'center' }"
        :text="floor"
      />
    </FxCanvas>
  </FxCanvas>
</template>
