<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../assets/registry';
import { skinStyle, styleString } from './skin';
import type { GoodsTip } from './tooltip';

/** Tooltip.HeroSkillTooltip: 192×120, the skill's name over its level and effect. */
const props = defineProps<{ tip: GoodsTip; x: number; y: number }>();

const WIDTH = 192;
const HEIGHT = 120;
const board = computed(() =>
  skinStyle(styleString(assets.style('Canvas', 'BoardFloat'), 'borderSkin')),
);
const left = computed(() => Math.max(0, Math.min(props.x, 1000 - WIDTH)));
const top = computed(() => Math.max(0, Math.min(props.y, 600 - HEIGHT)));
</script>

<template>
  <div
    class="skill-tip"
    :style="{ left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, height: `${HEIGHT}px` }"
  >
    <div class="fill" :style="board" />
    <div class="name">{{ tip.title }}</div>
    <div class="desc">{{ tip.text }}</div>
  </div>
</template>

<style scoped>
.skill-tip {
  position: absolute;
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.fill {
  position: absolute;
  inset: 0;
}

.name {
  position: absolute;
  left: 10px;
  top: 10px;
  width: 172px;
  font-size: 15px;
}

.desc {
  position: absolute;
  left: 10px;
  top: 40px;
  width: 172px;
  height: 70px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
