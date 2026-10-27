<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { MarketSend } from '../../game/market';
import {
  parseUserSellData,
  playerPrice,
  playerPriceRange,
  playerSellArgs,
  playerSellError,
} from '../../game/market-trade';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import FxToggle from '../../ui/FxToggle.vue';

const props = defineProps<{ send: MarketSend }>();
const emit = defineEmits<{ close: [] }>();
const city = useCityStore();
const user = useUserStore();
const used = ref(0);
const total = ref(0);
const prices = ref([0.1, 0.1, 0.2, 0.25]);
const form = reactive({ resType: 0, count: '0', gold: '0', hour: '1', unionOnly: false });
const resources = [1, 2, 3, 4].map((n) => i18n(`Market_MarketUserSellDialog_6_1_${n}`));
const count = computed(() => parseInt(form.count, 10) || 0);
const gold = computed(() => parseInt(form.gold, 10) || 0);
const price = computed(() => playerPrice(count.value, gold.value));
const range = computed(() => playerPriceRange(form.resType));
const stock = computed(() => [city.food, city.wood, city.rock, city.iron][form.resType] ?? 0);
const remaining = computed(() => stock.value - count.value);

function onReply(data: unknown[]): void {
  const reply = parseUserSellData(data);
  used.value = reply.used;
  total.value = reply.total;
  prices.value = reply.prices;
}

function submit(): void {
  const error = playerSellError(
    form.resType,
    count.value,
    gold.value,
    parseInt(form.hour, 10) || 0,
    form.unionOnly,
    user.unionid,
  );
  if (error) {
    void showAlert(i18n(error));
    return;
  }
  props.send(
    'sellToUser',
    playerSellArgs(form.resType, count.value, gold.value, parseInt(form.hour, 10), form.unionOnly),
  );
  emit('close');
}

onMounted(() => props.send('getUserSellData', [], 1));
defineExpose({ onReply });
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="272" :y="20" :w="137" :h="26" style-name="PopupTitle">
      <FxLabel
        :y="4"
        :w="137"
        :fx="{ textAlign: 'center', color: 15192461 }"
        :text="i18n('Market_MarketUserSellDialog_10_1')"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="60" :w="642" :h="350" style-name="BoardListUp">
      <FxLabel
        :x="20"
        :y="15"
        :w="300"
        :text="`${i18n('Market_MarketUserSellDialog_12_1')} ${total - used}/${total}`"
      />
      <FxLabel
        :x="20"
        :y="50"
        :w="100"
        style-name="ItemTitle"
        :text="i18n('Market_MarketUserSellDialog_1_1')"
      />
      <FxComboBox
        v-model:selected-index="form.resType"
        :items="resources"
        :x="130"
        :y="45"
        :w="180"
        :h="25"
      />
      <FxLabel
        :x="350"
        :y="50"
        :w="240"
        :text="`${i18n('Market_MarketUserSellDialog_17_1')}: ${stock}`"
      />
      <FxLabel
        :x="20"
        :y="95"
        :w="100"
        style-name="ItemTitle"
        :text="i18n('Market_MarketUserSellDialog_2_1')"
      />
      <FxTextInput
        v-model="form.count"
        :x="130"
        :y="88"
        :w="180"
        :h="26"
        style-name="EmptyTextInput"
        restrict="0-9"
      />
      <FxLabel
        :x="350"
        :y="95"
        :w="240"
        :text="`${i18n('Market_MarketUserSellDialog_18_1')}: ${remaining}`"
      />
      <FxLabel
        :x="20"
        :y="140"
        :w="100"
        style-name="ItemTitle"
        :text="i18n('Market_MarketUserSellDialog_3_1')"
      />
      <FxTextInput
        v-model="form.gold"
        :x="130"
        :y="133"
        :w="180"
        :h="26"
        style-name="EmptyTextInput"
        restrict="0-9"
      />
      <FxLabel
        :x="350"
        :y="140"
        :w="240"
        :text="`${i18n('Market_MarketUserSellDialog_15_1')}: ${price}`"
      />
      <FxLabel
        :x="20"
        :y="185"
        :w="100"
        style-name="ItemTitle"
        :text="i18n('Market_MarketUserSellDialog_13_1')"
      />
      <FxLabel :x="130" :y="185" :w="180" :text="String(prices[form.resType])" />
      <FxLabel
        :x="350"
        :y="185"
        :w="240"
        :text="`${i18n('Market_MarketUserSellDialog_14_1')}: ${range[0]} - ${range[1]}`"
      />
      <FxLabel
        :x="20"
        :y="230"
        :w="100"
        style-name="ItemTitle"
        :text="i18n('Market_MarketUserSellDialog_4_1')"
      />
      <FxTextInput
        v-model="form.hour"
        :x="130"
        :y="223"
        :w="100"
        :h="26"
        style-name="EmptyTextInput"
        restrict="0-9"
      />
      <FxLabel :x="240" :y="230" :w="100" :text="i18n('Market_MarketUserSellDialog_5_1')" />
      <FxToggle
        v-model:selected="form.unionOnly"
        :x="130"
        :y="275"
        :w="240"
        :label="i18n('Market_MarketUserSellDialog_9_1')"
      />
    </FxCanvas>
    <FxButton
      :x="440"
      :bottom="18"
      :w="90"
      style-name="ButtonGreen"
      :label="i18n('Market_MarketUserSellDialog_7_1')"
      @click="submit"
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
