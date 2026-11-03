<script setup lang="ts">
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';

/**
 * Battle.BattleTroopEmptyItem: the empty troop slot of the map's heroPanel — the jiang frame
 * with the 需要出征 tip (`showTroopEmptyOnTimer` blinking is reduced to a static hint).
 */
defineProps<{ index: number }>();
const tip = i18n('Battle_BattleTroopEmptyItem_1_1');
</script>

<template>
  <FxCanvas :w="41" :h="40">
    <FxCanvas :x="4" :y="0" :w="33" :h="40">
      <FxImage :x="2" :y="2" :w="29" :h="36" source="images/jiang_frame.png" :tip="tip" />
    </FxCanvas>
  </FxCanvas>
</template>
