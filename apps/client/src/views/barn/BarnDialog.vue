<script setup lang="ts">
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import BarnCommandPanel from './BarnCommandPanel.vue';

/**
 * Barn.BarnDialog: the 粮仓/马厩 (bid 16) upgrade dialog. The original overlays its
 * BarnCommandDialog (镶嵌 ported; 激活/强化/升级 are notices) on `onShow`, so the command panel
 * sits on top of the upgrade dialog once the building is built.
 */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ level }">
      <BarnCommandPanel v-if="level > 0" />
    </template>
  </UpgradeBuildingDialog>
</template>
