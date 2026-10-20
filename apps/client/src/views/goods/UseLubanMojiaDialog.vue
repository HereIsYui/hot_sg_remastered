<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxToggle from '../../ui/FxToggle.vue';

/** Goods.UseLubanMojiaDialog: finishing at once costs `cost` 元宝 (0) or 礼金 (1). */
defineProps<{ cost: number }>();
const emit = defineEmits<{ submit: [payType: number]; close: [] }>();

const payType = ref(0);

function submit() {
  emit('submit', payType.value);
  emit('close');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" class="luban-mojia" :fx="{ fontSize: 12 }">
    <FxCanvas :x="214" :y="(492 - 305) / 2 - 2" :w="292" :h="305" style-name="PopupDialog">
      <FxCanvas :x="(292 - 114) / 2" :y="13" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="4"
          :w="114"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('Goods_UseLubanMojiaDialog_1')"
        />
      </FxCanvas>
      <FxCanvas :x="13.5" :y="47" :w="265" :h="79" style-name="BoardListDown">
        <FxText
          :x="2"
          :y="2"
          :w="261"
          :h="72"
          scroll
          :text="`${i18n('Goods_UseLubanMojiaDialog_2')}${cost}${i18n('Goods_UseLubanMojiaDialog_3')}`"
        />
      </FxCanvas>
      <FxCanvas
        v-for="(image, i) in ['images/item_00000.png', 'images/item_0.png']"
        :key="image"
        :x="55 + i * 110"
        :y="143"
        :w="68"
        :h="68"
        style-name="FramePicture"
      >
        <FxImage :x="2" :y="2" :w="64" :h="64" :source="image" />
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
        v-for="(label, i) in [
          i18n('Shop_BuyAndUseGoodsDialog_5_1'),
          i18n('Shop_BuyAndUseGoodsDialog_5_2'),
        ]"
        :key="i"
        :x="55 + i * 110"
        :y="219"
        :w="64"
        :label="label"
        :selected="payType === i"
        @change="payType = i"
      />
      <FxButton
        :right="75"
        :bottom="21"
        style-name="Confirm"
        :fx="{ fontSize: 16 }"
        @click="submit"
      />
      <FxButton
        :right="10"
        :bottom="21"
        style-name="Cancel"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.luban-mojia {
  background-color: rgba(0, 0, 0, 0.5);
}

.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
