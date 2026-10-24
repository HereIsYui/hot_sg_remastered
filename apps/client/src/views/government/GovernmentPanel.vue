<script setup lang="ts">
import { computed } from 'vue';
import { useGame } from '../../game/game';
import { upgradingRows, type GovernmentAction, type UpgradingRow } from '../../game/government';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import type { PlainDialog } from '../../stores/session';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';

/** Government.GovernmentPanel: the 官府's commands over the list of buildings under way. */
const props = defineProps<{ x: number; y: number; now: number }>();
const emit = defineEmits<{ open: [GovernmentAction] }>();

const game = useGame();
const city = useCityStore();
const t = (n: number) => i18n(`Government_GovernmentPanel_${n}_1`);

/**
 * `action` opens a pop-up of the 官府, `dialog` another dialog; `cityField` is the 附属野地 list
 * (`DialogManager.showCityFieldDialog`).
 */
const buttons: {
  label: number;
  action?: GovernmentAction;
  dialog?: PlainDialog;
  cityField?: boolean;
}[] = [
  { label: 1, dialog: 'buildingList' },
  { label: 5, dialog: 'resourceProduct' },
  { label: 2, action: 'tax' },
  { label: 3, action: 'pacify' },
  { label: 4, action: 'levy' },
  { label: 6, action: 'rename' },
  { label: 16, cityField: true },
  { label: 17, dialog: 'cityList' },
  { label: 9, action: 'heroExpr' },
];

/** Nine buttons share the 650px row; label 9 (将领历练) comes from the Office's HeroExprDialog. */
const buttonLayout = computed(() => buttons.map((b, i) => ({ ...b, x: 1 + i * 72, w: 70 })));

function onButton(b: (typeof buttons)[number]) {
  if (b.action) emit('open', b.action);
  else if (b.cityField) game.showCityFieldDialog();
  else if (b.dialog) game.showDialog(b.dialog);
}

const rows = computed(() => upgradingRows(city.buildings, props.now, i18n));
const columns: { header: string; field: keyof UpgradingRow & string; width: number }[] = [
  { header: t(7), field: 'bname', width: 80 },
  { header: t(8), field: 'task', width: 50 },
  { header: t(9), field: 'level', width: 80 },
  { header: t(10), field: 'nextlevel', width: 80 },
  { header: t(11), field: 'timeleft', width: 180 },
  { header: t(12), field: 'endtime', width: 174 },
];

/** `onBuildingItemClick`: the row's building by bid and position (the original ignores inner). */
function onItemClick(row: UpgradingRow) {
  const { bid, x, y } = row.building;
  const building = city.buildings.findLast((b) => b.bid === bid && b.x === x && b.y === y);
  if (building) game.showBuildingDialog(building);
}
</script>

<template>
  <FxCanvas
    :x="x"
    :y="y"
    :w="650"
    :h="322"
    style-name="BoardListUp"
    :fx="{ fontSize: 12, borderStyle: 'none' }"
  >
    <FxButton
      v-for="b in buttonLayout"
      :key="b.label"
      :x="b.x"
      :y="8"
      :w="b.w"
      :h="37"
      style-name="ButtonYellow"
      :label="b.action === 'heroExpr' ? i18n('Office_HeroExprDialog_1_1') : t(b.label)"
      @click="onButton(b)"
    />
    <FxDataGrid
      :x="3"
      :y="53"
      :w="644"
      :h="267"
      :columns="columns"
      :rows="rows"
      @item-click="onItemClick"
    />
  </FxCanvas>
</template>
