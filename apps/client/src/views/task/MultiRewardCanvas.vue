<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Task.MultiRewardCanvas: how many times to hand in a repeatable task. */
defineProps<{ x: number; y: number }>();
const emit = defineEmits<{ get: [count: number]; close: [] }>();
const t = (n: number) => i18n(`Task_MultiRewardCanvas_${n}_1`);

const count = ref('1');

/** `onGetReward`: only a plainly written number is sent. */
function onGet() {
  const n = parseInt(count.value, 10);
  if (String(n) !== count.value) {
    void showAlert(i18n('Task_Other_1'));
    return;
  }
  emit('get', n);
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="258" :h="162" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="72" :y="19" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel :x="0" :y="4" :w="114" :fx="{ textAlign: 'center', color: 15007634 }" :text="t(1)" />
    </FxCanvas>
    <FxCanvas :x="44.5" :y="64" :w="66" :h="26" style-name="BoardListUp">
      <FxLabel :x="7" :y="3" style-name="ItemTitle" :text="t(2)" />
    </FxCanvas>
    <FxCanvas :x="121.5" :y="64" :w="92" :h="26" style-name="BoardListDown">
      <FxTextInput
        v-model="count"
        :x="5"
        :y="3"
        :w="80"
        :h="23"
        restrict="0-9"
        :max-chars="3"
        style-name="EmptyTextInput"
        :fx="{ textAlign: 'center' }"
        @enter="onGet"
      />
    </FxCanvas>
    <FxButton :x="48" :y="112" style-name="ButtonGreen" :label="t(3)" @click="onGet" />
    <FxButton :x="168" :y="112" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
