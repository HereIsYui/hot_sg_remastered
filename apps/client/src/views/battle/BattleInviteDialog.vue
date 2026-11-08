<script setup lang="ts">
import { computed } from 'vue';
import type { BattleInviteRow } from '../../game/battleInvite';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleInviteDialog: the 战场邀请 list from `getBattleInvite`; each row joins through
 * `joinToBattle [id]` (the invite id) or drops itself with `ignoreBattle [id]`.
 */
const props = defineProps<{ rows: BattleInviteRow[] }>();
const emit = defineEmits<{ close: []; join: [id: number]; ignore: [id: number] }>();

/** The 操作 column renders the 加入 / 忽略 pair; the model gets an empty marker cell for it. */
type GridRow = BattleInviteRow & { ops: string };
const gridRows = computed<GridRow[]>(() => props.rows.map((row) => ({ ...row, ops: '' })));

const columns: { header: string; field: keyof GridRow; width: number }[] = [
  { header: i18n('Battle_BattleInviteDialog_2_1'), field: 'time', width: 100 },
  { header: i18n('Battle_BattleInviteDialog_3_1'), field: 'battlename', width: 100 },
  { header: i18n('Battle_BattleInviteDialog_4_1'), field: 'name', width: 100 },
  { header: i18n('Battle_BattleInviteDialog_5_1'), field: 'level', width: 80 },
  { header: i18n('Battle_BattleInviteDialog_6_1'), field: 'battlefieldid', width: 100 },
  { header: i18n('Battle_BattleInviteDialog_7_1'), field: 'ops', width: 152 },
];
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
        :rows="gridRows"
      >
        <template #cell="{ row, column }">
          <FxCanvas v-if="column.field === 'ops'" :x="0" :y="0" :w="152" :h="26">
            <FxButton
              :x="0"
              :y="0"
              :w="70"
              :h="26"
              :label="i18n('Battle_BattleInviteDialog_8_1')"
              @click="emit('join', (row as GridRow).id)"
            />
            <FxButton
              :x="78"
              :y="0"
              :w="70"
              :h="26"
              :label="i18n('Battle_BattleInviteDialog_9_1')"
              @click="emit('ignore', (row as GridRow).id)"
            />
          </FxCanvas>
          <span v-else>{{
            row[column.field as 'time' | 'battlename' | 'name' | 'level' | 'battlefieldid']
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
        :text="i18n('Battle_BattleInviteDialog_1_1')"
      />
    </FxCanvas>
    <FxButton :x="595" :y="393" :w="65" :h="36" style-name="Return" @click="emit('close')" />
  </FxCanvas>
</template>
