<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Union/UnionDialog (wave 3a shell): without a union the dialog offers 创建联盟 (the name
 * input; the gates and the 10000-gold founding live server-side in createUnion) and shows the
 * pending application from getUnionApplyInvite; with a union it shows the membership header the
 * reply carries. The full UnionDialog tabs (成员列表/外交/事件/仓库…) arrive with waves 3b/3c.
 */
const game = useGame();

const unionId = ref(0);
const unionPos = ref(0);
const unionName = ref('');
const pending = ref('');
const nameInput = ref('');

interface MemberRow extends Record<string, unknown> {
  name: string;
  union_pos: number;
  donate: number;
}
interface EventRow extends Record<string, unknown> {
  content: string;
}

const members = ref<MemberRow[]>([]);
const events = ref<EventRow[]>([]);
const transferName = ref('');
const isLeader = computed(() => unionPos.value === 5);

const reload = (): void => game.sendGlobalCommand('union_empty', 'getUnionApplyInvite');
const unregister = game.addGlobalReceiver('union_empty', (command, data) => {
  const d = (Array.isArray(data) ? data : []) as unknown[];
  if (command === 'getUnionApplyInvite') {
    unionId.value = Number(d[0] ?? 0);
    unionPos.value = Number(d[1] ?? 0);
    unionName.value = String(d[2] ?? '');
    pending.value = unionId.value > 0 ? '' : String(d[2] ?? '');
    if (unionId.value > 0) {
      game.sendGlobalCommand('union_empty', 'loadUnionMemberList');
      game.sendGlobalCommand('union_empty', 'getUnionEvent', [0]);
    }
  } else if (command === 'loadUnionMemberList') {
    members.value = (d as unknown as MemberRow[]) ?? [];
  } else if (command === 'getUnionEvent') {
    const rows = Array.isArray(d?.[2]) ? (d[2] as unknown as EventRow[]) : [];
    events.value = rows.slice(0, 12);
  }
});
reload();

/** `changeLeader` via the dialog's 转让 input (盟主 only). */
function onTransfer(): void {
  const name = transferName.value.trim();
  if (!name) return;
  game.sendGlobalCommand('union_empty', 'changeLeader', [name]);
  transferName.value = '';
  reload();
}

/** `NewUnionDialog.onCreate` (the create confirm): createUnion, then reload. */
function onCreate(): void {
  const name = nameInput.value.trim();
  if (!name) return;
  game.sendGlobalCommand('union_empty', 'createUnion', [name]);
  nameInput.value = '';
  reload();
}

function onClose(): void {
  game.closeDialog();
}

const isMember = computed(() => unionId.value > 0);
const eventText = computed(() => events.value.map((e) => String(e.content ?? '')).join('\n'));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="27" :y="32" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxCanvas :x="251" :y="10" :w="180" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="4"
        :w="180"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Union_UnionDialog_27_1')"
      />
    </FxCanvas>
    <template v-if="isMember">
      <FxCanvas :x="23" :y="83" :w="635" :h="330" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="629"
          :h="200"
          :row-height="26"
          :columns="[
            { header: i18n('friend_FriendDialog_4_1'), field: 'name', width: 160 },
            { header: i18n('Union_UnionMemberListDialog_3_1'), field: 'union_pos', width: 110 },
            { header: i18n('Union_UnionMemberListDialog_6_1'), field: 'donate', width: 120 },
          ]"
          :rows="members"
        />
        <FxText :x="10" :y="206" :w="615" :h="120" :text="eventText" />
        <FxTextInput
          v-if="isLeader"
          v-model="transferName"
          :x="10"
          :y="300"
          :w="180"
          :h="24"
          :max-chars="8"
        />
        <FxButton
          v-if="isLeader"
          :x="200"
          :y="298"
          :w="90"
          :h="28"
          style-name="ButtonGreen"
          label="转让盟主"
          @click="onTransfer"
        />
      </FxCanvas>
    </template>
    <template v-else>
      <FxCanvas :x="23" :y="83" :w="635" :h="120" style-name="BoardListDown">
        <FxLabel :x="14" :y="10" :w="120" text="创建联盟" />
        <FxTextInput v-model="nameInput" :x="140" :y="8" :w="200" :h="24" :max-chars="8" />
        <FxButton
          :x="360"
          :y="6"
          :w="74"
          :h="28"
          style-name="ButtonGreen"
          :label="i18n('Union_UnionDialog_27_1')"
          @click="onCreate"
        />
        <FxLabel
          v-if="pending"
          :x="14"
          :y="60"
          :w="600"
          :text="i18n('Union_UnionDialog_27_1') + '申请中：' + pending"
        />
      </FxCanvas>
    </template>
    <FxButton
      :x="594"
      :y="437"
      :w="65"
      :h="36"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="onClose"
    />
  </FxCanvas>
</template>
