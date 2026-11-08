<script setup lang="ts">
import { ref } from 'vue';
import type { BattleMemberRow } from '../../game/battleInvite';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Battle.InviteUserDialog: the 战场成员 grid (members then pending invites) with the creator's
 * 邀请玩家 input; the 取消邀请 column shows on the cancellable invite rows only.
 */
const props = defineProps<{
  rows: BattleMemberRow[];
  countStr: string;
  isCreator: boolean;
}>();
const emit = defineEmits<{ close: []; invite: [name: string]; cancel: [id: number] }>();

const inviteName = ref('');

const columns: { header: string; field: keyof BattleMemberRow; width: number }[] = [
  { header: i18n('Battle_InviteUserDialog_2_1'), field: 'name', width: 200 },
  { header: i18n('Battle_InviteUserDialog_3_1'), field: 'camp', width: 60 },
  { header: i18n('Battle_InviteUserDialog_4_1'), field: 'state', width: 80 },
  { header: i18n('Battle_InviteUserDialog_5_1'), field: 'herocount', width: 60 },
  { header: i18n('Battle_InviteUserDialog_6_1'), field: 'honour', width: 120 },
  { header: i18n('Battle_InviteUserDialog_7_1'), field: 'cancel', width: 100 },
];

/** `InviteUserDialog.inviteUser`: an empty name sends nothing. */
function onInvite(): void {
  const name = inviteName.value.trim();
  if (!name) return;
  emit('invite', name);
  inviteName.value = '';
}
</script>

<template>
  <FxCanvas :w="682" :h="452" :fx="{ fontSize: 12 }">
    <FxCanvas :x="22" :y="113" :w="638" :h="272" style-name="BoardListDown">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="632"
        :h="269"
        :row-height="30"
        :columns="columns"
        :rows="props.rows"
      >
        <template #cell="{ row, column }">
          <FxButton
            v-if="column.field === 'cancel'"
            :x="8"
            :y="0"
            :w="75"
            :h="26"
            :label="i18n('Battle_InviteUserDialog_8_1')"
            @click="emit('cancel', (row as BattleMemberRow).id)"
          />
          <span v-else>{{
            row[column.field as 'name' | 'camp' | 'state' | 'herocount' | 'honour']
          }}</span>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxCanvas :x="222" :y="13" :w="234" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="76"
        :y="4"
        :w="98"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="i18n('Battle_InviteUserDialog_1_1')"
      />
    </FxCanvas>
    <FxCanvas :x="22" :y="61" :w="85" :h="26" style-name="BoardListUp">
      <FxLabel
        :x="0"
        :y="3"
        :w="85"
        style-name="ItemValue"
        :fx="{ textAlign: 'center' }"
        :text="i18n('Battle_InviteUserDialog_11_1')"
      />
    </FxCanvas>
    <FxCanvas :x="125" :y="61" :w="85" :h="26" style-name="BoardListDown">
      <FxLabel
        :x="0"
        :y="3"
        :w="76"
        style-name="ItemValue"
        :fx="{ textAlign: 'center' }"
        :text="props.countStr"
      />
    </FxCanvas>
    <template v-if="props.isCreator">
      <FxCanvas :x="229" :y="61" :w="85" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="85"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_InviteUserDialog_10_1')"
        />
      </FxCanvas>
      <FxCanvas :x="337" :y="61" :w="116" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="inviteName"
          :x="3"
          :y="3"
          :w="110"
          :h="20"
          :max-chars="16"
          style-name="EmptyTextInput"
          @enter="onInvite"
        />
      </FxCanvas>
      <FxButton
        :x="477"
        :y="58"
        :w="80"
        :h="34"
        :label="i18n('Battle_InviteUserDialog_9_1')"
        @click="onInvite"
      />
    </template>
    <FxButton :x="595" :y="393" :w="65" :h="36" style-name="Return" @click="emit('close')" />
  </FxCanvas>
</template>
