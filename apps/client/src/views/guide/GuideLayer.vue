<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { flexHtml } from '../../core/flexHtml';
import { useGame } from '../../game/game';
import {
  TIP_WIDTH,
  clickTarget,
  guideTipHtml,
  hitsTarget,
  layoutTip,
  maskRects,
  tileCorners,
} from '../../game/guide';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import { stagePoint } from '../../ui/tooltip';

/**
 * guide.GuideTip with its arrow and MaskCanvas/MaskShape: the step's tip beside its target, the
 * rest of the stage dimmed and closed to clicks until the target is clicked.
 */
const game = useGame();
const guide = game.guide;
const root = ref<HTMLElement>();
const textEl = ref<HTMLElement>();
const textHeight = ref(0);

watch(
  () => guide.current,
  async () => {
    await nextTick();
    textHeight.value = textEl.value?.offsetHeight ?? 0;
  },
  { immediate: true },
);

const tipHeight = computed(() => textHeight.value + 50);
const layout = computed(() => (guide.current ? layoutTip(guide.current, tipHeight.value) : null));
const target = computed(() => (guide.current ? clickTarget(guide.current) : null));
const mask = computed(() => {
  if (!target.value || !layout.value) return [];
  const tip = layout.value.tip;
  return maskRects([target.value, { x: tip.x, y: tip.y, w: TIP_WIDTH, h: tipHeight.value }]);
});
const corners = computed(() => (guide.current ? tileCorners(guide.current) : []));

/** `disClickHander` / `disDownHander` (the latter only on loaded images, like the city map). */
function onPointer(e: MouseEvent) {
  const current = guide.current;
  if (!current || !target.value || !root.value) return;
  if (e.type === 'mousedown' && !(e.target instanceof HTMLImageElement)) return;
  if (!hitsTarget(current, stagePoint(root.value, e.clientX, e.clientY))) return;
  guide.completeCurrent();
  guide.showNext();
}

async function onSkip() {
  if ((await showAlert(i18n('Guide_Other_3'), '', ['yes', 'no'])) === 'yes') guide.skip();
}

onMounted(() => {
  window.addEventListener('mousedown', onPointer);
  window.addEventListener('click', onPointer);
});
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onPointer);
  window.removeEventListener('click', onPointer);
});
</script>

<template>
  <div ref="root" class="guide-layer">
    <template v-if="guide.current && layout">
      <div
        v-for="(r, i) in mask"
        :key="i"
        class="mask"
        :style="{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }"
      />
      <svg v-if="corners.length" class="corners" width="1000" height="600">
        <polygon
          v-for="(c, i) in corners"
          :key="i"
          :points="c.map((p) => `${p.x},${p.y}`).join(' ')"
        />
      </svg>
      <FxCanvas
        :x="layout.tip.x"
        :y="layout.tip.y"
        :w="TIP_WIDTH"
        :h="tipHeight"
        style-name="TipFloat"
        :fx="{ color: 16777215, fontSize: 14, letterSpacing: 1 }"
      >
        <div ref="textEl" class="tip-text" v-html="flexHtml(guideTipHtml(guide.current.content))" />
        <div
          v-if="guide.last"
          class="tip-link"
          :style="{ top: `${textHeight + 5}px` }"
          @click="guide.completeCurrent()"
        >
          {{ i18n('Guide_Other_2') }}
        </div>
        <div v-else class="tip-link" :style="{ top: `${textHeight + 5}px` }" @click="onSkip">
          {{ i18n('Guide_Other_1') }}
        </div>
      </FxCanvas>
      <FxImage
        v-if="layout.arrow"
        :source="`images/arrow_${layout.arrow.dir}.gif`"
        :x="layout.arrow.x"
        :y="layout.arrow.y"
        :w="76"
        :h="76"
        class="arrow"
      />
    </template>
    <template v-else>
      <div
        v-for="(r, i) in guide.masks"
        :key="i"
        class="mask"
        :style="{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }"
      />
    </template>
  </div>
</template>

<style scoped>
.guide-layer {
  position: absolute;
  inset: 0;
  z-index: 800;
  pointer-events: none !important;
}

.guide-layer > * {
  pointer-events: auto;
}

.mask {
  position: absolute;
  background: rgba(0, 0, 0, 0.5);
}

.corners {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none !important;
}

.corners polygon {
  fill: rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}

.tip-text {
  position: absolute;
  top: 12px;
  left: 0;
  width: 440px;
  padding: 10px;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
}

.tip-link {
  position: absolute;
  left: 386px;
  color: #00d7ff;
  font-weight: bold;
  cursor: pointer;
  white-space: nowrap;
}

.arrow {
  pointer-events: none !important;
}
</style>
