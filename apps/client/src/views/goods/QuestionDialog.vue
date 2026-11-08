<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { correctAnswer, type Question } from '../../game/wuhunCards';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxToggle from '../../ui/FxToggle.vue';
import GetAnswerRewardDialog from './GetAnswerRewardDialog.vue';
const props = defineProps<{ question: Question }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const selected = ref(0);
const wrong = ref(false);
const pending = ref(false);
const rewarded = ref(false);
function submit() {
  if (pending.value || rewarded.value) return;
  if (!correctAnswer(props.question, selected.value)) {
    wrong.value = true;
    return;
  }
  pending.value = true;
  game.sendGlobalCommand('goods', 'afterUseShenMiChuanYinFu', [props.question.info]);
}
const unregister = game.addGlobalReceiver('goods', (command) => {
  if (command !== 'afterUseShenMiChuanYinFu' || !pending.value) return;
  pending.value = false;
  rewarded.value = true;
  game.sendGlobalCommand('goods', 'loadUserGoods');
});
onUnmounted(unregister);
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas v-if="!rewarded" :x="90" :y="50" :w="502" :h="390" style-name="PopupDialog">
      <FxLabel :x="20" :y="15" :w="450" :text="i18n('Goods_QuestionDialog_9_1')" />
      <FxText :x="25" :y="55" :w="450" :h="90" :text="question.question" />
      <FxToggle
        v-for="(option, index) in question.options"
        :key="index"
        type="RadioButton"
        :x="30"
        :y="150 + index * 38"
        :w="440"
        :label="`${index + 1}. ${option}`"
        :selected="selected === index + 1"
        :enabled="!pending"
        @change="
          selected = index + 1;
          wrong = false;
        "
      />
      <FxLabel v-if="wrong" :x="25" :y="308" :w="450" text="回答错误，请重新选择。" />
      <FxButton
        :x="220"
        :bottom="15"
        :w="120"
        style-name="ButtonGreen"
        :label="pending ? '领取中…' : i18n('Goods_QuestionDialog_7_1')"
        :enabled="!pending"
        @click="submit"
      />
      <FxButton :right="15" :bottom="15" style-name="Close" @click="emit('close')" />
    </FxCanvas>
    <GetAnswerRewardDialog v-else @close="emit('close')" />
  </FxCanvas>
</template>
