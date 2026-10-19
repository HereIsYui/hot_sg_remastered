<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import { calcProduct, parseCityProduct, type CityProduct, type Four } from '../../game/production';
import { i18n } from '../../i18n';
import type { StyleDecl } from '../../assets/registry';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';
import type { TipValue } from '../../ui/tooltip';

/** Government.ResourceProductDialog: the work rates of the four productions and their output. */
const game = useGame();
const city = useCityStore();
const t = (n: number) => i18n(`Government_ResourceProductDialog_${n}_1`);

const product = shallowRef<CityProduct | null>(null);
const rates = ref<Four>([0, 0, 0, 0]);
const table = computed(() =>
  product.value
    ? calcProduct(product.value, rates.value, city.people_all, city.people_building)
    : null,
);

const unregister = game.addGlobalReceiver('city', (command, data) => {
  if (command !== 'getCityProduct') return;
  const p = parseCityProduct(data);
  if (!p) return;
  product.value = p;
  rates.value = [...p.rates];
});
onMounted(() => game.sendGlobalCommand('city', 'getCityProduct', [city.cid]));
onUnmounted(unregister);

const TITLE = { color: 2807669 };
const BONUS = { color: 15420010 };
const TOTAL = { fontWeight: 'bold', color: 3062743 };
const GREEN = { fontWeight: 'bold', color: 2096897 };

interface Cell {
  text: string | number;
  fx?: StyleDecl;
  tip?: TipValue;
}
interface TileRow {
  title: string;
  titleFx?: StyleDecl;
  cells: Cell[] | 'rates';
}

/** `onShowFoodEndTime` etc.: how long the production item lasts, read when the tip shows. */
function goodsTip(i: number): TipValue {
  return {
    resource: () =>
      i18n(`Government_ResourceProductDialogSrc_${i + 1}`) +
      timeLeftText((product.value?.goodsEndTime[i] ?? 0) - serverTime(), i18n),
  };
}

const people = (n: number, unit: number) => `${n}${t(unit)}`;
const tile = computed<TileRow[]>(() => {
  const p = product.value;
  const c = table.value;
  const each = (f: (i: number) => Cell): Cell[] => [0, 1, 2, 3].map(f);
  const plain = (list: readonly number[] | undefined) => each((i) => ({ text: list?.[i] ?? 0 }));
  return [
    { title: t(7), titleFx: TITLE, cells: plain(p?.all) },
    {
      title: t(8),
      titleFx: TITLE,
      cells: each((i) => ({ text: people(p?.allPeople[i] ?? 0, 9 + i) })),
    },
    {
      title: t(13),
      titleFx: TITLE,
      cells: each((i) => ({ text: people(c?.working[i] ?? 0, 14 + i) })),
    },
    { title: t(18), titleFx: TITLE, cells: 'rates' },
    { title: t(19), titleFx: TOTAL, cells: each((i) => ({ text: c?.base[i] ?? 0, fx: GREEN })) },
    { title: t(20), titleFx: BONUS, cells: each(() => ({ text: '100' })) },
    { title: t(21), titleFx: BONUS, cells: plain(c?.techAdd) },
    {
      title: t(22),
      titleFx: BONUS,
      cells: each((i) =>
        i === 0 ? { text: `-${p?.armyFoodUse ?? 0}`, fx: { color: 16711680 } } : { text: '0' },
      ),
    },
    { title: t(23), titleFx: BONUS, cells: plain(c?.heroAdd) },
    { title: t(24), titleFx: BONUS, cells: plain(c?.fieldAdd) },
    {
      title: t(25),
      titleFx: BONUS,
      cells: each((i) => ({ text: c?.goodsAdd[i] ?? 0, tip: goodsTip(i) })),
    },
    {
      title: t(26),
      titleFx: TOTAL,
      cells: each((i) => {
        const v = c?.final[i] ?? 0;
        return { text: v, fx: { fontWeight: 'bold', color: i > 0 || v >= 0 ? 2096897 : 16711680 } };
      }),
    },
  ];
});

const columns = [
  { header: '', field: 'title' as const, width: 130 },
  { header: t(3), field: 'title' as const, width: 130 },
  { header: t(4), field: 'title' as const, width: 130 },
  { header: t(5), field: 'title' as const, width: 130 },
  { header: t(6), field: 'title' as const, width: 132 },
];
const blankRows = Array.from({ length: 12 }, () => ({ title: '' }));

const sum = (list: readonly number[] | undefined) => (list ?? []).reduce((a, b) => a + b, 0);
const footer = computed(() => [
  { title: t(28), value: city.people_all - city.people_building },
  { title: t(29), value: sum(product.value?.allPeople) },
  { title: t(30), value: sum(table.value?.working) },
  { title: t(31), value: `${Math.round((table.value?.workingRate ?? 1) * 10000) / 100}%` },
]);

function setRate(i: number, v: number) {
  const next = [...rates.value] as Four;
  next[i] = v;
  rates.value = next;
}

function onSubmit() {
  game.sendGlobalCommand('city', 'setCityProductRate', [city.cid, ...rates.value]);
}
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="10" source="images/title.png" />
    <FxLabel :x="314.5" :y="14" :fx="{ color: 16777215 }" :text="t(2)" />
    <FxCanvas :x="12" :y="50" :w="658" :h="402" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="652"
        :h="396"
        :columns="columns"
        :rows="blankRows"
        :row-height="30"
        :header-height="26"
      />
      <template v-for="(row, r) in tile" :key="r">
        <div class="tile-cell" :style="{ left: '-1px', top: `${29 + r * 30}px` }">
          <FxLabel
            :x="0"
            :y="6"
            :w="130"
            :fx="{ textAlign: 'center', ...row.titleFx }"
            :text="row.title"
          />
        </div>
        <div
          v-for="i in 4"
          :key="i"
          class="tile-cell"
          :style="{ left: `${-1 + i * 130}px`, top: `${29 + r * 30}px` }"
        >
          <FxNumericStepper
            v-if="row.cells === 'rates'"
            :x="29"
            :y="2"
            :minimum="0"
            :maximum="100"
            :model-value="rates[i - 1]"
            @update:model-value="setRate(i - 1, $event)"
          />
          <FxLabel
            v-else
            :x="0"
            :y="6"
            :w="130"
            :fx="{ textAlign: 'center', ...row.cells[i - 1]!.fx }"
            :text="row.cells[i - 1]!.text"
            :tip="row.cells[i - 1]!.tip"
          />
        </div>
      </template>
    </FxCanvas>
    <template v-for="(f, i) in footer" :key="i">
      <FxCanvas :x="12 + i * 136" :y="455" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel :x="7" :y="4" style-name="ItemTitle" :text="f.title" />
      </FxCanvas>
      <FxCanvas :x="80 + i * 136" :y="455" :w="60" :h="26" style-name="BoardListDown">
        <FxLabel :x="3" :y="4" :w="57" style-name="ItemValue" :text="f.value" />
      </FxCanvas>
    </template>
    <FxButton
      :x="564"
      :bottom="9"
      :w="50"
      :h="30"
      style-name="ButtonGreen"
      :fx="{ paddingLeft: 2, paddingRight: 2 }"
      :label="t(27)"
      @click="onSubmit"
    />
    <FxButton
      :right="15"
      :bottom="9"
      :w="50"
      :h="30"
      :fx="{ paddingLeft: 2, paddingRight: 2 }"
      :label="t(1)"
      @click="game.closeDialog()"
    />
  </FxCanvas>
</template>

<style scoped>
.tile-cell {
  position: absolute;
  width: 130px;
  height: 30px;
}
</style>
