<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { endTimeText, serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Building.BuildingListDialog: every building of the city, those under way with their times.
 * 加速 and 增加建造队列 need the item dialog (UseGoodsDialog), which is not ported.
 */
const game = useGame();
const city = useCityStore();
const t = (n: number) => i18n(`Building_BuildingListDialog_${n}_1`);
const src = (n: number) => i18n(`Building_BuildingListDialogSrc_${n}`);

const now = ref(serverTime());
/** When the 徭役令's extra building queues end. */
const queueEnd = ref(0);

interface Row {
  building: BuildingState;
  bname: string;
  statename: string;
  level: number;
  targetlevel: number;
  lefttime: string;
  endtime: string;
}

/** `update` / `onTimer`. */
function toRow(b: BuildingState): Row {
  return {
    building: b,
    bname: b.bname,
    statename: src(b.level === 0 && b.state === 1 ? 4 : b.state + 1),
    level: b.level,
    targetlevel: b.state === 1 ? b.level + 1 : b.level - 1,
    lefttime: timeLeftText(b.state_endtime - now.value, i18n),
    endtime: endTimeText(b.state_endtime),
  };
}

const rows = computed(() => city.buildings.map(toRow));
const upgrading = computed(() => rows.value.filter((r) => r.building.state > 0));
const outer = computed(() => rows.value.filter((r) => !r.building.inner));
const inner = computed(() => rows.value.filter((r) => r.building.inner));

type Column = { header: string; field: keyof Row & string; width: number };
const upgradingColumns: Column[] = [
  { header: t(3), field: 'bname', width: 70 },
  { header: t(4), field: 'statename', width: 60 },
  { header: t(5), field: 'level', width: 70 },
  { header: t(6), field: 'targetlevel', width: 70 },
  { header: t(7), field: 'lefttime', width: 120 },
  { header: t(8), field: 'endtime', width: 120 },
  { header: '', field: 'building', width: 126 },
];
const outerColumns: Column[] = [
  { header: t(11), field: 'bname', width: 104 },
  { header: t(12), field: 'statename', width: 104 },
  { header: t(13), field: 'level', width: 104 },
];
const innerColumns: Column[] = [
  { header: t(14), field: 'bname', width: 103 },
  { header: t(15), field: 'statename', width: 103 },
  { header: t(16), field: 'level', width: 104 },
];

/** `updateRemainTimeText`. */
const remainText = computed(() =>
  queueEnd.value > now.value ? src(5) + timeLeftText(queueEnd.value - now.value, i18n) : src(6),
);

/** `onInnerItemClick` / `onOuterItemClick`: the building's scene and dialog. */
function openBuilding(row: Row) {
  const b = row.building;
  game.gotoView(b.inner ? 'cityInner' : 'city');
  game.showBuildingDialog(b);
}

/** `onClickCancel`: stops the upgrade or demolition after a confirmation. */
async function onCancel(row: Row) {
  const b = row.building;
  let text: string;
  let command: string;
  if (b.state === 1) {
    text = `${src(7)}${b.bname}${src(8)}${row.targetlevel})?`;
    command = 'stopUpgradeBuilding';
  } else if (b.state === 2) {
    text = `${src(9)}${b.bname}${src(10)}${b.level})?`;
    command = 'stopDestroyBuilding';
  } else {
    return;
  }
  if ((await showAlert(text, '', ['yes', 'no'])) !== 'yes') return;
  game.sendGlobalCommand('city', command, [city.cid, b.inner ? 1 : 0, b.x, b.y, b.bid]);
}

const unregister = game.addGlobalReceiver('buffer', (command, data) => {
  if (command === 'getYaoYiLinTime' && Array.isArray(data)) {
    queueEnd.value = parseInt(String(data[0]), 10) || 0;
  }
});
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  game.sendGlobalCommand('buffer', 'getYaoYiLinTime');
  timer = setInterval(() => (now.value = serverTime()), 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  unregister();
});
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="12" source="images/title.png" />
    <FxLabel :x="313.5" :y="17" :fx="{ color: 15192461 }" :text="t(1)" />
    <FxButton
      :x="597"
      :y="446"
      style-name="Close"
      :fx="{ paddingLeft: 2, paddingRight: 2 }"
      @click="game.closeDialog()"
    />
    <FxButton :x="438" :y="446" :w="110" style-name="ButtonGreen" :label="t(2)" :enabled="false" />
    <FxLabel
      :x="20"
      :y="454"
      :w="410"
      :fx="{ textAlign: 'right', color: 15192461 }"
      :text="remainText"
    />
    <FxCanvas :x="20" :y="48" :w="642" :h="116" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="636"
        :h="110"
        :row-height="28"
        :columns="upgradingColumns"
        :rows="upgrading"
      >
        <template #cell="{ row, column }">
          <div v-if="column.field === 'building'" class="actions">
            <FxButton :x="5" :y="0" :w="50" :h="28" :label="t(9)" :enabled="false" />
            <FxButton :x="55" :y="0" :w="50" :h="28" :label="t(10)" @click="onCancel(row)" />
          </div>
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxCanvas :x="20" :y="172" :w="318" :h="267" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="312"
        :h="261"
        :columns="outerColumns"
        :rows="outer"
        @item-click="openBuilding"
      />
    </FxCanvas>
    <FxCanvas :x="346" :y="172" :w="316" :h="267" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="310"
        :h="261"
        :columns="innerColumns"
        :rows="inner"
        @item-click="openBuilding"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.actions {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
