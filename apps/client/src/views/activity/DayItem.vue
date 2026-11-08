<script setup lang="ts">
import type { SignDay } from '../../game/loginActivity';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
defineProps<{ day: SignDay; x: number; y: number; busy?: boolean }>();
const emit = defineEmits<{ sign: [] }>();
</script>
<template>
  <FxCanvas
    :x="x"
    :y="y"
    :w="52"
    :h="32"
    :class="{ today: day.today, muted: !day.currentMonth, available: day.state === 99 && !busy }"
    :fx="{ backgroundColor: 0x201e17, backgroundAlpha: 0.8 }"
    @click="day.state === 99 && !busy && emit('sign')"
  >
    <FxLabel :x="2" :y="2" :w="24" :text="String(day.day)" />
    <FxImage
      v-if="day.state > 0"
      :x="13"
      :w="39"
      :h="32"
      :source="`images/sign_${day.state === 99 ? 'able' : day.state}.png`"
    />
  </FxCanvas>
</template>
<style scoped>
.today {
  outline: 1px solid #e2be62;
}
.muted {
  opacity: 0.45;
}
.available {
  cursor: pointer;
}
</style>
