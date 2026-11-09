<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { serverTime } from '../../core/clock';
import { buildingQueueRows, cancelQueueText, type BuildingQueueRow } from '../../game/buildings';
import { useGame } from '../../game/game';
import { UseGoodsType } from '../../game/goods';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useSessionStore } from '../../stores/session';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Bar.TopPanel.buildingListPanel (TopPanel.as:442): the 250x140 translucent panel under the top
 * bar listing the upgrading / demolishing buildings, one Bar.BuildingItem per 17px row. The build
 * button toggles it through `session.showBuildingList`.
 */
const game = useGame();
const city = useCityStore();
const session = useSessionStore();

/** `TopPanel.onSecTimer` (TopPanel.as:780): the remaining times are recounted every second. */
const now = ref(serverTime());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = serverTime()), 1000);
});
onBeforeUnmount(() => clearInterval(timer));

const rows = computed(() => buildingQueueRows(city.buildings, now.value));

/** `BuildingItem.startAccerateBuilding` (BuildingItem.as:708): the 鲁班 item dialog for the slot. */
function accelerate(row: BuildingQueueRow): void {
  const s = row.state;
  game.showUseGoodsDialog(s.state_endtime - serverTime(), UseGoodsType.Building, [
    city.cid,
    s.inner ? 1 : 0,
    s.x,
    s.y,
    s.bid,
  ]);
}

/**
 * `BuildingItem.cancelUpgradingBuilding` (BuildingItem.as:729): confirm, then
 * `stopUpgradeBuilding` / `stopDestroyBuilding` on the row's slot.
 */
async function cancel(row: BuildingQueueRow): Promise<void> {
  const s = row.state;
  if ((await showAlert(cancelQueueText(s), '', ['yes', 'no'])) !== 'yes') return;
  // BuildingItem.onCancelUpgradeAlert / onCancelDestroyAlert: [cid, inner, x, y, bid]
  game.sendGlobalCommand('city', s.state === 1 ? 'stopUpgradeBuilding' : 'stopDestroyBuilding', [
    city.cid,
    s.inner ? 1 : 0,
    s.x,
    s.y,
    s.bid,
  ]);
}
</script>

<template>
  <FxCanvas
    v-if="session.showBuildingList"
    :x="2"
    :y="34"
    :w="250"
    :h="140"
    style-name="ChatPanel"
    :fx="{ backgroundAlpha: 0.5, fontSize: 12 }"
  >
    <FxCanvas v-for="(row, i) in rows" :key="row.state.bid" :x="0" :y="i * 17" :w="250" :h="17">
      <FxButton
        :x="3"
        :y="3"
        :w="11"
        :h="11"
        style-name="AccBuilding"
        :tip="i18n('Bar_BuildingItem_1_1')"
        @click="accelerate(row)"
      />
      <FxButton
        :x="17"
        :y="3"
        :w="11"
        :h="11"
        style-name="CancelBuilding"
        :tip="i18n('Bar_BuildingItem_2_1')"
        @click="cancel(row)"
      />
      <FxLabel :x="30" :y="0" :w="80" :text="row.name" />
      <FxLabel :x="90" :y="0" :w="50" :fx="{ color: row.levelColor }" :text="row.levelText" />
      <FxLabel :x="140" :y="0" :w="110" :text="row.leftText" />
    </FxCanvas>
  </FxCanvas>
</template>
