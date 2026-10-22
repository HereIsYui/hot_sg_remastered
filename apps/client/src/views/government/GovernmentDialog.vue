<script setup lang="ts">
import { ref } from 'vue';
import type { GovernmentAction } from '../../game/government';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import ChangeNameDialog from './ChangeNameDialog.vue';
import ChangeTaxDialog from './ChangeTaxDialog.vue';
import GovernmentPanel from './GovernmentPanel.vue';
import HeroExprDialog from './HeroExprDialog.vue';
import LevyResourceDialog from './LevyResourceDialog.vue';
import PacifyPeopleDialog from './PacifyPeopleDialog.vue';

/** Government.GovernmentDialog: the 官府's upgrade dialog with its city management pop-ups. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

const city = useCityStore();
const popup = ref<GovernmentAction | null>(null);

/** `showChangeNameDialog`: famous cities other than the capital keep their names. */
function open(action: GovernmentAction) {
  if (action === 'rename' && city.type > 0 && city.type !== 5) {
    void showAlert(i18n('Government_GovernmentDialogSrc_1'));
    return;
  }
  popup.value = action;
}
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ now }">
      <GovernmentPanel :x="18" :y="125" :now="now" @open="open" />
      <ChangeNameDialog v-if="popup === 'rename'" @close="popup = null" />
      <ChangeTaxDialog v-else-if="popup === 'tax'" @close="popup = null" />
      <LevyResourceDialog v-else-if="popup === 'levy'" @close="popup = null" />
      <PacifyPeopleDialog v-else-if="popup === 'pacify'" @close="popup = null" />
      <HeroExprDialog
        v-else-if="popup === 'heroExpr'"
        :param="building.y * 10 + building.x"
        @close="popup = null"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
