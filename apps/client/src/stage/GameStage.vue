<script setup lang="ts">
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@hot/shared';
import { Application } from 'pixi.js';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { computeStageLayout } from './stageScale';

const sceneHost = ref<HTMLDivElement>();
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const layout = computed(() => computeStageLayout(viewport.value.width, viewport.value.height));

const stageStyle = computed(() => ({
  width: `${DESIGN_WIDTH}px`,
  height: `${DESIGN_HEIGHT}px`,
  transform: `translate(${layout.value.offsetX}px, ${layout.value.offsetY}px) scale(${layout.value.scale})`,
}));

let pixi: Application | undefined;

function onResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
}

onMounted(async () => {
  window.addEventListener('resize', onResize);
  pixi = new Application();
  await pixi.init({
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    background: '#000000',
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });
  sceneHost.value?.appendChild(pixi.canvas);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  pixi?.destroy(true);
});
</script>

<template>
  <div class="stage" :style="stageStyle">
    <div ref="sceneHost" class="scene-layer" />
    <div class="ui-layer">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  overflow: hidden;
}

.scene-layer,
.ui-layer {
  position: absolute;
  inset: 0;
}

.ui-layer {
  pointer-events: none;
}

.ui-layer > :deep(*) {
  pointer-events: auto;
}
</style>
