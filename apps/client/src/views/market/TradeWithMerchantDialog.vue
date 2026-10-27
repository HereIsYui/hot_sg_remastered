<script setup lang="ts">
import { computed, ref } from 'vue';
import { merchantArgs, type MerchantAmounts, type MerchantKind } from '../../game/market-merchant';
import type { MarketSend } from '../../game/market';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

const props = defineProps<{
  kind: MerchantKind;
  amounts: MerchantAmounts;
  times: number;
  send: MarketSend;
}>();
const emit = defineEmits<{ close: []; submitted: [] }>();
const paytype = ref(0);
const cost = computed(() => props.times * 5);

function submit(): void {
  const command = props.kind === 'buy' ? 'buyFromMerchant' : 'sellToMerchant';
  props.send(command, merchantArgs(props.amounts, props.times, paytype.value));
  emit('submitted');
}
</script>

<template>
  <FxCanvas :x="181" :y="136" :w="320" :h="220" style-name="PopupDialog">
    <FxCanvas :x="92" :y="12" :w="137" :h="26" style-name="PopupTitle">
      <FxLabel
        :y="4"
        :w="137"
        :fx="{ textAlign: 'center', color: 15192461 }"
        :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}Dialog_15_1`)"
      />
    </FxCanvas>
    <FxLabel
      :x="24"
      :y="55"
      :w="272"
      :text="i18n(`Market_MarketMerchant${kind === 'buy' ? 'Buy' : 'Sell'}DialogSrc_4`)"
    />
    <FxLabel :x="24" :y="86" :w="272" :text="`批量 ${times} 次，共需 ${cost}`" />
    <FxToggle
      type="RadioButton"
      :selected="paytype === 0"
      :x="50"
      :y="120"
      :w="90"
      label="元宝"
      @change="paytype = 0"
    />
    <FxToggle
      type="RadioButton"
      :selected="paytype === 1"
      :x="180"
      :y="120"
      :w="90"
      label="礼金"
      @change="paytype = 1"
    />
    <FxButton :x="65" :y="165" :w="80" style-name="ButtonGreen" label="确定" @click="submit" />
    <FxButton
      :x="175"
      :y="165"
      :w="80"
      style-name="ButtonRed"
      label="取消"
      @click="emit('close')"
    />
  </FxCanvas>
</template>
