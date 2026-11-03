<script setup lang="ts">
import { computed, ref } from 'vue';
import { joinBattleStateText } from '../../game/battlefield';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import SelectUnionDialog from './SelectUnionDialog.vue';

/**
 * Battle.JoinBattleDialog: the per-level instance list `getPVPBattleInfo [bid]` answers; a row's
 * 加入 opens the SelectUnionDialog (`onJoinPVPBattle`) which sends `joinToPVPBattle`.
 */
const props = defineProps<{
  bid: number;
  battles: Record<string, unknown>[];
  unions: Record<string, unknown>[];
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const battleName = computed(() => String(props.battles[0]?.name ?? ''));
const battles = computed(() => props.battles);
const showUnion = ref(false);
const selectBattle = ref<Record<string, unknown> | null>(null);
const stateText = (row: Record<string, unknown>) => joinBattleStateText(Number(row.state), i18n);

/** `setData`: an empty list alerts instead of showing the dialog. */
if (props.battles.length === 0) {
  void showAlert(i18n('Battle_JoinBattleDialogSrc_1'));
  emit('close');
}

/** `onJoinPVPBattle` (the row's 加入 button) → `SelectUnionDialog.init`. */
function onJoin(row: Record<string, unknown>): void {
  selectBattle.value = row;
  showUnion.value = true;
}

function close(): void {
  showUnion.value = false;
  emit('close');
}

const COLUMNS = [
  { header: i18n('Battle_JoinBattleDialog_2_1'), field: 'id', width: 70 },
  { header: i18n('Battle_JoinBattleDialog_3_1'), field: 'name', width: 80 },
  { header: i18n('Battle_JoinBattleDialog_4_1'), field: 'level', width: 60 },
  { header: i18n('Battle_JoinBattleDialog_5_1'), field: 'people', width: 70 },
  { header: i18n('Battle_JoinBattleDialog_6_1'), field: 'state', width: 90 },
  { header: i18n('Battle_JoinBattleDialog_7_1'), field: 'op', width: 60 },
];

/** The row text the original's label functions produced (level 级 / the fixed battle name). */
function cellText(row: Record<string, unknown>, field: string): string {
  if (field === 'name') return battleName.value;
  if (field === 'level') return `${Number(row.level)}${i18n('Battle_JoinBattleDialogSrc_6')}`;
  if (field === 'state') return stateText(row);
  if (field === 'id') return String(row.id ?? '');
  if (field === 'people') return String(row.people ?? '');
  return '';
}

/** `SelectUnionDialog.onSubmit` → `joinToPVPBattle [bid, battlefieldid, unionid]`; the reply
 *  (entered field) is handled by BattlePanel. */
function joinUnion(unionid: number): void {
  const battle = selectBattle.value;
  if (!battle) return;
  game.sendGlobalCommand('battle', 'joinToPVPBattle', [props.bid, Number(battle.id), unionid]);
  showUnion.value = false;
  emit('close');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="117" :y="10" :w="448" :h="470" style-name="PanelGreyGreen">
      <FxCanvas :x="142" :y="15" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_JoinBattleDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="15" :y="47" :w="423" :h="361" style-name="BoardListDown">
        <FxDataGrid :x="2" :y="2" :w="419" :h="357" :columns="COLUMNS" :rows="battles">
          <template #cell="{ row, column }">
            <template v-if="column.field === 'op'">
              <FxButton
                :w="55"
                :h="25"
                style-name="ButtonRed"
                :label="i18n('Battle_JoinBattleDialog_5_1')"
                @click="onJoin(row)"
              />
            </template>
            <template v-else>{{ cellText(row, column.field) }}</template>
          </template>
        </FxDataGrid>
      </FxCanvas>
      <FxButton :x="373" :y="416" :w="65" :h="36" style-name="Close" @click="close" />
      <SelectUnionDialog
        v-if="showUnion && selectBattle"
        :battle-name="battleName"
        :state-text="stateText(selectBattle)"
        :unions="props.unions"
        @submit="joinUnion"
        @close="showUnion = false"
      />
    </FxCanvas>
  </FxCanvas>
</template>
