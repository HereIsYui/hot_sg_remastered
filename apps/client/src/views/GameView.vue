<script setup lang="ts">
import { useSessionStore } from '../stores/session';
import ColorFilters from '../ui/ColorFilters.vue';
import BottomPanel from './game/BottomPanel.vue';
import CityInnerPanel from './game/CityInnerPanel.vue';
import CityPanel from './game/CityPanel.vue';
import DialogManager from './game/DialogManager.vue';
import InfoPanel from './game/InfoPanel.vue';
import ServerTime from './game/ServerTime.vue';
import TopPanel from './game/TopPanel.vue';
import WorldPanel from './world/WorldPanel.vue';

/** Main game screen (BloodWar.mxml layout): the scene panels, with the bars on top. */
const session = useSessionStore();
</script>

<template>
  <div class="game-view">
    <ColorFilters />
    <InfoPanel />
    <CityInnerPanel v-if="session.view === 'cityInner'" :x="263" :y="0" />
    <CityPanel v-if="session.view === 'city'" :x="264" :y="0" />
    <WorldPanel v-if="session.view === 'world'" />
    <ServerTime :x="538" :y="65" />
    <TopPanel :x="264" :y="0" />
    <DialogManager :x="289" :y="54" />
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
