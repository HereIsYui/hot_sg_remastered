<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { unionEventText } from '../../game/union';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const props = defineProps<{ unionPos: number }>();
const emit = defineEmits<{ changed: [] }>();
const game = useGame();
const action = 'union_overview';
const info = ref<Record<string, unknown>>({});
const maxMembers = ref(0);
const events = ref('');
const intro = ref('');
const announcement = ref('');
const transferName = ref('');

function load(): void {
  game.sendGlobalCommand(action, 'loadUnionInfo');
  game.sendGlobalCommand(action, 'getUnionEvent', [0]);
  if (props.unionPos >= 4) game.sendGlobalCommand(action, 'getUnionIntro');
}

const unregister = game.addGlobalReceiver(action, (command, data) => {
  const d = Array.isArray(data) ? data : [];
  if (command === 'loadUnionInfo') {
    info.value = (d[1] as Record<string, unknown>) ?? {};
    maxMembers.value = Number(d[2] ?? 0);
  } else if (command === 'getUnionEvent') {
    events.value = unionEventText(data);
  } else if (command === 'getUnionIntro') {
    const row = (d[0] as Record<string, unknown>) ?? {};
    intro.value = String(row.intro ?? '');
    announcement.value = String(row.announcement ?? '');
  } else if (command === 'leaveUnion') {
    emit('changed');
  } else if (['modifyIntro', 'changeLeader', 'demissionUnion'].includes(command)) {
    emit('changed');
    load();
  }
});

function modify(): void {
  game.sendGlobalCommand(action, 'modifyIntro', [
    String(info.value.name ?? ''),
    intro.value,
    announcement.value,
    1,
  ]);
}
function transfer(): void {
  if (!transferName.value.trim()) return;
  game.sendGlobalCommand(action, 'changeLeader', [transferName.value.trim()]);
  transferName.value = '';
}
function leave(): void {
  void showAlert('确定退出联盟？', '', ['yes', 'no']).then((button) => {
    if (button === 'yes') game.sendGlobalCommand(action, 'leaveUnion');
  });
}
function demission(): void {
  game.sendGlobalCommand(action, 'demissionUnion');
}
load();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxLabel
      :x="12"
      :y="10"
      :w="590"
      :text="`${info.name ?? ''}  盟主:${info.leadername ?? ''}  成员:${info.member ?? 0}/${maxMembers}`"
    />
    <FxLabel
      :x="12"
      :y="35"
      :w="590"
      :text="`联盟声望:${info.prestige ?? 0}  排名:${info.rank ?? 0}`"
    />
    <FxLabel :x="12" :y="65" :w="80" text="联盟简介" />
    <FxTextInput v-model="intro" :x="100" :y="60" :w="500" :h="24" :max-chars="200" />
    <FxLabel :x="12" :y="95" :w="80" text="联盟公告" />
    <FxTextInput v-model="announcement" :x="100" :y="90" :w="500" :h="24" :max-chars="500" />
    <FxButton
      v-if="unionPos >= 4"
      :x="100"
      :y="125"
      :w="90"
      style-name="ButtonGreen"
      label="保存简介"
      @click="modify"
    />
    <FxText :x="12" :y="160" :w="590" :h="135" :text="events" scroll />
    <FxTextInput
      v-if="unionPos === 5"
      v-model="transferName"
      :x="12"
      :y="305"
      :w="160"
      :h="26"
      :max-chars="8"
    />
    <FxButton
      v-if="unionPos === 5"
      :x="180"
      :y="303"
      :w="90"
      style-name="ButtonGreen"
      label="转让盟主"
      @click="transfer"
    />
    <FxButton
      v-if="unionPos > 0 && unionPos < 5"
      :x="285"
      :y="303"
      :w="90"
      style-name="ButtonYellow"
      label="辞去职务"
      @click="demission"
    />
    <FxButton :x="480" :y="303" :w="100" style-name="ButtonRed" label="退出联盟" @click="leave" />
  </FxCanvas>
</template>
