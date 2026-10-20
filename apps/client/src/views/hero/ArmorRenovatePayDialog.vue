<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxToggle from '../../ui/FxToggle.vue';

/** Armor.ArmorRenovatePayDialog: 修复 for 元宝 or 礼金. */
const props = defineProps<{ all: boolean; cost: number }>();
const emit = defineEmits<{ pay: [byGift: boolean]; close: [] }>();

const content =
  i18n(`Armor_ArmorRenovatePayDialog_2_${props.all ? 2 : 1}`) +
  props.cost +
  i18n('Armor_ArmorRenovatePayDialog_2_3');
/** `payType`: 0 元宝, 1 礼金. */
const payType = ref(0);

function onSubmit() {
  emit('pay', payType.value === 1);
  emit('close');
}

const PICTURES = [
  [55, 'images/item_00000.png'],
  [165, 'images/item_0.png'],
] as const;
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="214" :y="89.5" :w="292" :h="305" style-name="PopupDialog">
      <FxButton
        style-name="Cancel"
        :right="10"
        :bottom="21"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxButton
        style-name="Confirm"
        :right="75"
        :bottom="21"
        :fx="{ fontSize: 16 }"
        @click="onSubmit"
      />
      <FxCanvas :x="89" :y="13" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="4"
          :w="114"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('Armor_ArmorRenovatePayDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="13.5" :y="47" :w="265" :h="79" style-name="BoardListDown">
        <FxText
          :x="2"
          :y="2"
          :w="261"
          :h="72"
          type="TextArea"
          style-name="EmptyTextInput"
          :text="content"
        />
      </FxCanvas>
      <FxCanvas
        v-for="[x, source] in PICTURES"
        :key="x"
        :x="x"
        :y="143"
        :w="68"
        :h="68"
        style-name="FramePicture"
      >
        <FxImage :x="2" :y="2" :w="64" :h="64" :source="source" />
        <FxLabel
          :x="0"
          :y="49"
          :w="68"
          :h="19"
          class="count"
          :fx="{ color: 16777215, textAlign: 'right' }"
          :text="cost"
        />
      </FxCanvas>
      <FxToggle
        :x="55"
        :y="219"
        :w="64"
        :label="i18n('Shop_BuyAndUseGoodsDialog_5_1')"
        :selected="payType === 0"
        @change="payType = 0"
      />
      <FxToggle
        :x="165"
        :y="219"
        :w="64"
        :label="i18n('Shop_BuyAndUseGoodsDialog_5_2')"
        :selected="payType === 1"
        @change="payType = 1"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
