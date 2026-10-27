<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MarketSend } from '../../game/market';
import { parseUserBuyList, type UserBuyList } from '../../game/market-trade';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const props = defineProps<{ send: MarketSend }>();
const emit = defineEmits<{ close: [] }>();
const city = useCityStore();
const page = ref(0);
const filter = ref(0);
const unionOnly = ref(false);
const seller = ref('');
const pageInput = ref('1');
const list = ref<UserBuyList>({ used: 0, total: 0, pageCount: 0, page: 0, rows: [] });
const filters = computed(() =>
  [1, 2, 3, 4, 5].map((n) => i18n(`Market_MarketUserBuyDialog_10_1_${n}`)),
);

function load(): void {
  props.send(
    'getUserBuyList',
    [page.value, filter.value, unionOnly.value ? 1 : 0, seller.value],
    2,
  );
}

function onReply(data: unknown[]): void {
  list.value = parseUserBuyList(data, city.cid);
  page.value = list.value.page;
  pageInput.value = String(page.value + 1);
}

function goto(): void {
  page.value = Math.max(0, (parseInt(pageInput.value, 10) || 1) - 1);
  load();
}

function buy(id: number): void {
  props.send('buyFromUser', [id]);
  emit('close');
}

onMounted(load);
defineExpose({ onReply });
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="272" :y="20" :w="137" :h="26" style-name="PopupTitle">
      <FxLabel
        :y="4"
        :w="137"
        :fx="{ textAlign: 'center', color: 15192461 }"
        :text="i18n('Market_MarketUserBuyDialog_9_1')"
      />
    </FxCanvas>
    <FxLabel :x="25" :y="62" :w="100" :text="i18n('Market_MarketUserBuyDialog_11_1')" />
    <FxComboBox
      v-model:selected-index="filter"
      :items="filters"
      :x="110"
      :y="55"
      :w="130"
      :h="24"
      @change="
        page = 0;
        load();
      "
    />
    <FxButton
      :x="255"
      :y="55"
      :w="85"
      style-name="ButtonYellow"
      :label="
        i18n(unionOnly ? 'Market_MarketUserBuyDialog_19_1' : 'Market_MarketUserBuyDialog_18_1')
      "
      @click="
        unionOnly = !unionOnly;
        page = 0;
        load();
      "
    />
    <FxTextInput v-model="seller" :x="355" :y="56" :w="130" :h="24" style-name="EmptyTextInput" />
    <FxButton
      :x="500"
      :y="55"
      :w="90"
      style-name="ButtonYellow"
      :label="i18n('Market_MarketUserBuyDialog_17_1')"
      @click="
        page = 0;
        load();
      "
    />
    <FxCanvas :x="20" :y="92" :w="642" :h="300" style-name="BoardListDown">
      <FxDataGrid
        :w="642"
        :h="300"
        :rows="list.rows"
        :row-height="28"
        :columns="[
          { header: i18n('Market_MarketUserBuyDialog_1_1'), field: 'resname', width: 60 },
          { header: i18n('Market_MarketUserBuyDialog_2_1'), field: 'count', width: 75 },
          { header: i18n('Market_MarketUserBuyDialog_3_1'), field: 'price', width: 60 },
          { header: i18n('Market_MarketUserBuyDialog_4_1'), field: 'gold', width: 70 },
          { header: i18n('Market_MarketUserBuyDialog_5_1'), field: 'needtime', width: 105 },
          { header: i18n('Market_MarketUserBuyDialog_6_1'), field: 'sellername', width: 90 },
          { header: i18n('Market_MarketUserBuyDialog_7_1'), field: 'unionname', width: 90 },
          { header: i18n('Market_MarketUserBuyDialog_8_1'), field: 'id', width: 70 },
        ]"
      >
        <template #cell="{ row, column }">
          <FxButton
            v-if="column.header === i18n('Market_MarketUserBuyDialog_8_1')"
            :w="55"
            :h="24"
            style-name="ButtonGreen"
            :label="i18n('Market_MarketUserBuyDialog_8_1')"
            @click="buy(row.id)"
          />
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxLabel
      :x="25"
      :y="405"
      :w="150"
      :text="`${i18n('Market_MarketUserBuyDialog_12_1')}: ${city.gold}`"
    />
    <FxLabel
      :x="200"
      :y="405"
      :w="140"
      :text="`${i18n('Market_MarketUserBuyDialog_13_1')}: ${list.total - list.used}/${list.total}`"
    />
    <FxButton
      :x="25"
      :y="440"
      :w="75"
      style-name="ButtonYellow"
      :label="i18n('Market_MarketUserBuyDialog_14_1')"
      @click="
        page = Math.max(0, page - 1);
        load();
      "
    />
    <FxButton
      :x="110"
      :y="440"
      :w="75"
      style-name="ButtonYellow"
      :label="i18n('Market_MarketUserBuyDialog_15_1')"
      @click="
        page++;
        load();
      "
    />
    <FxTextInput
      v-model="pageInput"
      :x="205"
      :y="441"
      :w="50"
      :h="24"
      style-name="EmptyTextInput"
      restrict="0-9"
    />
    <FxButton
      :x="265"
      :y="440"
      :w="75"
      style-name="ButtonYellow"
      :label="i18n('Market_MarketUserBuyDialog_16_1')"
      @click="goto"
    />
    <FxLabel
      :x="360"
      :y="405"
      :w="100"
      :text="list.pageCount > 0 ? `${list.page + 1}/${list.pageCount}` : '0/0'"
    />
    <FxButton
      :x="580"
      :bottom="14"
      style-name="Return"
      :fx="{ fontSize: 16 }"
      @click="emit('close')"
    />
  </FxCanvas>
</template>
