<script setup lang="ts">
import { ref } from 'vue';
import type { Child } from '../../game/marry';
import MarryChildCulture from './MarryChildCulture.vue';
import MarryChildRoom from './MarryChildRoom.vue';

/** MarrySystem.MarryChild: the 教馆培养 tab host — the room view and the per-child culture view. */
const showIndex = ref(1);
const cultureChild = ref<Child | null>(null);

/** `MarryChild.onGetChildData`: a 培养 click switches to the culture view. */
function openCulture(child: Child): void {
  cultureChild.value = child;
  showIndex.value = 2;
}
</script>

<template>
  <FxCanvas :w="625" :h="353">
    <MarryChildRoom v-if="showIndex === 1" @culture="openCulture" />
    <MarryChildCulture v-else :child="cultureChild" @close="showIndex = 1" />
  </FxCanvas>
</template>
