<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import BigPackDialog from './BigPackDialog.vue';
import StorePanel from './StorePanel.vue';

/** Store.StoreDialog: the 仓库's upgrade dialog with its resource-split panel and 打包 sub-dialog. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

/** `BigPackDialog.visible`: opened by the 打包 button, closed on submit / cancel. */
const packing = ref(false);

/** `StoreDialog.onBuildingInfo(_, 2)`: a payToPack reply reports success. */
function onReply(_data: unknown[], ttype: number) {
  if (ttype === 2) void showAlert(i18n('Store_StoreDialogSrc_1'));
}
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="362"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
    @reply-ttype="onReply"
  >
    <template #default="{ extra, send }">
      <StorePanel :extra="extra" :send="send" @pack="packing = true" />
      <BigPackDialog v-if="packing" :extra="extra" :send="send" @close="packing = false" />
    </template>
  </UpgradeBuildingDialog>
</template>
