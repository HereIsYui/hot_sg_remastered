<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { parseBuildingInfo, type BuildingInfo } from '../../game/buildings';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import CreateBuildingItem from './CreateBuildingItem.vue';

/** Building.CreateBuildingDialog: what can be built on an empty slot (0 fields, 1 inner, 2 wall). */
const props = defineProps<{ kind: number }>();

/** `Define.ID_CRDATE_BUILDING`: the receiver id of getAllValidBuilding. */
const RECEIVER = 100;

const game = useGame();
const items = ref<BuildingInfo[]>([]);

const unregister = game.addDialogReceiver({
  isTarget: (id, param) => id === RECEIVER && param === props.kind,
  onData(data) {
    items.value = Array.isArray(data)
      ? data.map(parseBuildingInfo).filter((b): b is BuildingInfo => b !== null)
      : [];
  },
});
onUnmounted(unregister);

watch(
  () => props.kind,
  (kind) => {
    items.value = [];
    game.sendDialogCommand('getAllValidBuilding', RECEIVER, kind, [kind]);
  },
  { immediate: true },
);

function create(bid: number) {
  game.buildingCommand('startUpgradeBuilding', bid);
  game.closeDialog();
}
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxCanvas :y="44" :h="386" :left="20" :right="20" style-name="BoardListDown" scroll-y>
      <CreateBuildingItem
        v-for="(info, i) in items"
        :key="info.bid"
        :x="10"
        :y="10 + i * 75"
        :info="info"
        @create="create"
      />
    </FxCanvas>
    <FxImage class="h-center" :y="10" source="images/title.png" />
    <FxLabel
      class="h-center"
      :y="15"
      :fx="{ color: 0xffffff }"
      :text="i18n('Building_CreateBuildingDialog_1_1')"
    />
    <FxButton
      :x="603"
      :y="445"
      style-name="Close"
      :fx="{ paddingLeft: 2, paddingRight: 2 }"
      @click="game.closeDialog()"
    />
  </FxCanvas>
</template>

<style scoped>
.h-center {
  left: 50% !important;
  transform: translateX(-50%);
}
</style>
