<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import type { BuyAndUseRequest } from '../../stores/session';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * Shop.BuyAndUseGoodsDialog: the `not_enough_goods` popup. Buys one of the item through
 * `buyGoodsBeforeUse` so the client can use it at once. 元宝 (payType 0) / 礼金 (1) is enabled
 * per the item's `commend` (0 元宝, 1 礼金, 2 both), as in the original.
 */
const props = defineProps<{ request: BuyAndUseRequest }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;

const goods = computed(() => props.request.goods);
const count = ref(1);
const payType = ref(0);

/** `mGoodBuyType`: 0 元宝 only, 1 礼金 only, 2 both. */
const buyType = computed(() => int(goods.value.commend));
const canYuanbao = computed(() => buyType.value === 0 || buyType.value === 2);
const canGift = computed(() => buyType.value === 1 || buyType.value === 2);

/** `onCommand`: the shop row's image, matching the original's item_ / pack_ rule. */
const imageName = computed(() => {
  const g = goods.value;
  return int(g.image) === 0 ? `images/item_${int(g.gid)}.png` : `images/pack_${int(g.image)}.png`;
});

function onChangePayType(type: number) {
  if ((type === 0 && !canYuanbao.value) || (type === 1 && !canGift.value)) return;
  payType.value = type;
}

/** `onSubmit`: sends `[id, count, payType]` to buyGoodsBeforeUse. */
function onSubmit() {
  game.sendGlobalCommand('buybeforeuse', 'buyGoodsBeforeUse', [
    int(goods.value.id),
    count.value,
    payType.value,
  ]);
  close();
}

function close() {
  game.session.buyAndUse = null;
}

// buyGoodsBeforeUse answers [gid, payType, balance]; the item is then used by the game.
const unregister = game.addGlobalReceiver('buybeforeuse', () => undefined);
onUnmounted(unregister);
</script>

<template>
  <FxCanvas class="buy-and-use" :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxCanvas :x="218" :y="(492 - 343) / 2" :w="292" :h="343" style-name="PopupDialog">
      <FxCanvas :x="(292 - 114) / 2" :y="13" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="4"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('Shop_BuyAndUseGoodsDialog_1_1')"
        />
      </FxCanvas>

      <FxCanvas :x="95" :y="53" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="4"
          :y="3"
          :w="59"
          style-name="ItemTitle"
          :fx="{ fontWeight: 'bold', textAlign: 'center' }"
          :text="i18n('Shop_BuyAndUseGoodsDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="169" :y="53" :w="104" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="104"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="String(goods.name ?? '')"
        />
      </FxCanvas>

      <FxCanvas :x="95" :y="87" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="4"
          :y="3"
          :w="59"
          style-name="ItemTitle"
          :fx="{ fontWeight: 'bold', textAlign: 'center' }"
          :text="i18n('Shop_BuyAndUseGoodsDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="169" :y="87" :w="104" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="104"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="`${int(goods.price)}${i18n('Shop_BuyAndUseGoodsDialog_5_1')}`"
        />
      </FxCanvas>

      <FxCanvas :x="17" :y="50" :w="68" :h="68" style-name="FramePicture">
        <FxImage
          :x="2"
          :y="2"
          :w="64"
          :h="64"
          :source="imageName"
          :tip="String(goods.description ?? '')"
        />
        <FxLabel
          :x="0"
          :y="49"
          :w="68"
          :h="19"
          :fx="{ color: 16777215, textAlign: 'right' }"
          :text="String(goods.pack ?? '')"
        />
      </FxCanvas>

      <FxCanvas :x="13" :y="128" :w="265" :h="41" style-name="BoardListDown">
        <FxLabel
          :x="4"
          :y="2"
          :w="257"
          :h="37"
          :fx="{ fontSize: 11 }"
          :text="`${i18n('Shop_BuyAndUseGoodsDialog_9_1')} ${count}`"
        />
      </FxCanvas>

      <FxToggle
        :x="59"
        :y="265"
        :w="64"
        :label="i18n('Shop_BuyAndUseGoodsDialog_5_1')"
        :selected="payType === 0"
        :enabled="canYuanbao"
        @change="onChangePayType(0)"
      />
      <FxToggle
        :x="169"
        :y="265"
        :w="64"
        :label="i18n('Shop_BuyAndUseGoodsDialog_5_2')"
        :selected="payType === 1"
        :enabled="canGift"
        @change="onChangePayType(1)"
      />

      <FxButton
        :right="59"
        :bottom="10"
        style-name="Confirm"
        :fx="{ fontSize: 16 }"
        @click="onSubmit"
      />
      <FxButton
        :right="165"
        :bottom="10"
        style-name="Cancel"
        :fx="{ fontSize: 16 }"
        @click="close"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.buy-and-use {
  pointer-events: none !important;
}

.buy-and-use > :deep(*) {
  pointer-events: auto;
}
</style>
