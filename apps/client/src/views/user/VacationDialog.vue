<script setup lang="ts">
import { computed } from 'vue';
import { endTimeText, serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import { vacationCancelWait } from '../../game/userState';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxText from '../../ui/FxText.vue';
const game = useGame();
const props = defineProps<{ start: number; end: number; started: boolean }>();
const t = (n: number) => i18n(`UserInfo_VacationDialog_${n}_1`);
const info = computed(() => {
  const n = props.started ? 8 : 5;
  return t(n) + endTimeText(props.start) + t(n + 1) + endTimeText(props.end) + t(n + 2);
});
function cancel() {
  const wait = vacationCancelWait(props.start, serverTime());
  if (wait > 0) {
    void showAlert(t(11) + timeLeftText(wait, i18n) + t(12));
    return;
  }
  game.changeUserState(0, '2');
}
function quit() {
  game.session.vacation = null;
  game.popGame();
}
</script>
<template>
  <FxCanvas :w="1000" :h="600" :fx="{ backgroundColor: 0, backgroundAlpha: 0.6 }">
    <FxCanvas :x="361" :y="226" :w="278" :h="254" style-name="PopupDialog">
      <FxLabel :x="20" :y="18" :w="238" :fx="{ textAlign: 'center' }" :text="t(1)" />
      <FxText :x="20" :y="55" :w="238" :h="133" :text="info" scroll />
      <FxButton
        :x="20"
        :bottom="20"
        :w="100"
        style-name="ButtonGreen"
        :label="t(2)"
        @click="cancel"
      />
      <FxButton
        :right="20"
        :bottom="20"
        :w="100"
        style-name="ButtonRed"
        :label="t(3)"
        @click="quit"
      />
    </FxCanvas>
  </FxCanvas>
</template>
