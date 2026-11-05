<script setup lang="ts">
import { useGame } from '../../game/game';
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import BlackSmithCommandPanel from './BlackSmithCommandPanel.vue';

/**
 * BlackSmith.BSDialog: the 铁匠铺's upgrade dialog. The original overlays its BSCommandDialog on
 * `onShow`, so the command panel sits on top once the building is built.
 */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

const game = useGame();
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ level }">
      <BlackSmithCommandPanel v-if="level > 0" @close="game.closeDialog()" />
    </template>
  </UpgradeBuildingDialog>
</template>
