<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GoodsItem } from '../../game/goods';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Goods.SellGoodsPanel: how many of an item to sell back for gold. */
const props = defineProps<{ goods: GoodsItem }>();
const emit = defineEmits<{ close: []; sell: [count: number] }>();

const t = (n: number) => i18n(`Goods_SellGoodsPanel_${n}_1`);
const TITLE = { fontWeight: 'bold', textAlign: 'center' } as const;

const countText = ref('1');
const total = computed(() => props.goods.sellvalue * (parseInt(countText.value, 10) || 0));

/** `onChangeCount`: no more than owned. */
function onChange(text: string) {
  countText.value = parseInt(text, 10) > props.goods.count ? String(props.goods.count) : text;
}

function submit() {
  const count = parseInt(countText.value, 10) || 0;
  if (count <= 0) {
    void showAlert(t(7));
    return;
  }
  emit('sell', count);
  emit('close');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" class="sell-goods">
    <FxCanvas :x="218" :y="(492 - 307) / 2" :w="292" :h="307" style-name="PopupDialog">
      <FxButton
        :right="10"
        :bottom="10"
        style-name="Cancel"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxButton
        :right="80"
        :bottom="10"
        style-name="Confirm"
        :fx="{ fontSize: 16 }"
        @click="submit"
      />
      <FxCanvas :x="(292 - 114) / 2" :y="16" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel :y="4" :w="114" :fx="{ textAlign: 'center', color: 15007634 }" :text="t(1)" />
      </FxCanvas>
      <FxCanvas :x="95" :y="53" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel :x="4" :y="3" :w="59" style-name="ItemTitle" :fx="TITLE" :text="t(2)" />
      </FxCanvas>
      <FxCanvas :x="169" :y="53" :w="104" :h="26" style-name="BoardListDown">
        <FxLabel :y="3" :w="104" style-name="ItemValue" :fx="TITLE" :text="goods.name" />
      </FxCanvas>
      <FxCanvas :x="13" :y="226" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel :x="2" :y="3" style-name="ItemTitle" :text="t(3)" />
      </FxCanvas>
      <FxCanvas :x="13" :y="128" :w="265" :h="90" style-name="BoardListDown">
        <FxText
          :x="2"
          :y="2"
          :w="261"
          :h="86"
          type="TextArea"
          scroll
          style-name="EmptyTextInput"
          :text="goods.description"
        />
      </FxCanvas>
      <FxCanvas :x="81" :y="226" :w="44" :h="26" style-name="BoardListDown">
        <FxTextInput
          :y="3"
          :w="44"
          :h="23"
          style-name="EmptyTextInput"
          :fx="{ textAlign: 'center' }"
          :max-chars="3"
          :model-value="countText"
          @update:model-value="onChange"
        />
      </FxCanvas>
      <FxCanvas :x="17" :y="50" :w="68" :h="68" style-name="FramePicture">
        <FxImage :x="2" :y="2" :w="64" :h="64" :source="goods.imageName" />
        <FxLabel
          :y="49"
          :w="68"
          :h="19"
          class="count"
          :fx="{ color: 16777215, textAlign: 'right' }"
          :text="goods.count"
        />
      </FxCanvas>
      <FxCanvas :x="95" :y="87" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel :x="4" :y="3" :w="59" style-name="ItemTitle" :fx="TITLE" :text="t(4)" />
      </FxCanvas>
      <FxCanvas :x="169" :y="87" :w="104" :h="26" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="104"
          style-name="ItemValue"
          :fx="TITLE"
          :text="`${goods.sellvalue}${t(5)}`"
        />
      </FxCanvas>
      <FxCanvas :x="133" :y="227" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel :x="2" :y="3" style-name="ItemTitle" :text="t(6)" />
      </FxCanvas>
      <FxCanvas :x="201" :y="227" :w="77" :h="26" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="77"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="total"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.sell-goods {
  background-color: rgba(0, 0, 0, 0.5);
}

.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
