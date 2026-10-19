<script setup lang="ts">
import type { ConvertChoice } from '../../game/soldierConvert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/** Army.SoldierChangerItem: a soldier type's picture, count and name; empty until chosen. */
defineProps<{ x: number; y: number; item: ConvertChoice | null }>();
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="78" :h="90" style-name="BoardListDown" hand @click="emit('click')">
    <FxCanvas :x="5" :y="4" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        v-if="item"
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="`images/army_${item.sid}_big.png`"
      />
      <FxImage v-else :x="2" :y="2" :w="64" :h="64" source="images/equip_bigitem.png" />
      <FxLabel
        :x="0"
        :y="49"
        :w="68"
        :h="19"
        class="count"
        :fx="{ color: 16777215, textAlign: 'right' }"
        :text="item ? String(item.count) : ''"
      />
    </FxCanvas>
    <FxLabel
      :x="3"
      :y="70"
      :w="75"
      :h="20"
      :fx="{ color: 16777215, textAlign: 'center' }"
      :text="item?.name ?? ''"
    />
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
