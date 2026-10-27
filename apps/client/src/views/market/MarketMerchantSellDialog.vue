<script setup lang="ts">
import type { MarketSend } from '../../game/market';
import MerchantResourceForm from './MerchantResourceForm.vue';

defineProps<{ level: number; send: MarketSend }>();
const emit = defineEmits<{ close: []; submitted: [] }>();
</script>

<template>
  <MerchantResourceForm
    kind="sell"
    :level="level"
    :send="send"
    @close="emit('close')"
    @submitted="emit('submitted')"
  />
</template>
