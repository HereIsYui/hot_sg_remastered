<script setup lang="ts">
import { computed, ref } from 'vue';
import { parseChatInput, validChatMessage, type ChatChannel } from '../../game/chat';
import { useGame } from '../../game/game';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { PushProc } from '@hot/shared';
import { i18n } from '../../i18n';
import ChatPanel from '../chat/ChatPanel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Bar.BottomPanel: chat input bar and the right-aligned function buttons. */
defineProps<{ x?: number; y?: number }>();

const game = useGame();
const session = useSessionStore();

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
  else if (name === 'ButtonRank') session.dialog = { name: 'rank' };
}

const chatText = ref('');
const chat = useChatStore();
const chatOpen = ref(false);
const lastSend = ref(0);
const channelLabel = computed(() => {
  if (chat.current === 'private') return chat.privateTarget ? `私聊:${chat.privateTarget}` : '私聊';
  return { all: '综合', world: '世界', union: '联盟', war: '战况' }[chat.current];
});

function sendChat(): void {
  const current = chat.current === 'union' || chat.current === 'private' ? chat.current : 'world';
  const send = parseChatInput(chatText.value, current, chat.privateTarget);
  if (!validChatMessage(send.msg)) {
    chat.system('不能发送空白消息。', send.channel);
    return;
  }
  if (send.channel === 'private' && !send.touser) {
    chat.system('请先设置私聊玩家。', 'private');
    chatOpen.value = true;
    return;
  }
  if (send.channel === 'union' && game.user.unionid === 0) {
    chat.system('你尚未加入联盟。', 'union');
    return;
  }
  const enabledIndex = { world: 0, union: 1, private: 2 }[send.channel];
  if (!chat.enabled[enabledIndex]) {
    chat.system('该频道已关闭，请先在设置中开启。', send.channel);
    return;
  }
  if (Date.now() - lastSend.value < 5000) {
    chat.system('发言太频繁，请稍后再试。', send.channel);
    return;
  }
  const proc = {
    world: PushProc.CHAT_PUBLIC_CHAT,
    union: PushProc.CHAT_UNION_CHAT,
    private: PushProc.CHAT_PRIVATE_CHAT,
  }[send.channel];
  if (send.channel === 'private') chat.selectPrivateTarget(send.touser);
  game.push?.request(proc, { msg: send.msg, touser: send.touser });
  lastSend.value = Date.now();
  chatText.value = '';
}

function cycleChannel(): void {
  const channels: ChatChannel[] = ['world', 'union', 'private'];
  const index = channels.indexOf(chat.current);
  chat.selectChannel(channels[(index + 1) % channels.length]!);
  chatOpen.value = true;
}

const chatLines = computed(() => chat.recentLines);
</script>

<template>
  <div class="bottom-panel" :style="{ left: `${x ?? 0}px`, top: `${y ?? 0}px` }">
    <FxCanvas :x="0" :y="0" :w="736" :h="44" style-name="FrameScreenBoard">
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
      <FxButton :x="348" :y="9" :w="28" :h="24" style-name="ButtonSend" @click="sendChat" />
      <FxButton
        :x="378"
        :y="9"
        :w="28"
        :h="24"
        style-name="ButtonChatControl1"
        @click="chatOpen = !chatOpen"
      />
      <FxTextInput
        v-model="chatText"
        :x="102"
        :y="12"
        :w="250"
        :h="20"
        :max-chars="100"
        style-name="EmptyTextInput"
        :fx="{ backgroundAlpha: 0, borderStyle: 'none', color: 16777215 }"
        @enter="sendChat"
      />
      <FxButton
        :x="15"
        :y="8"
        :w="84"
        :h="26"
        style-name="ChatChannel"
        :label="channelLabel"
        @click="cycleChannel"
      />
    </FxCanvas>
    <ChatPanel v-if="chatOpen" :x="0" :y="0" @close="chatOpen = false" />
    <div v-if="!chatOpen" class="chat-lines">
      <div v-for="line in chatLines" :key="line.id" class="chat-line">
        <template v-if="line.fromuser">{{ line.fromuser }}: </template>{{ line.msg }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.bottom-panel {
  position: absolute;
  z-index: 40;
  width: 736px;
  height: 44px;
}

.chat-lines {
  position: absolute;
  z-index: 20;
  left: 8px;
  bottom: 96px;
  width: 428px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
}

.chat-line {
  color: #fff;
  font-size: 12px;
  text-shadow: 1px 1px 0 #000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
