<script setup lang="ts">
import { computed } from 'vue';

/**
 * Achivement/AchieveProgress (230x16): one 进展总览 row — the group name on the left, a progress
 * bar (the prgsImg overlay of the original, 158px filled, barColor 24688) and the
 * `current/total` label. The parent positions each row (`right` 262/22, `y` 16..116).
 */
const props = defineProps<{ infoLabel: string; current: number; total: number }>();

/** `AchieveProgress.imageWidth` (AS3 314-323): 158 * current / total, capped at 158. */
const imageWidth = computed(() => {
  if (props.total === 0) return 0;
  return Math.min(158, Math.trunc((158 * props.current) / props.total));
});

const label = computed(() => `${props.current}/${props.total}`);
</script>

<template>
  <div class="achieve-progress">
    <span class="name">{{ infoLabel }}</span>
    <div class="track">
      <div class="fill" :style="{ width: `${imageWidth}px` }" />
      <span class="text">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.achieve-progress {
  position: absolute;
  height: 16px;
  font-size: 12px;
}

.name {
  position: absolute;
  left: 0;
  top: 0;
  width: 70px;
  color: #f0e180;
  text-align: right;
}

.track {
  position: absolute;
  right: 1px;
  top: 2px;
  bottom: 2px;
  width: 160px;
  border: 1px solid #555;
  background: #000;
}

.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #006070;
}

.text {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  color: #ffff00;
  text-align: center;
}
</style>
