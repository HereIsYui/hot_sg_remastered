<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Bar.BottomPanel: chat input bar and the right-aligned function buttons. */
defineProps<{ x?: number; y?: number }>();

const game = useGame();

/** Right-anchored function buttons, 31px apart (friend ... shop). */
const FUNCTIONS = [
  'ButtonFriend',
  'ButtonReport',
  'ButtonMail',
  'ButtonRank',
  'ButtonStat',
  'ButtonUnion',
  'ButtonAchievement',
  'ButtonSystem',
  'ButtonCharge',
  'ButtonShop',
] as const;

/** `sys_alarm.mail`: an unread letter blinks the 邮件 button (BottomPanel.showMailAlarm). */
const mailUnread = computed(() => parseInt(String(game.city.alarm?.mail ?? 0), 10) === 1);

/** `sys_alarm.report`: an unread 战报 blinks the 战报 button (BottomPanel.showReportAlarm). */
const reportUnread = computed(() => parseInt(String(game.city.alarm?.report ?? 0), 10) === 1);

/** `sys_alarm.enemy`: incoming enemy troops light the 军情 indicator (BloodWar.onNotifyWarEvent). */
const enemyAlarm = computed(() => parseInt(String(game.city.alarm?.enemy ?? 0), 10) === 1);

/** Right offset of a function button by name, matching the FUNCTIONS layout. */
function rightOf(name: (typeof FUNCTIONS)[number]): number {
  return 4 + 31 * (FUNCTIONS.length - 1 - FUNCTIONS.indexOf(name));
}

/** The bottom-bar buttons wired so far; others stay inert until their modules are ported. */
function onClick(name: (typeof FUNCTIONS)[number]): void {
  if (name === 'ButtonMail') game.openMail();
  else if (name === 'ButtonReport') game.openReport();
  else if (name === 'ButtonFriend') game.openFriend();
}

const chatText = ref('');
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="736" :h="44" style-name="FrameScreenBoard">
    <FxButton
      v-for="(name, i) in FUNCTIONS"
      :key="name"
      :style-name="name"
      :right="4 + 31 * (FUNCTIONS.length - 1 - i)"
      :bottom="4"
      @click="onClick(name)"
    />
    <!-- 邮件 unread blink: the alarm button overlays ButtonMail when sys_alarm.mail is set. -->
    <FxButton
      v-if="mailUnread"
      style-name="ButtonMailAlarm"
      :right="rightOf('ButtonMail')"
      :bottom="4"
      :tip="i18n('Bar_BottomPanel_mail_alarm')"
      @click="onClick('ButtonMail')"
    />
    <!-- 战报 unread blink: overlays ButtonReport when sys_alarm.report is set. -->
    <FxButton
      v-if="reportUnread"
      style-name="ButtonReportAlarm"
      :right="rightOf('ButtonReport')"
      :bottom="4"
      :tip="i18n('Bar_BottomPanel_report_alarm')"
      @click="onClick('ButtonReport')"
    />
    <!-- 军情: incoming-enemy indicator shown when sys_alarm.enemy is set (opens 战报 军情 tab). -->
    <FxButton
      v-if="enemyAlarm"
      style-name="ButtonReportAlarm"
      :right="rightOf('ButtonReport')"
      :bottom="4"
      :tip="i18n('Bar_BottomPanel_enemy_alarm') || '有敌军向你的城池进军'"
      @click="onClick('ButtonReport')"
    />
    <FxImage :left="3" :top="4" :w="428" source="images/chatbar.png" />
    <FxButton :x="348" :y="9" :w="28" :h="24" style-name="ButtonSend" />
    <FxButton :x="378" :y="9" :w="28" :h="24" style-name="ButtonChatControl1" />
    <FxTextInput
      v-model="chatText"
      :x="102"
      :y="12"
      :w="250"
      :h="20"
      :max-chars="100"
      style-name="EmptyTextInput"
      :fx="{ backgroundAlpha: 0, borderStyle: 'none', color: 16777215 }"
    />
    <FxButton
      :x="15"
      :y="8"
      :w="84"
      :h="26"
      style-name="ChatChannel"
      :label="i18n('Bar_BottomPanel_1_1')"
    />
  </FxCanvas>
</template>
