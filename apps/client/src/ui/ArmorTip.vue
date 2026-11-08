<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { assets } from '../assets/registry';
import { flexHtml } from '../core/flexHtml';
import type { ArmorTip } from '../game/armor';
import { skinStyle, styleString } from './skin';

/** Tooltip.ArmorTooltip: 215 wide, the title, strengthening marks, then the text. */
const props = defineProps<{ tip: ArmorTip; x: number; y: number }>();

/** `Chat.ArmorShowTip` is 255 wide and shows the piece picture at the right. */
const WIDTH = computed(() => (props.tip.image ? 255 : 215));
const TEXT_TOP = 38;
const textEl = ref<HTMLElement>();
const height = ref(216);
const board = computed(() =>
  skinStyle(styleString(assets.style('Canvas', 'BoardFloat'), 'borderSkin')),
);

watch(
  () => props.tip,
  async () => {
    await nextTick();
    height.value = (textEl.value?.offsetHeight ?? 178) + TEXT_TOP;
  },
  { immediate: true },
);

const left = computed(() => Math.max(0, Math.min(props.x, 1000 - WIDTH.value)));
const top = computed(() => Math.max(0, Math.min(props.y, 600 - height.value)));
</script>

<template>
  <div
    class="armor-tip"
    :style="{ left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, height: `${height}px` }"
  >
    <div class="fill" :style="board" />
    <div class="title" :style="{ color: tip.color, width: tip.image ? '160px' : '200px' }">
      {{ tip.title }}
    </div>
    <img
      v-for="(star, i) in tip.stars"
      :key="i"
      class="star"
      :src="assets.url(star)"
      :style="{ left: `${10 + 9 * i}px` }"
      alt=""
    />
    <!-- ArmorShowTip's FramePicture box (x=175, y=33, 67x67) over the 64x64 piece image. -->
    <div v-if="tip.image" class="picture">
      <img :src="assets.url(tip.image)" alt="" />
    </div>
    <div ref="textEl" class="text" v-html="flexHtml(tip.text)" />
  </div>
</template>

<style scoped>
.armor-tip {
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
  left: 10px;
  top: 10px;
  width: 200px;
  font-size: 15px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
}

.star {
  position: absolute;
  top: 30px;
}

.picture {
  position: absolute;
  left: 175px;
  top: 33px;
  width: 67px;
  height: 67px;
}

.picture img {
  width: 64px;
  height: 64px;
  margin: 1px;
}

.text {
  position: absolute;
  left: 10px;
  top: 38px;
  width: 195px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.3;
}
</style>
