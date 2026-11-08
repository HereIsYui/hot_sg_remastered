<script setup lang="ts">
import TaskDialog from '../task/TaskDialog.vue';
/** The original getCommissions/getCommissionDetail have no PHP implementation.
 * Read accepted commissions through TaskFunc's supported type-4 task protocol instead. */
const emit = defineEmits<{ close: [] }>();
</script>
<template>
  <TaskDialog :initial-type="4" embedded @close="emit('close')" />
</template>
