<script setup lang="ts">
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import StorePanel from './StorePanel.vue';

/** Store.StoreDialog: the 仓库's upgrade dialog with its resource-split panel. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="362"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ extra, send }">
      <StorePanel :extra="extra" :send="send" />
    </template>
  </UpgradeBuildingDialog>
</template>
