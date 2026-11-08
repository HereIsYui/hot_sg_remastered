<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import type { GoodsItem } from '../../game/goods';
import { availableCards, mixCardArgs } from '../../game/wuhunCards';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import SelectCardPanel from './SelectCardPanel.vue';
const props = defineProps<{ cards: GoodsItem[]; initial: GoodsItem }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const slots = ref<(GoodsItem | null)[]>([
  props.initial.gid >= 220000 ? props.initial : null,
  null,
  null,
  null,
  null,
  null,
  null,
]);
const target = ref<number | null>(null);
const choices = computed(() => availableCards(props.cards, slots.value, target.value ?? 0));
function choose(item: GoodsItem) {
  if (target.value === null) return;
  if (target.value === 0) slots.value = [item, null, null, null, null, null, null];
  else slots.value[target.value] = item;
  target.value = null;
}
function select(index: number) {
  if (index !== 0 && !slots.value[0]) {
    void showAlert(i18n('Hero_card_5'));
    return;
  }
  target.value = index;
}
function submit() {
  const args = mixCardArgs(slots.value);
  if (!args) {
    void showAlert(i18n('Hero_card_4'));
    return;
  }
  // Do not gate on server mode: the original single-player server reports its closed error.
  game.sendGlobalCommand('goods', 'mixCard', args);
  emit('close');
}
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="30" :y="75" :w="622" :h="340" style-name="PopupDialog">
      <FxLabel
        :x="20"
        :y="15"
        :w="500"
        :text="`名将卡合成 · 成功率 ${slots.slice(1).filter(Boolean).length * 4}%`"
      />
      <FxCanvas
        v-for="(item, index) in slots"
        :key="index"
        :x="20 + index * 84"
        :y="90"
        :w="78"
        :h="120"
        style-name="BoardListDown"
      >
        <FxImage
          v-if="item"
          :x="7"
          :y="5"
          :w="64"
          :h="64"
          :source="item.imageName"
          :tip="item.description"
          hand
          @click="select(index)"
        />
        <FxButton v-else :x="5" :y="20" :w="68" label="选择" @click="select(index)" />
        <FxLabel
          :x="2"
          :y="75"
          :w="74"
          :h="40"
          :text="item?.name ?? (index === 0 ? '主卡' : '材料')"
          @click="select(index)"
        />
      </FxCanvas>
      <FxLabel
        :x="20"
        :y="230"
        :w="580"
        text="选择一张主卡与最多六张同品质材料，材料每张消耗一份。"
      />
      <FxButton
        :x="350"
        :bottom="20"
        :w="100"
        style-name="ButtonGreen"
        label="合成"
        @click="submit"
      />
      <FxButton :right="20" :bottom="20" style-name="Close" @click="emit('close')" />
    </FxCanvas>
    <SelectCardPanel
      v-if="target !== null"
      :items="choices"
      @select="choose"
      @close="target = null"
    />
  </FxCanvas>
</template>
