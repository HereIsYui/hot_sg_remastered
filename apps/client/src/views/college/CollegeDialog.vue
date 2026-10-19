<script setup lang="ts">
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import CollegeTechnicPanel from './CollegeTechnicPanel.vue';

/** College.CollegeDialog: the 书院's upgrade dialog with its technic panel. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ extra, now, send, reload }">
      <CollegeTechnicPanel
        :x="18"
        :y="125"
        :raw="extra[0]"
        :now="now"
        @start="send('startUpgradeTechnic', [$event])"
        @stop="send('stopUpgradeTechnic', [$event])"
        @reload="reload()"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
