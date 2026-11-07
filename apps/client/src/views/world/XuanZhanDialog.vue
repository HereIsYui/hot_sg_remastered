<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxText from '../../ui/FxText.vue';
import FxToggle from '../../ui/FxToggle.vue';
const props = defineProps<{ uid: number; cid: number; username: string }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const useGoods = ref(false);
const t = (n: number) => i18n(`World_XuanZhanDialog_${n}_1`);
function submit() {
  game.declareWar(props.uid, props.cid, useGoods.value);
  emit('close');
}
</script>
<template>
  <FxCanvas :x="218" :y="97" :w="245" :h="235" style-name="PopupDialog">
    <FxLabel :x="10" :y="14" :w="225" :fx="{ textAlign: 'center' }" :text="t(1)" />
    <FxLabel :x="10" :y="44" :text="t(2)" />
    <FxLabel :x="99" :y="44" :w="137" :text="username" />
    <FxToggle
      :x="10"
      :y="80"
      :w="225"
      :selected="useGoods"
      :label="t(3)"
      @change="useGoods = !useGoods"
    />
    <FxText :x="10" :y="123" :w="225" :h="70" :text="t(4)" />
    <FxButton :right="81" :bottom="10" style-name="Confirm" @click="submit" />
    <FxButton :right="13" :bottom="10" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
