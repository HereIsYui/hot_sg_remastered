<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  maxMerchantAmount,
  merchantAfterGold,
  merchantAmounts,
  merchantError,
  merchantGold,
  MERCHANT_PRICES,
  type MerchantKind,
} from '../../game/market-merchant';
import type { MarketSend } from '../../game/market';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import TradeWithMerchantDialog from './TradeWithMerchantDialog.vue';

const props = defineProps<{ kind: MerchantKind; level: number; send: MarketSend }>();
const emit = defineEmits<{ close: []; submitted: [] }>();
const city = useCityStore();
const values = reactive(['0', '0', '0', '0']);
const times = ref('1');
const confirming = ref(false);
const names = computed(() =>
  [5, 6, 7, 8].map((n) =>
    i18n(`Market_MarketMerchant${props.kind === 'buy' ? 'Buy' : 'Sell'}Dialog_${n}_1`),
  ),
);
const amounts = computed(() => merchantAmounts(values));
const countTimes = computed(() => parseInt(times.value, 10) || 0);
const singleGold = computed(() => merchantGold(amounts.value, props.kind));
const totalGold = computed(() => singleGold.value * countTimes.value);
const afterGold = computed(() => merchantAfterGold(city.gold, totalGold.value, props.kind));
const stock = computed(() => [city.food, city.wood, city.rock, city.iron]);

function max(index: number): void {
  if (props.kind === 'buy') {
    values[index] = String(maxMerchantAmount(index, amounts.value, city.gold, props.level, 'buy'));
    return;
  }
  const other = merchantGold(
    merchantAmounts(amounts.value.map((n, i) => (i === index ? 0 : n))),
    'sell',
  );
  values[index] = String(
    Math.max(
      0,
      Math.min(
        stock.value[index]!,
        Math.floor((props.level * 100000 - other) / MERCHANT_PRICES[index]!),
      ),
    ),
  );
}

function submit(): void {
  const error = merchantError(amounts.value, countTimes.value, props.level);
  if (error) {
    const prefix = `Market_MarketMerchant${props.kind === 'buy' ? 'Buy' : 'Sell'}DialogSrc_`;
    void showAlert(
      error === 'limit'
        ? `${props.level}${i18n(`${prefix}2`)}${props.level * 100000}${i18n(`${prefix}3`)}`
        : i18n(`${prefix}1`),
    );
    return;
  }
  confirming.value = true;
}
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="272" :y="20" :w="137" :h="26" style-name="PopupTitle">
      <FxLabel
        :y="4"
        :w="137"
        :fx="{ textAlign: 'center', color: 15192461 }"
        :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_15_1`)"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="60" :w="642" :h="340" style-name="BoardListUp">
      <FxLabel
        :x="20"
        :y="12"
        :w="90"
        style-name="ItemTitle"
        :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_1_1`)"
      />
      <FxLabel
        :x="120"
        :y="12"
        :w="100"
        style-name="ItemTitle"
        :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_2_1`)"
      />
      <FxLabel
        :x="240"
        :y="12"
        :w="100"
        style-name="ItemTitle"
        :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_3_1`)"
      />
      <FxLabel
        :x="380"
        :y="12"
        :w="130"
        style-name="ItemTitle"
        :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_4_1`)"
      />
      <template v-for="index in 4" :key="index">
        <FxLabel :x="20" :y="50 + (index - 1) * 55" :w="90" :text="names[index - 1]" />
        <FxLabel
          :x="120"
          :y="50 + (index - 1) * 55"
          :w="100"
          :text="String(MERCHANT_PRICES[4 - index])"
        />
        <FxTextInput
          v-model="values[4 - index]"
          :x="230"
          :y="45 + (index - 1) * 55"
          :w="120"
          :h="24"
          style-name="EmptyTextInput"
          restrict="0-9"
        />
        <FxLabel
          :x="380"
          :y="50 + (index - 1) * 55"
          :w="90"
          :text="
            String(
              merchantGold(merchantAmounts(amounts.map((n, i) => (i === 4 - index ? n : 0))), kind),
            )
          "
        />
        <FxButton
          :x="470"
          :y="43 + (index - 1) * 55"
          :w="55"
          :h="25"
          style-name="ButtonGreen"
          label="最大"
          @click="max(4 - index)"
        />
        <FxButton
          :x="535"
          :y="43 + (index - 1) * 55"
          :w="55"
          :h="25"
          style-name="ButtonRed"
          label="清空"
          @click="values[4 - index] = '0'"
        />
      </template>
      <FxLabel
        :x="20"
        :y="280"
        :w="180"
        :text="`${i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_10_1`)}: ${city.gold}`"
      />
      <FxLabel
        :x="220"
        :y="280"
        :w="180"
        :text="`${i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_12_1`)}: ${afterGold}`"
      />
      <FxLabel :x="20" :y="310" :w="100" text="批量次数" />
      <FxTextInput
        v-model="times"
        :x="100"
        :y="304"
        :w="80"
        :h="24"
        style-name="EmptyTextInput"
        restrict="0-9"
      />
      <FxLabel :x="220" :y="310" :w="180" :text="`总价: ${totalGold}`" />
    </FxCanvas>
    <FxButton
      :x="440"
      :bottom="18"
      :w="90"
      style-name="ButtonGreen"
      :label="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_15_1`)"
      @click="submit"
    />
    <FxButton
      :x="580"
      :bottom="14"
      style-name="Return"
      :fx="{ fontSize: 16 }"
      @click="emit('close')"
    />
    <TradeWithMerchantDialog
      v-if="confirming"
      :kind="kind"
      :amounts="amounts"
      :times="countTimes"
      :send="send"
      @close="confirming = false"
      @submitted="emit('submitted')"
    />
  </FxCanvas>
</template>
