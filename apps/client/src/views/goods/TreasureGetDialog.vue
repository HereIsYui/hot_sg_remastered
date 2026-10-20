<script setup lang="ts">
import { computed } from 'vue';
import type { TreasureItem } from '../../game/goods';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import type { TipValue } from '../../ui/tooltip';

/**
 * Goods.TreasureGetDialog: what an opened item gave, in a row that scrolls from five items on.
 * Gear shows the goods tip rather than the ArmorTooltip, which is not ported.
 */
const props = defineProps<{ items: TreasureItem[] }>();
const emit = defineEmits<{ close: [] }>();

const ITEM_SPACING = 86;
const size = computed(() =>
  props.items.length < 5
    ? { w: props.items.length * ITEM_SPACING + 32, h: 218, inner: 125 }
    : { w: 462, h: 240, inner: 145 },
);
const tip = (item: TreasureItem): TipValue => ({
  goods: { title: item.name, text: item.description },
});
</script>

<template>
  <FxCanvas :w="682" :h="492" class="treasure-get">
    <FxCanvas :x="(682 - size.w) / 2" :y="135" :w="size.w" :h="size.h" style-name="PopupDialog">
      <FxCanvas :y="43" :h="size.inner" :left="11" :right="10" style-name="BoardListUp">
        <div class="hbox">
          <FxCanvas
            v-for="(item, i) in items"
            :key="i"
            :x="i * ITEM_SPACING"
            :w="78"
            :h="105"
            style-name="BoardListDown"
          >
            <FxCanvas :x="4" :y="4" :w="68" :h="68" style-name="FramePicture">
              <FxImage :x="2" :y="2" :w="64" :h="64" :source="item.imageName" :tip="tip(item)" />
              <FxLabel
                :x="0"
                :y="49"
                :w="68"
                :h="19"
                class="count"
                :fx="{ color: 16777215, textAlign: 'right' }"
                :text="item.count"
              />
            </FxCanvas>
            <FxText
              :x="2"
              :y="69"
              :w="76"
              :h="36"
              :fx="{ color: 16777215, textAlign: 'center' }"
              :text="item.name"
            />
          </FxCanvas>
        </div>
      </FxCanvas>
      <FxCanvas :x="(size.w - 102) / 2" :y="10" :w="102" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="3"
          :w="102"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Goods_TreasureGetDialog_1_1')"
        />
      </FxCanvas>
      <FxButton :right="10" :bottom="10" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.treasure-get {
  background-color: rgba(0, 0, 0, 0.5);
}

.hbox {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  bottom: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
