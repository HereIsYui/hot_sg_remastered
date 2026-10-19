<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../../assets/registry';
import { skinStyle, styleString } from '../../ui/skin';

/** Building.BuildingTip: the floating slot title of the city views (sized by text length). */
const props = defineProps<{ text: string; x: number; y: number }>();

const textWidth = computed(() => 20 + props.text.length * 12);
const board = computed(() =>
  skinStyle(styleString(assets.style('Canvas', 'BoardFloat'), 'borderSkin')),
);
</script>

<template>
  <div class="building-tip" :style="{ left: `${x}px`, top: `${y}px`, width: `${textWidth + 4}px` }">
    <div class="fill" :style="board" />
    <div class="text" :style="{ width: `${textWidth}px` }">{{ text }}</div>
  </div>
</template>

<style scoped>
.building-tip {
  position: absolute;
  height: 22px;
  pointer-events: none;
  color: #fff;
  font-size: 12px;
}

.fill {
  position: absolute;
  inset: 0;
}

.text {
  position: absolute;
  left: 4px;
  top: 2px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
}
</style>
