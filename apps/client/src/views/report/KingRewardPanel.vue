<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Report.KingRewardPanel: the daily 君主奖励 (五铢钱) claim. `getKingReward` either returns the
 * success message (the server granted the level-tiered reward) or fails with 当前没有您的君主将 /
 * 您已经领取过奖励, both shown through the standard alert. The reply arrives on the `king` action.
 */
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const t = (n: number) => i18n(`Report_KingRewardPanel_${n}_1`);

const message = ref('');
const claimed = ref(false);

function claim(): void {
  if (claimed.value) return;
  game.sendGlobalCommand('report', 'getKingReward');
}

const unregister = game.addGlobalReceiver('report', (command, data) => {
  if (command !== 'getKingReward') return;
  const text = String((Array.isArray(data) ? data[0] : '') ?? '');
  message.value = text;
  claimed.value = true;
  if (text) gameAlert(text);
});

onMounted(() => void 0);
onUnmounted(unregister);
</script>

<template>
  <FxCanvas
    :x="(682 - 420) / 2"
    :y="(492 - 260) / 2"
    :w="420"
    :h="260"
    style-name="PopupDialog"
    :fx="{ fontSize: 12 }"
  >
    <FxLabel
      :x="0"
      :y="18"
      :w="420"
      :h="20"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'bold' }"
      :text="t(1) || '君主奖励'"
    />
    <FxCanvas :x="24" :y="54" :w="372" :h="150" style-name="BoardListDown">
      <FxLabel
        :x="16"
        :y="20"
        :w="340"
        :h="110"
        :fx="{ color: 15983262 }"
        :text="message || t(2) || '每日可领取一次五铢钱奖励，奖励数量随君主将等级提升。'"
      />
    </FxCanvas>
    <FxButton
      :x="120"
      :y="214"
      :w="80"
      :h="34"
      style-name="ButtonGreen"
      :label="t(3) || '领取'"
      :enabled="!claimed"
      @click="claim()"
    />
    <FxButton
      :x="220"
      :y="214"
      :w="80"
      :h="34"
      style-name="ButtonRed"
      :label="t(4) || '关闭'"
      @click="emit('close')"
    />
  </FxCanvas>
</template>
