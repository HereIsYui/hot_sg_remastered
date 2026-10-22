<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Shop.BuyGoodsDialog: confirms a shop purchase. The player types a count and picks the pay
 * type (元宝 / 礼金), then `buyGoods` carries `[id, count, payType]`. For a 五铢钱 / 铜钱 item
 * (`copper` is the commend: 1 五铢钱, 0 积分) it instead carries `buyGoodsUsingCopper`
 * `[gid, type, count, commend]`, as NewShopDialog / BuyGoodsDialog.as do. ShopDialog's `shop`
 * receiver handles both replies.
 */
const props = defineProps<{ goods: Record<string, unknown>; copper?: number | null }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;

const isCopper = computed(() => props.copper === 0 || props.copper === 1);
const PAY_TYPES = [i18n('new_shop_button_16_1'), i18n('new_shop_button_16_2')];
const countText = ref('1');
const payType = ref(0);

const count = computed(() => Math.max(0, int(countText.value)));
const total = computed(() => count.value * int(props.goods.price));
const imageName = computed(() =>
  int(props.goods.image) === 0
    ? `images/item_${int(props.goods.gid)}.png`
    : `images/pack_${int(props.goods.image)}.png`,
);

/** `onSubmit`. */
function onSubmit() {
  if (count.value <= 0) {
    void showAlert(i18n('Shop_BuyGoodsDialog_8_1'));
    return;
  }
  if (isCopper.value) {
    // `[gid, type, count, commend]`: type 0 goods / 1 things; commend 1 五铢钱 / 0 积分.
    game.sendGlobalCommand('shop', 'buyGoodsUsingCopper', [
      int(props.goods.gid),
      int(props.goods.type),
      count.value,
      props.copper === 1 ? 1 : 0,
    ]);
    emit('close');
    return;
  }
  game.sendGlobalCommand('shop', 'buyGoods', [int(props.goods.id), count.value, payType.value]);
  emit('close');
}
</script>

<template>
  <FxCanvas class="buy-goods" :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxCanvas :x="218" :y="(492 - 307) / 2" :w="292" :h="307" style-name="PopupDialog">
      <FxCanvas :x="(292 - 114) / 2" :y="13" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="4"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('Shop_BuyGoodsDialog_1_1')"
        />
      </FxCanvas>

      <FxCanvas :x="95" :y="53" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="4"
          :y="3"
          :w="59"
          style-name="ItemTitle"
          :fx="{ fontWeight: 'bold', textAlign: 'center' }"
          :text="i18n('Shop_BuyGoodsDialog_2_1')"
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

      <FxCanvas :x="95" :y="87" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="4"
          :y="3"
          :w="59"
          style-name="ItemTitle"
          :fx="{ fontWeight: 'bold', textAlign: 'center' }"
          :text="i18n('Shop_BuyGoodsDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="169" :y="87" :w="104" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="104"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="`${int(goods.price)}${isCopper ? (copper === 1 ? i18n('new_shop_button_3') : i18n('new_shop_button_4')) : PAY_TYPES[payType]}`"
        />
      </FxCanvas>

      <FxCanvas :x="13" :y="128" :w="265" :h="90" style-name="BoardListDown">
        <FxText :x="2" :y="2" :w="261" :h="86" :text="String(goods.description ?? '')" />
      </FxCanvas>

      <FxCanvas :x="13" :y="226" :w="70" :h="26" style-name="BoardListUp">
        <FxLabel :x="7" :y="3" style-name="ItemTitle" :text="i18n('Shop_BuyGoodsDialog_3_1')" />
      </FxCanvas>
      <FxCanvas :x="91" :y="226" :w="50" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="countText"
          :x="2"
          :y="3"
          :w="48"
          :h="23"
          style-name="EmptyTextInput"
          :fx="{ textAlign: 'center' }"
          :max-chars="3"
        />
      </FxCanvas>
      <FxCanvas :x="149" :y="227" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel :x="7" :y="3" style-name="ItemTitle" :text="i18n('Shop_BuyGoodsDialog_6_1')" />
      </FxCanvas>
      <FxCanvas :x="223" :y="227" :w="55" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="55"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="total"
        />
      </FxCanvas>

      <FxCanvas v-if="!isCopper" :right="235" :bottom="15" :w="44" :h="26" style-name="BoardListUp">
        <FxLabel :x="7" :y="3" style-name="ItemTitle" :text="i18n('Shop_BuyGoodsDialog_7_1')" />
      </FxCanvas>
      <FxComboBox
        v-if="!isCopper"
        v-model:selected-index="payType"
        :right="151"
        :bottom="15"
        :w="70"
        :h="26"
        :items="PAY_TYPES"
      />

      <FxButton
        :right="77"
        :bottom="10"
        style-name="Confirm"
        :fx="{ fontSize: 16 }"
        @click="onSubmit"
      />
      <FxButton
        :right="10"
        :bottom="10"
        style-name="Cancel"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.buy-goods {
  pointer-events: none !important;
}

.buy-goods > :deep(*) {
  pointer-events: auto;
}
</style>
