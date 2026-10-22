<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import BlackSmithCommandPanel from './BlackSmithCommandPanel.vue';

/**
 * BlackSmith.CityInnerPanel_blacksmith: the 铁匠铺's upgrade dialog with a button that opens the
 * BSCommandDialog (强化 / 镶嵌 / 合成 / 技能书合并).
 */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

const open = ref(false);
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ level }">
      <FxButton
        v-if="level > 0"
        :x="20"
        :y="120"
        style-name="ButtonGreen"
        :label="i18n('BlackSmith_enter')"
        @click="open = true"
      />
    </template>
  </UpgradeBuildingDialog>
  <BlackSmithCommandPanel v-if="open" @close="open = false" />
</template>
