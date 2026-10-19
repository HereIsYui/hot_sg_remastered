<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useSessionStore } from '../../stores/session';
import CreateBuildingDialog from '../building/CreateBuildingDialog.vue';
import DestroyPanel from '../building/DestroyPanel.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';

/** DialogManager: the dialogs over the scene panels (only one shown at a time). */
defineProps<{ x: number; y: number }>();

const session = useSessionStore();

const dialog = computed(() => session.dialog);
const buildingKey = computed(() => {
  const d = dialog.value;
  return d?.name === 'building' ? `${d.building.inner},${d.building.x},${d.building.y}` : '';
});

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
