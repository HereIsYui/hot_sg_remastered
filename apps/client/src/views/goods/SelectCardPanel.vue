<script setup lang="ts">
import type { GoodsItem } from '../../game/goods';
import WuhunSelectDialog from './WuhunSelectDialog.vue';
defineProps<{ items: GoodsItem[] }>();
const emit = defineEmits<{ select: [item: GoodsItem]; close: [] }>();
</script>
<template>
  <WuhunSelectDialog
    :items="items"
    title="选择名将卡"
    @select="emit('select', $event)"
    @close="emit('close')"
  />
</template>
