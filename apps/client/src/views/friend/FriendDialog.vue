<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  ENEMY_COLUMNS,
  FRIEND_COLUMNS,
  parseUserRelation,
  type FriendRow,
} from '../../game/friend';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useGlobalStore } from '../../stores/global';
import { gameAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * friend/FriendDialog: the 好友/仇人 lists (FriendOperation's lists feed the two grids; the
 * reply's nobility ids map through the cfg_nobility names the client cached at loadGlobalData).
 * The 好友 tab shows the info line + the name input + 确认, the 仇人 tab 删除/查看; a clicked row
 * opens the target's user-info panel (`onShowItem` — the panel arrives with the user-detail
 * wave, so rows open 暂未开放 for now). Adding/removing relations: the original carried the
 * writes over the external chat server's binary protocol (FriendOperation PROC_CHAT_*, absent
 * from the 单机包) — the remaster takes them through the main command channel
 * (addUserRelation/removeRelation, server side), so 确认 adds and 删除 removes, then the list
 * reloads.
 */
const game = useGame();
const global = useGlobalStore();

/** `mOp` (FriendDialog.as:1112/493): 0 好友, 1 仇人. */
const op = ref(0);
const friends = ref<FriendRow[]>([]);
const enemies = ref<FriendRow[]>([]);
const nameInput = ref('');

const title = computed(() =>
  i18n(op.value === 0 ? 'friend_FriendDialogSrc_4' : 'friend_FriendDialogSrc_7'),
);
const columns = computed(() => (op.value === 0 ? FRIEND_COLUMNS : ENEMY_COLUMNS));
const rows = computed(() => (op.value === 0 ? friends.value : enemies.value));

const reload = (): void => game.sendGlobalCommand('friend', 'getUserRelation');
const selected = ref<FriendRow | null>(null);
const unregister = game.addGlobalReceiver('friend', (command, data) => {
  if (command !== 'getUserRelation') return;
  const parsed = parseUserRelation(data, global.nobilityNames);
  friends.value = parsed.friends;
  enemies.value = parsed.enemies;
});
reload();

/** `onOK` (FriendDialog.as:1154): `FriendOperation.addFriend(name)` — the remaster sends the
 * relation write through the command channel with the current tab's type. */
function onOK(): void {
  const name = nameInput.value.trim();
  if (!name) return;
  game.sendGlobalCommand('friend', 'addUserRelation', [name, op.value]);
  nameInput.value = '';
  reload();
}

/** `onDeleteHostiItem` (FriendDialog.as:538): remove the selected enemy by name. */
function onDelete(): void {
  const row = selected.value;
  if (!row) {
    gameAlert(i18n('friend_FriendDialog_14_2'));
    return;
  }
  game.sendGlobalCommand('friend', 'removeRelation', [row.tname, 1]);
  reload();
}

/** `onShowItem` (FriendDialog.as:994): the user-info panel is a later wave. */
function onShowItem(): void {
  gameAlert(i18n('_CommonSrc_notOpen') || '暂未开放');
}

/** Grid row click: select the row (the panel click stays 暂未开放). */
function onItemClick(row: FriendRow): void {
  selected.value = row;
  onShowItem();
}

/** `onClose` (FriendDialog.as:793). */
function onClose(): void {
  game.closeDialog();
}
onUnmounted(unregister);
</script>

<template>
  <FxCanvas
    :x="27"
    :y="32"
    :w="682"
    :h="492"
    style-name="PopupDialog"
    :fx="{ fontSize: 12, backgroundColor: 8026746 }"
  >
    <FxCanvas :x="272" :y="18" :w="138" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="14"
        :y="4"
        :w="112"
        :h="18"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="title"
      />
    </FxCanvas>
    <FxButton
      :x="594"
      :y="437"
      :w="65"
      :h="36"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="onClose"
    />
    <FxButton
      :x="21"
      :y="47"
      :w="74"
      :h="36"
      style-name="ButtonYellow"
      :label="i18n('friend_FriendDialog_2_1')"
      :selected="op === 0"
      @click="op = 0"
    />
    <FxButton
      :x="99"
      :y="47"
      :w="74"
      :h="36"
      style-name="ButtonYellow"
      :label="i18n('friend_FriendDialog_3_1')"
      :selected="op === 1"
      @click="op = 1"
    />
    <FxCanvas :x="21" :y="88" :w="638" :h="331" style-name="BoardListDown">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="632"
        :h="325"
        :row-height="30"
        :columns="columns"
        :rows="rows"
        @item-click="onItemClick"
      />
    </FxCanvas>
    <FxButton v-if="op === 0" :x="345" :y="437" style-name="Confirm" @click="onOK" />
    <FxLabel
      v-if="op === 0"
      :x="21"
      :y="445"
      :w="152"
      :fx="{ textAlign: 'right', color: 15192461 }"
      :text="i18n('friend_FriendDialogSrc_6')"
    />
    <FxCanvas v-if="op === 0" :x="190" :y="443" :w="142" :h="26" style-name="BoardListDown">
      <FxTextInput :x="2" :y="2" :w="138" :max-chars="32" v-model="nameInput" />
    </FxCanvas>
    <FxButton
      v-if="op === 1"
      :x="504"
      :y="437"
      :w="75"
      :label="i18n('friend_FriendDialog_9_1')"
      @click="onDelete"
    />
    <FxButton
      v-if="op === 1"
      :x="418"
      :y="437"
      :w="75"
      :label="i18n('friend_FriendDialog_8_1')"
      @click="onShowItem"
    />
  </FxCanvas>
</template>
