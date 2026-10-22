<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, ref } from 'vue';
import {
  packNeed,
  packResources,
  packRows,
  validatePack,
  type PackSelection,
} from '../../game/pack';
import { parseStoreInfo } from '../../game/store';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';

/**
 * Store.BigPackDialog: the 仓库 打包 sub-dialog. Each resource row chooses a pack size and a pack
 * count; 确定 (submit) validates the order and sends `payToPack` through the store dialog, which
 * grants the packed goods and spends the resource and 铜钱. 取消 just closes.
 */
const props = defineProps<{
  /** The 仓库's getBuildingInfo `extra`; `extra[0]` is the storeInfo whose last field is 铜钱. */
  extra: unknown[];
  /** `sendDialogCommand` addressed to the 仓库 dialog (ttype 2 routes payToPack). */
  send: (cmd: string, args: CommandArg[], ttype?: number) => void;
}>();
const emit = defineEmits<{ close: [] }>();

const city = useCityStore();
const rows = packRows();

const copper = computed(() => parseStoreInfo(props.extra[0]).copper);

/** `BigPackDialog.setResource`: gold then the four reals, floored. */
const resCounts = computed<number[]>(() =>
  packResources(city.gold, [city.food_real, city.wood_real, city.rock_real, city.iron_real]),
);

/** Per-row selection (`changePackType` / the 数量 stepper). */
const selections = ref<PackSelection[]>(rows.map(() => ({ packCount: 0, sizeIndex: 0 })));

interface GridRow {
  restype: string;
  rescount: number;
  resneed: number;
  copperneed: number;
}
const gridRows = computed<GridRow[]>(() =>
  rows.map((row, i) => {
    const sel = selections.value[i]!;
    const { resNeed, copperNeed } = packNeed(row, sel.sizeIndex, sel.packCount);
    return {
      restype: row.restype,
      rescount: resCounts.value[i] ?? 0,
      resneed: resNeed,
      copperneed: copperNeed,
    };
  }),
);

const columns = [
  { header: i18n('Store_StorePanel_1_1'), field: 'restype' as const, width: 60 },
  { header: i18n('Store_StorePanel_2_1'), field: 'rescount' as const, width: 120 },
  { header: i18n('Store_PackDialog_3_1'), field: 'restype' as const, width: 120 },
  { header: i18n('Store_PackDialog_4_1'), field: 'restype' as const, width: 90 },
  { header: i18n('Store_PackDialog_5_1'), field: 'resneed' as const, width: 110 },
  { header: i18n('Store_PackDialog_6_1'), field: 'copperneed' as const, width: 90 },
];

function setSize(i: number, sizeIndex: number) {
  const next = [...selections.value];
  next[i] = { ...next[i]!, sizeIndex };
  selections.value = next;
}
function setCount(i: number, packCount: number) {
  const next = [...selections.value];
  next[i] = { ...next[i]!, packCount };
  selections.value = next;
}

/** `clearData`: reset every row's order. */
function clearData() {
  selections.value = rows.map(() => ({ packCount: 0, sizeIndex: 0 }));
}

function onCancel() {
  clearData();
  emit('close');
}

/** `BigPackDialog.submit`: validate, then send payToPack with ttype 2 and close. */
function onSubmit() {
  const result = validatePack(rows, selections.value, resCounts.value, copper.value);
  if (!result.ok) {
    void showAlert(result.message);
    return;
  }
  props.send('payToPack', result.entries as unknown as CommandArg[], 2);
  clearData();
  emit('close');
}
</script>

<template>
  <FxCanvas :x="20" :y="50" :w="646" :h="384" style-name="PopupDialog">
    <FxCanvas :x="(646 - 114) / 2" :y="20" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="114"
        style-name="PopupDialogTitle"
        :text="i18n('Store_PackDialog_1_1')"
      />
    </FxCanvas>

    <FxCanvas :x="28" :y="61" :w="590" :h="260" style-name="BoardListUp">
      <FxDataGrid
        :x="0"
        :y="0"
        :w="590"
        :h="250"
        :row-height="36"
        :columns="columns"
        :rows="gridRows"
      />
      <!-- 类型 combo + 数量 stepper per row, overlaid on columns 3 and 4 -->
      <template v-for="(row, i) in rows" :key="row.resname">
        <FxComboBox
          :x="187"
          :y="28 + i * 36"
          :w="100"
          :items="row.sizes.map((s) => s.label)"
          :selected-index="selections[i]!.sizeIndex"
          @change="setSize(i, $event)"
        />
        <FxNumericStepper
          :x="310"
          :y="28 + i * 36"
          :minimum="0"
          :maximum="9999"
          :model-value="selections[i]!.packCount"
          @update:model-value="setCount(i, $event)"
        />
      </template>
    </FxCanvas>

    <!-- 铜钱 footer -->
    <FxCanvas :x="28" :y="338" :w="42" :h="26" style-name="BoardListUp">
      <FxLabel :x="4" :y="4" :w="38" style-name="ItemTitle" :text="i18n('BlackMarketDialog_3_1')" />
    </FxCanvas>
    <FxCanvas :x="78" :y="338" :w="84" :h="26" style-name="BoardListDown">
      <FxLabel :x="4" :y="4" :w="72" style-name="ItemValue" :text="copper" />
    </FxCanvas>

    <FxButton
      :x="481"
      :bottom="20"
      style-name="ButtonGreen"
      :label="i18n('CityMergeDialog_tile_9')"
      @click="onSubmit"
    />
    <FxButton
      :x="554"
      :bottom="20"
      :label="i18n('College_UpgradeTechItem_2_1')"
      @click="onCancel"
    />
  </FxCanvas>
</template>
