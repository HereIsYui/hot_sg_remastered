<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '../../i18n';

/**
 * Trick/TrickTip: the BoardFloat hover tip of a trick cell — the name (yellow, bold), the 锦囊
 * price on the right and the description body.
 */
const props = defineProps<{ name: string; description: string; cost: number }>();

/** `TrickTip.setCost`: the price reads `N锦囊`. */
const price = computed(() => `${props.cost}${i18n('Trick_TrickTip_2_1')}`);
</script>

<template>
  <div class="trick-tip" :style="{ width: '230px' }">
    <div class="head">
      <span class="name">{{ name }}</span>
      <span class="price">{{ price }}</span>
    </div>
    <div class="body">{{ description }}{{ i18n('Trick_TrickTip_1_1') }}</div>
  </div>
</template>

<style scoped>
.trick-tip {
  position: absolute;
  z-index: 30;
  pointer-events: none;
  color: #fff;
  font-size: 12px;
  border: 1px solid #6c7a56;
  background: #333d21;
  box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.6);
}

.head {
  position: relative;
  height: 24px;
}

.name {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 144px;
  color: #fff6b6;
  font-weight: bold;
}

.price {
  position: absolute;
  left: 76px;
  top: 8px;
  width: 144px;
  color: #fff9dc;
  text-align: right;
  font-weight: bold;
}

.body {
  padding: 0 10px 10px;
  white-space: pre-wrap;
}
</style>
