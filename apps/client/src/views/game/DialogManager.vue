<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { BUILDING_COLLEGE } from '../../game/cityGrid';
import type { BuildingState } from '../../stores/city';
import { useSessionStore } from '../../stores/session';
import CreateBuildingDialog from '../building/CreateBuildingDialog.vue';
import DestroyPanel from '../building/DestroyPanel.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import CollegeDialog from '../college/CollegeDialog.vue';

/** DialogManager: the dialogs over the scene panels (only one shown at a time). */
defineProps<{ x: number; y: number }>();

const session = useSessionStore();

const dialog = computed(() => session.dialog);
const buildingKey = computed(() => {
  const d = dialog.value;
  return d?.name === 'building' ? `${d.building.inner},${d.building.x},${d.building.y}` : '';
});

/** `showBuildingDialog`: built buildings with a dialog of their own use it (`getBuildingDialog`). */
function ownDialog(building: BuildingState, bid: number): boolean {
  return building.level > 0 && building.bid === bid;
}

/** `showDestroyPanel`: on top of the building dialog until a choice or another dialog. */
const destroy = shallowRef<{ all: () => void; level: () => void } | null>(null);
watch(dialog, () => (destroy.value = null));

function choose(action: 'all' | 'level') {
  const handlers = destroy.value;
  destroy.value = null;
  handlers?.[action]();
}
</script>

<template>
  <div class="dialog-manager" :style="{ left: `${x}px`, top: `${y}px` }">
    <CreateBuildingDialog
      v-if="dialog?.name === 'createBuilding'"
      :key="dialog.kind"
      :kind="dialog.kind"
    />
    <CollegeDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_COLLEGE)"
      :key="`college ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <UpgradeBuildingDialog
      v-else-if="dialog?.name === 'building'"
      :key="buildingKey"
      :x="0"
      :y="130"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <DestroyPanel
      v-if="destroy"
      @all="choose('all')"
      @level="choose('level')"
      @close="destroy = null"
    />
  </div>
</template>

<style scoped>
.dialog-manager {
  position: absolute;
  width: 736px;
  height: 556px;
  pointer-events: none !important;
}

.dialog-manager > :deep(*) {
  pointer-events: auto;
}
</style>
