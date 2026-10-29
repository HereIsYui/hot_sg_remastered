<script setup lang="ts">
import { computed } from 'vue';
import { battleIntro } from '../../game/luoyang';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxText from '../../ui/FxText.vue';

/**
 * LuoYang.IntroTip: the 战场说明 tip box of LuoYangBelongPanel (`showToopTip`), assembled from
 * LuoYang_Belong_tip_1..6 plus the cfg_battle_field win/lose conditions.
 */
const props = defineProps<{ battle: Record<string, unknown> }>();
const text = computed(() => battleIntro(props.battle, i18n));
</script>

<template>
  <FxCanvas :x="10" :y="290" :w="300" :h="180" style-name="BoardListUp">
    <FxText
      :x="8"
      :y="6"
      :w="284"
      :h="168"
      :html="text.replace(/\n/g, '<br />')"
      :fx="{ color: 16777215 }"
    />
  </FxCanvas>
</template>
