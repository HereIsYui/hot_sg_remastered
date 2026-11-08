<script setup lang="ts">
import type { GoodsItem } from '../../game/goods';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
defineProps<{ items: GoodsItem[]; title?: string }>();
const emit = defineEmits<{ select: [item: GoodsItem]; close: [] }>();
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="61" :y="55" :w="560" :h="370" style-name="PopupDialog">
      <FxLabel :x="20" :y="15" :w="450" :text="title ?? '选择武魂材料'" />
      <div class="choices">
        <FxCanvas
          v-for="item in items"
          :key="item.gid"
          :w="95"
          :h="105"
          style-name="BoardListDown"
          class="choice"
        >
          <FxImage
            :x="15"
            :y="4"
            :w="64"
            :h="64"
            :source="item.imageName"
            :tip="{ goods: { title: item.name, text: item.description } }"
            hand
            @click="emit('select', item)"
          />
          <FxImage
            v-if="item.group === 6"
            :x="15"
            :y="4"
            :w="64"
            :h="64"
            :source="`images/hero_card_${['purple', 'red', 'yellow', 'blue'][Math.trunc((item.gid - 200000) / 10000) - 1]}64.png`"
            hand
            @click="emit('select', item)"
          />
          <FxLabel
            :x="3"
            :y="70"
            :w="89"
            :h="30"
            :text="`${item.name} ×${item.count}`"
            @click="emit('select', item)"
          />
        </FxCanvas>
        <span v-if="!items.length">暂无可选物品</span>
      </div>
      <FxButton :right="15" :bottom="15" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
<style scoped>
.choices {
  position: absolute;
  inset: 48px 20px 65px;
  display: flex;
  align-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  overflow: auto;
}
.choice {
  position: relative !important;
  flex: none;
}
</style>
