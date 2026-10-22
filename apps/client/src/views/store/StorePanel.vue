<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, ref, watch } from 'vue';
import {
  isValidRates,
  parseStoreInfo,
  storeRows,
  totalStore,
  type StoreInfo,
} from '../../game/store';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';

/**
 * Store.StorePanel: the resource-split grid inside the 仓库 dialog. Four rate steppers choose how
 * much of the 粮仓 capacity each resource reserves; 修改存放比例 saves it (modifyStoreRate). Each
 * stepper is clamped so the four never exceed 100, as the original does per field.
 */
const props = defineProps<{
  /** The `[storeInfo]` the 仓库's getBuildingInfo reply appends. */
  extra: unknown[];
  /** `sendDialogCommand` addressed to the 仓库 dialog. */
  send: (cmd: string, args: CommandArg[]) => void;
}>();
const emit = defineEmits<{ pack: [] }>();

const city = useCityStore();

const info = computed<StoreInfo>(() => parseStoreInfo(props.extra[0]));
const rates = ref<[number, number, number, number]>([0, 0, 0, 0]);

/** A fresh reply loads its saved ratios. */
watch(
  info,
  (v) => {
    rates.value = [...v.rates];
  },
  { immediate: true },
);

/** Market_MarketPanelSrc_1..4: 粮/木/石/铁. */
const RESOURCE_NAMES = [1, 2, 3, 4].map((n) => i18n(`Market_MarketPanelSrc_${n}`));

/** City.*_real: the city's current resource amounts, food/wood/rock/iron. */
const amounts = computed<[number, number, number, number]>(() => [
  Math.round(city.food_real),
  Math.round(city.wood_real),
  Math.round(city.rock_real),
  Math.round(city.iron_real),
]);

const table = computed(() => storeRows(info.value, rates.value, amounts.value));

interface GridRow {
  restype: string;
  rescount: number;
  resmax: number;
  capacity: number;
  instore: number;
  outstore: number;
}
const gridRows = computed<GridRow[]>(() =>
  table.value.rows.map((r) => ({
    restype: RESOURCE_NAMES[r.index] ?? '',
    rescount: r.rescount,
    resmax: r.resmax,
    capacity: r.capacity,
    instore: r.instore,
    outstore: r.outstore,
  })),
);

const columns = [
  { header: i18n('Store_StorePanel_1_1'), field: 'restype' as const, width: 60 },
  { header: i18n('Store_StorePanel_2_1'), field: 'rescount' as const, width: 90 },
  { header: i18n('Store_StorePanel_3_1'), field: 'resmax' as const, width: 110 },
  { header: i18n('Store_StorePanel_4_1'), field: 'capacity' as const, width: 100 },
  { header: i18n('Store_StorePanel_5_1'), field: 'instore' as const, width: 100 },
  { header: i18n('Store_StorePanel_6_1'), field: 'outstore' as const, width: 90 },
];

const summary = computed(
  () =>
    `${i18n('Store_StorePanel_8_1')}${info.value.buildingCount}${i18n('Store_StorePanel_8_2')}` +
    `${totalStore(info.value)}，${i18n('Store_StorePanel_8_3')}${table.value.emptyStore}。`,
);

/** `onChangeFoodRate` etc.: clamp a field to what the other three leave of 100. */
function setRate(i: number, v: number) {
  const next = [...rates.value] as [number, number, number, number];
  const others = next.reduce((sum, r, idx) => (idx === i ? sum : sum + r), 0);
  next[i] = Math.min(v, 100 - others);
  rates.value = next;
}

/** `StorePanel.modifyRate`: validate then send modifyStoreRate. */
function onModify() {
  if (!isValidRates(rates.value)) {
    void showAlert(
      i18n(rates.value.some((r) => r < 0) ? 'Store_StorePanelSrc_1' : 'Store_StorePanelSrc_2'),
    );
    return;
  }
  props.send('modifyStoreRate', [...rates.value]);
}
</script>

<template>
  <FxCanvas :x="18" :y="125" :w="646" :h="241" style-name="BoardListUp">
    <FxDataGrid
      :x="3"
      :y="3"
      :w="640"
      :h="172"
      :columns="columns"
      :rows="gridRows"
      :row-height="36"
    />
    <FxNumericStepper
      :x="373"
      :y="32"
      :minimum="0"
      :maximum="100"
      :model-value="rates[0]"
      @update:model-value="setRate(0, $event)"
    />
    <FxNumericStepper
      :x="373"
      :y="70"
      :minimum="0"
      :maximum="100"
      :model-value="rates[1]"
      @update:model-value="setRate(1, $event)"
    />
    <FxNumericStepper
      :x="373"
      :y="105"
      :minimum="0"
      :maximum="100"
      :model-value="rates[2]"
      @update:model-value="setRate(2, $event)"
    />
    <FxNumericStepper
      :x="373"
      :y="141"
      :minimum="0"
      :maximum="100"
      :model-value="rates[3]"
      @update:model-value="setRate(3, $event)"
    />
    <FxLabel
      :x="10"
      :y="196"
      :w="626"
      :fx="{ color: 0xe7d18d, textAlign: 'left', fontWeight: 'bold' }"
      :text="summary"
    />
    <FxButton
      :x="334"
      :bottom="10"
      style-name="ButtonGreen"
      :label="i18n('Store_StorePanel_9_1')"
      @click="emit('pack')"
    />
    <FxButton
      :x="434"
      :bottom="10"
      style-name="ButtonGreen"
      :label="i18n('Store_StorePanel_10_1')"
      @click="onModify"
    />
  </FxCanvas>
</template>
