<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { PushProc } from '@hot/shared';
import type { ChatChannel, ChatLine } from '../../game/chat';
import { useGame } from '../../game/game';
import { useChatStore } from '../../stores/chat';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const props = defineProps<{ x?: number; y?: number }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const chat = useChatStore();
const mode = ref<'max' | 'medium' | 'line'>('medium');
const settings = ref(false);
const selectedUser = ref('');
const blockedInput = ref('');
const keywordInput = ref('');
const messageList = ref<HTMLElement>();
const privateInput = ref(chat.privateTarget);
const tabs: [ChatChannel, string][] = [
  ['all', '综合'],
  ['world', '世界'],
  ['union', '联盟'],
  ['private', '私聊'],
  ['war', '战况'],
];
const channelNames = ['世界', '联盟', '私聊', '战况', '赤壁'];
const height = computed(() => (mode.value === 'max' ? 510 : mode.value === 'medium' ? 260 : 70));
const lines = computed(() =>
  mode.value === 'line' ? chat.currentLines.slice(-1) : chat.currentLines,
);
const keywordPreview = computed(() => chat.keywords.slice(-100));

watch(
  () => chat.currentLines.length,
  async () => {
    await nextTick();
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
  },
);

function select(channel: ChatChannel): void {
  settings.value = false;
  chat.selectChannel(channel);
  if (channel === 'private') privateInput.value = chat.privateTarget;
}
function setPrivateTarget(): void {
  chat.selectPrivateTarget(privateInput.value);
}
function choosePrivate(name: string): void {
  chat.selectPrivateTarget(name);
  privateInput.value = chat.privateTarget;
  selectedUser.value = '';
}
function linePrefix(line: ChatLine): string {
  if (line.system) return '';
  if (line.touser && chat.current === 'all') return `[私聊] ${line.fromuser} 对 ${line.touser}`;
  return chat.current === 'all' && line.fromuser ? `${line.fromuser}` : line.fromuser;
}
function toggleChannel(index: number, event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked;
  game.push?.request(PushProc.CHAT_CONTROL_CHANNEL, { channel: index, enabled });
}
function block(name: string): void {
  if (!chat.blockUser(name)) chat.system('屏蔽玩家为空、已存在或已达到 20 人上限。');
  else chat.system(`已屏蔽玩家 ${name}。`);
}
function addBlocked(): void {
  block(blockedInput.value);
  blockedInput.value = '';
}
function keyword(add: boolean): void {
  const word = keywordInput.value.trim();
  if (!word) return;
  game.push?.request(add ? PushProc.NOTIFY_ADD_KEY_WORD : PushProc.NOTIFY_DEL_KEY_WORD, { word });
  keywordInput.value = '';
}
function mail(name: string): void {
  game.showMailWrite(null, name);
}
function friend(name: string): void {
  game.sendGlobalCommand('chat_friend', 'addUserRelation', [name, 0]);
  chat.system(`已提交好友申请：${name}。`);
}
</script>

<template>
  <FxCanvas
    :x="props.x ?? 0"
    :y="(props.y ?? 0) - height"
    :w="370"
    :h="height"
    style-name="PanelGreyGreen"
    class="chat-panel"
    :fx="{ fontSize: 12 }"
  >
    <FxButton
      v-for="([channel, label], index) in tabs"
      :key="channel"
      :x="4 + index * 72"
      :y="4"
      :w="67"
      :h="25"
      :style-name="chat.current === channel ? 'ButtonGreen' : 'ButtonYellow'"
      :label="channel === 'private' && chat.privateUnread ? `${label}●` : label"
      @click="select(channel)"
    />
    <FxButton :x="5" :y="33" :w="42" :h="22" label="最大" @click="mode = 'max'" />
    <FxButton :x="51" :y="33" :w="42" :h="22" label="中等" @click="mode = 'medium'" />
    <FxButton :x="97" :y="33" :w="42" :h="22" label="单行" @click="mode = 'line'" />
    <FxButton
      :x="250"
      :y="33"
      :w="55"
      :h="22"
      :label="settings ? '消息' : '设置'"
      @click="settings = !settings"
    />
    <FxButton :x="315" :y="33" :w="45" :h="22" label="关闭" @click="emit('close')" />

    <div v-if="!settings" ref="messageList" class="messages" :class="{ line: mode === 'line' }">
      <div v-for="line in lines" :key="line.id" class="message" :class="{ self: line.self }">
        <template v-if="line.system">{{ line.msg }}</template>
        <template v-else>
          <button v-if="line.fromuser" class="username" @click="selectedUser = line.fromuser">
            {{ linePrefix(line) }}
          </button>
          <span v-if="line.fromuser">: </span>{{ line.msg }}
        </template>
      </div>
    </div>

    <div v-else class="settings">
      <div class="setting-title">频道接收</div>
      <label v-for="(name, index) in channelNames.slice(0, 4)" :key="name">
        <input
          type="checkbox"
          :checked="chat.enabled[index]"
          @change="toggleChannel(index, $event)"
        />
        {{ name }}
      </label>
      <div class="setting-title">屏蔽玩家（{{ chat.blockedUsers.length }}/20）</div>
      <div class="blocked-list">
        <span v-for="name in chat.blockedUsers" :key="name">
          {{ name }} <button @click="chat.unblockUser(name)">解除</button>
        </span>
      </div>
      <FxTextInput v-model="blockedInput" :x="8" :y="126" :w="150" :h="23" :max-chars="32" />
      <FxButton :x="165" :y="126" :w="70" :h="23" label="屏蔽" @click="addBlocked" />
      <template v-if="game.user.group === 0">
        <div class="setting-title admin-title">
          全服屏蔽词（管理员，共 {{ chat.keywords.length }} 个，预览最近 100 个）
        </div>
        <div class="keyword-list">
          <span v-for="word in keywordPreview" :key="word">{{ word }}</span>
        </div>
        <FxTextInput v-model="keywordInput" :x="8" :y="181" :w="150" :h="23" :max-chars="32" />
        <FxButton :x="165" :y="181" :w="70" :h="23" label="添加" @click="keyword(true)" />
        <FxButton :x="242" :y="181" :w="70" :h="23" label="删除" @click="keyword(false)" />
      </template>
    </div>

    <div v-if="selectedUser" class="user-actions">
      <span>{{ selectedUser }}</span>
      <FxButton :x="90" :y="1" :w="55" :h="23" label="私聊" @click="choosePrivate(selectedUser)" />
      <FxButton
        :x="150"
        :y="1"
        :w="55"
        :h="23"
        label="写信"
        @click="
          mail(selectedUser);
          selectedUser = '';
        "
      />
      <FxButton
        :x="210"
        :y="1"
        :w="55"
        :h="23"
        label="好友"
        @click="
          friend(selectedUser);
          selectedUser = '';
        "
      />
      <FxButton
        :x="270"
        :y="1"
        :w="55"
        :h="23"
        label="屏蔽"
        @click="
          block(selectedUser);
          selectedUser = '';
        "
      />
      <FxButton :x="330" :y="1" :w="30" :h="23" label="×" @click="selectedUser = ''" />
    </div>

    <template v-if="chat.current === 'private' && mode !== 'line' && !settings">
      <FxTextInput
        v-model="privateInput"
        :x="8"
        :y="height - 34"
        :w="200"
        :h="25"
        :max-chars="32"
        @enter="setPrivateTarget"
      />
      <FxButton
        :x="215"
        :y="height - 34"
        :w="100"
        :h="25"
        label="设为私聊对象"
        @click="setPrivateTarget"
      />
    </template>
  </FxCanvas>
</template>

<style scoped>
.chat-panel {
  z-index: 40;
}
.messages {
  position: absolute;
  top: 59px;
  left: 7px;
  right: 7px;
  bottom: 38px;
  overflow: hidden auto;
  line-height: 1.55;
  color: #fff;
  text-shadow: 1px 1px #000;
}
.messages.line {
  bottom: 5px;
}
.message {
  overflow-wrap: anywhere;
}
.message.self {
  color: #ffdf80;
}
.username {
  padding: 0;
  border: 0;
  color: #9de7ff;
  background: none;
  font: inherit;
  cursor: pointer;
}
.settings {
  position: absolute;
  inset: 60px 7px 6px;
  color: #fff;
}
.setting-title {
  margin: 4px 0;
  color: #ffe28a;
}
.settings label {
  margin-right: 12px;
}
.blocked-list,
.keyword-list {
  display: flex;
  max-height: 55px;
  flex-wrap: wrap;
  gap: 4px 10px;
  overflow: auto;
}
.blocked-list button {
  padding: 0;
  border: 0;
  color: #9de7ff;
  background: none;
  cursor: pointer;
}
.admin-title {
  margin-top: 9px;
}
.user-actions {
  position: absolute;
  z-index: 2;
  right: 5px;
  bottom: 5px;
  left: 5px;
  height: 26px;
  padding: 4px;
  color: #fff;
  background: #263c3c;
}
.user-actions > span {
  position: absolute;
  top: 6px;
  left: 5px;
  max-width: 80px;
  overflow: hidden;
}
</style>
