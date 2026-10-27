<script setup lang="ts">
import { computed } from 'vue';
import { parseMarketTrades, type MarketSend, type MarketTradeRow } from '../../game/market';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

const props = defineProps<{ extra: unknown[]; send: MarketSend }>();
const emit = defineEmits<{
  open: [view: 'merchantBuy' | 'merchantSell' | 'userBuy' | 'userSell' | 'auto'];
}>();
const trades = computed(() => parseMarketTrades(props.extra[0]));
const views = ['merchantBuy', 'merchantSell', 'userBuy', 'userSell'] as const;

function onTrade(row: MarketTradeRow): void {
  if (row.state === 0) {
    props.send('cancelSell', [row.id]);
  } else if (row.state === 2) {
    props.send('cancelAutoTrans', [row.id]);
  } else {
    void showAlert(i18n('Market_MarketPanelSrc_15'), '', ['yes', 'no']).then((button) => {
      if (button === 'yes') props.send('accelerateSell', [row.id]);
    });
  }
}
</script>

<template>
  <FxCanvas :x="10" :y="118" :w="656" :h="322" :fx="{ fontSize: 12 }">
    <FxButton
      v-for="n in 4"
      :key="n"
      :x="10 + (n - 1) * 98"
      :y="1"
      :w="90"
      style-name="ButtonYellow"
      :label="i18n(`Market_MarketPanel_${n}_1`)"
      :fx="{ fontSize: 13 }"
      @click="emit('open', views[n - 1]!)"
    />
    <FxButton
      :x="402"
      :y="1"
      :w="90"
      style-name="ButtonYellow"
      :label="i18n('Market_MarketPanel_5_1')"
      :fx="{ fontSize: 13 }"
      @click="emit('open', 'auto')"
    />
    <FxLabel
      :x="468"
      :y="17"
      :w="183"
      :fx="{ fontWeight: 'bold', textAlign: 'right' }"
      :text="`${i18n('Market_MarketPanel_7_1')}${trades.length})`"
    />
    <FxCanvas :x="10" :y="37" :w="642" :h="284" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="636"
        :h="278"
        :rows="trades"
        :row-height="25"
        :columns="[
          { header: i18n('Market_MarketPanel_8_1'), field: 'resname', width: 60 },
          { header: i18n('Market_MarketPanel_9_1'), field: 'count', width: 85 },
          { header: i18n('Market_MarketPanel_10_1'), field: 'price', width: 60 },
          { header: i18n('Market_MarketPanel_11_1'), field: 'gold', width: 75 },
          { header: i18n('Market_MarketPanel_12_1'), field: 'endtime', width: 140 },
          { header: i18n('Market_MarketPanel_14_1'), field: 'statename', width: 90 },
          { header: i18n('Market_MarketPanelSrc_10'), field: 'labelText', width: 70 },
        ]"
      >
        <template #cell="{ row, column }">
          <FxButton
            v-if="column.field === 'labelText'"
            :w="55"
            :h="24"
            style-name="ButtonGreen"
            :label="row.labelText"
            @click="onTrade(row)"
          />
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>
  </FxCanvas>
</template>
