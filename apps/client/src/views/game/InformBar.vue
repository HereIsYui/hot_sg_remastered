<script setup lang="ts">
import { computed } from 'vue';
import { INFORM_COLOR_YELLOW, informBarState, triggleNext } from '../../game/informBar';
import { cssColor } from '../../ui/skin';
import FxCanvas from '../../ui/FxCanvas.vue';

/**
 * Bar.InformBar (InformBar.as): the 732x20 translucent notice bar over the chat panel. The
 * current message scrolls right-to-left once per pass (the 30s linear Move effect), repeats
 * `scrollTimes` times, then the queue's next message plays; an empty queue hides the bar.
 */
const state = informBarState;

const color = computed(() => cssColor(state.current?.color ?? INFORM_COLOR_YELLOW));
/** Flex `repeatCount`: 0 loops forever (`Move.repeatCount`). */
const times = computed(() => {
  const t = state.current?.scrollTimes ?? 1;
  return t === 0 ? 'infinite' : String(t);
});
</script>

<template>
  <FxCanvas
    v-if="state.current"
    :x="1"
    :y="34"
    :w="732"
    :h="20"
    style-name="ChatPanel"
    :fx="{ fontSize: 12 }"
  >
    <div
      :key="state.play"
      class="inform-text"
      :style="{ color, animationIterationCount: times }"
      @animationend="triggleNext"
    >
      {{ state.current.str }}
    </div>
  </FxCanvas>
</template>

<style scoped>
.inform-text {
  position: absolute;
  left: 0;
  top: 0;
  width: max-content;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  animation: inform-bar-scroll 30s linear;
}

@keyframes inform-bar-scroll {
  from {
    transform: translateX(732px);
  }
  to {
    transform: translateX(-100%);
  }
}
</style>
