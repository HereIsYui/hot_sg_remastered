<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BattleShopGood } from '../../game/battleShop';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Shop.BattleBuyGoodsDialog: the 购买战场宝物 popup — the piece's medal and honour prices times
 * the count, confirmed into `buyBattleGoods [id, count, battleGoodsType, cid]`.
 */
const props = defineProps<{ good: BattleShopGood }>();
const emit = defineEmits<{ close: []; buy: [count: number] }>();

const countInput = ref('1');
const lastCount = ref(1);

const count = computed(() => {
  const parsed = parseInt(countInput.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : lastCount.value;
});

const totalCredit = computed(() => props.good.creditPrice * count.value);
const totalMedal = computed(() => props.good.medalPrice * count.value);

/** `onChangeCount`: an invalid count snaps back to the last valid one. */
function onChange(): void {
  const parsed = parseInt(countInput.value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    countInput.value = String(lastCount.value);
    return;
  }
  lastCount.value = parsed;
}

/** `onSubmit` (`Shop_BattleBuyGoodsDialog_16_1` on a bad count). */
async function onSubmit(): Promise<void> {
  const parsed = parseInt(countInput.value, 10) || 0;
  if (parsed <= 0) {
    void showAlert(i18n('Shop_BattleBuyGoodsDialog_16_1'));
    return;
  }
  emit('buy', parsed);
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12 }" @click="emit('close')">
    <FxCanvas :x="218" :y="56" :w="326" :h="371" style-name="PopupDialog" @click.stop>
      <FxCanvas :x="120" :y="10" :w="68" :h="68" style-name="FramePicture">
        <FxImage :x="2" :y="2" :w="64" :h="64" :source="`images/${props.good.imageName}.png`" />
      </FxCanvas>
      <FxLabel :x="30" :y="90" :w="266" :fx="{ textAlign: 'center' }" :text="props.good.name" />
      <FxLabel
        :x="30"
        :y="115"
        :w="266"
        :h="90"
        :fx="{ textAlign: 'left', fontSize: 12 }"
        :text="props.good.description"
      />
      <FxLabel
        :x="30"
        :y="215"
        :w="266"
        style-name="ItemTitle"
        :text="i18n('Shop_BattleBuyGoodsDialog_3_1')"
      />
      <FxTextInput
        v-model="countInput"
        :x="120"
        :y="212"
        :w="120"
        :h="25"
        :max-chars="9"
        @change="onChange"
        @enter="onSubmit"
      />
      <FxLabel
        :x="30"
        :y="250"
        :w="266"
        style-name="ItemTitle"
        :fx="{ textAlign: 'left' }"
        :text="`${i18n('Shop_BattleBuyGoodsDialog_4_1')}: ${props.good.medalName} ×${totalMedal}，${i18n('Shop_BattleBuyGoodsDialog_5_1')} ×${totalCredit}`"
      />
      <FxButton :x="236" :y="330" :w="70" :h="31" style-name="Confirm" @click="onSubmit" />
      <FxButton :x="170" :y="330" :w="70" :h="31" style-name="Cancel" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
