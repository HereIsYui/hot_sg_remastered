<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { serverTime, timeOfDay } from '../../core/clock';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxText from '../../ui/FxText.vue';

/** ServerTime: the server clock shown over the inner city. */
defineProps<{ x?: number; y?: number }>();

const now = ref(serverTime());
const timer = setInterval(() => (now.value = serverTime()), 1000);
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="205" :h="32" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxText
      :x="4"
      :y="5"
      :w="70"
      :h="23"
      :fx="{ paddingTop: 2, fontSize: 13, color: 15057438, textAlign: 'right' }"
      :text="i18n('Server_Current_time')"
    />
    <FxCanvas :x="79" :y="5" :w="120" :h="23" style-name="BoardListDown">
      <FxText
        :left="0"
        :right="0"
        :top="0"
        :bottom="0"
        style-name="ItemValue"
        :fx="{ fontWeight: 'bold', textAlign: 'center', color: 15057438, fontSize: 12 }"
        :text="timeOfDay(now)"
      />
    </FxCanvas>
  </FxCanvas>
</template>
