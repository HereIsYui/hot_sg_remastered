<script setup lang="ts">
import BottomPanel from './game/BottomPanel.vue';
import InfoPanel from './game/InfoPanel.vue';
import ServerTime from './game/ServerTime.vue';
import TopPanel from './game/TopPanel.vue';

/**
 * Main game screen (BloodWar.mxml layout): the city/world scene is rendered by Pixi underneath;
 * the panels sit on top at the original coordinates.
 */
</script>

<template>
  <div class="game-view">
    <InfoPanel />
    <ServerTime :x="538" :y="65" />
    <TopPanel :x="264" :y="0" />
    <BottomPanel :x="263" :y="555" />
  </div>
</template>

<style scoped>
.game-view {
  position: absolute;
  inset: 0;
  pointer-events: none !important;
}

.game-view > :deep(*) {
  pointer-events: auto;
}
</style>
