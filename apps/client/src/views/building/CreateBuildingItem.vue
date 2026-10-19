<script setup lang="ts">
import { createBuildingTip, type BuildingInfo } from '../../game/buildings';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Building.CreateBuildingItem: one building that can be put on the empty slot. */
defineProps<{ x: number; y: number; info: BuildingInfo }>();
const emit = defineEmits<{ create: [bid: number] }>();

const city = useCityStore();
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="605" :h="70" style-name="BoardListUp" :fx="{ fontSize: 12 }">
    <FxImage :x="8" :y="6" :w="72" :h="56" :source="`images/building_intro_${info.bid}.png`" />
    <FxLabel
      :x="89"
      :y="9"
      :w="57"
      style-name="ItemTitle"
      :fx="{ color: 0xffffff }"
      :text="info.name"
    />
    <FxText
      :y="10"
      :w="444"
      :h="48"
      :right="10"
      :fx="{ color: 0xffffff }"
      :text="info.description"
    />
    <FxButton
      :x="84"
      :y="32"
      :w="57"
      :h="30"
      style-name="ButtonRed"
      :fx="{ fontSize: 12, fontWeight: 'bold' }"
      :label="i18n('Building_CreateBuildingItem_1_1')"
      :enabled="info.canUpgrade"
      :tip="{ resource: () => createBuildingTip(info, city) }"
      @click="emit('create', info.bid)"
    />
  </FxCanvas>
</template>
