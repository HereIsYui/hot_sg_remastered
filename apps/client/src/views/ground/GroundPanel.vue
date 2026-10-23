<script setup lang="ts">
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';

/**
 * Ground.GroundPanel: the 校场's six action buttons — 出征, 募兵, 防守战术, 伤兵, 逃兵, 俘虏.
 * 出征 (the world-map dispatch of the next wave) shows 暂未开放.
 */
defineProps<{ x: number; y: number }>();
const emit = defineEmits<{
  campaign: [];
  conscript: [];
  resist: [];
  wounded: [];
  lamster: [];
  captive: [];
  attack: [];
  maneuver: [];
}>();

/** Button labels fall back to the original 校场 names when the lang bundle lacks them. */
const label = (key: string, fallback: string) => i18n(key) || fallback;
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="700" :h="320" :fx="{ backgroundAlpha: 0 }">
    <FxButton
      :x="20"
      :y="20"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_1', '出征')"
      @click="emit('campaign')"
    />
    <FxButton
      :x="160"
      :y="20"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_2', '募兵')"
      @click="emit('conscript')"
    />
    <FxButton
      :x="300"
      :y="20"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_3', '防守战术')"
      @click="emit('resist')"
    />
    <FxButton
      :x="20"
      :y="70"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_4', '伤兵')"
      @click="emit('wounded')"
    />
    <FxButton
      :x="160"
      :y="70"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_5', '逃兵')"
      @click="emit('lamster')"
    />
    <FxButton
      :x="300"
      :y="70"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_6', '俘虏')"
      @click="emit('captive')"
    />
    <FxButton
      :x="20"
      :y="120"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_7', '出征战术')"
      @click="emit('attack')"
    />
    <FxButton
      :x="160"
      :y="120"
      :w="120"
      style-name="ButtonYellow"
      :label="label('Ground_GroundPanelSrc_8', '演习')"
      @click="emit('maneuver')"
    />
  </FxCanvas>
</template>
