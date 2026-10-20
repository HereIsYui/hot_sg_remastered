<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { assets } from '../assets/registry';
import { flexHtml } from '../core/flexHtml';
import { i18n } from '../i18n';
import { skinStyle, styleString } from './skin';
import type { GoodsTip } from './tooltip';

/** Tooltip.GoodsTip: 244 wide, as tall as its text plus 60. */
const props = defineProps<{ tip: GoodsTip; x: number; y: number }>();

const WIDTH = 244;
const textEl = ref<HTMLElement>();
const height = ref(158);
const board = computed(() =>
  skinStyle(styleString(assets.style('Canvas', 'BoardFloat'), 'borderSkin')),
);
const html = computed(() => flexHtml(props.tip.text + i18n('Tooltip_GoodsTip_1_1')));

watch(
  () => props.tip,
  async () => {
    await nextTick();
    height.value = (textEl.value?.offsetHeight ?? 98) + 60;
  },
  { immediate: true },
);

const left = computed(() => Math.max(0, Math.min(props.x, 1000 - WIDTH)));
const top = computed(() => Math.max(0, Math.min(props.y, 600 - height.value)));
</script>

<template>
  <div
    class="goods-tip"
    :style="{ left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, height: `${height}px` }"
  >
    <div class="fill" :style="board" />
    <div class="title" v-html="flexHtml(tip.title)" />
    <div ref="textEl" class="text" v-html="html" />
  </div>
</template>

<style scoped>
.goods-tip {
  position: absolute;
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.fill {
  position: absolute;
  inset: 0;
}

.title {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 144px;
  height: 24px;
  font-weight: bold;
  color: #00fff6;
  white-space: nowrap;
}

.text {
  position: absolute;
  left: 10px;
  top: 32px;
  width: 224px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.3;
}
</style>
