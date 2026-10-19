<script setup lang="ts">
import { useGame } from './game/game';
import GameStage from './stage/GameStage.vue';
import OverlayLayer from './ui/OverlayLayer.vue';
import CreateRoleView from './views/CreateRoleView.vue';
import GameView from './views/GameView.vue';
import GuideLayer from './views/guide/GuideLayer.vue';
import JackarooDialog from './views/guide/JackarooDialog.vue';
import LoginView from './views/LoginView.vue';

const session = useGame().session;
</script>

<template>
  <GameStage :class="{ busy: session.busy > 0 }">
    <div v-if="session.screen === 'loading'" class="loading">
      <div class="bar">
        <div class="fill" :style="{ width: `${session.loadProgress * 100}%` }" />
      </div>
    </div>
    <LoginView v-else-if="session.screen === 'login'" />
    <CreateRoleView v-else-if="session.screen === 'createRole'" />
    <GameView v-else-if="session.screen === 'game'" />
    <GuideLayer />
    <JackarooDialog v-if="session.welcome" />
    <OverlayLayer />
  </GameStage>
</template>

<style scoped>
.busy {
  cursor: wait;
}

.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bar {
  width: 300px;
  height: 8px;
  border: 1px solid #6b5a2e;
}

.fill {
  height: 100%;
  background: #c9a14a;
  transition: width 0.1s;
}
</style>
