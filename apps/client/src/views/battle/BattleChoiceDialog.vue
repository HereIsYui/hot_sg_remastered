<script setup lang="ts">
import { computed, ref } from 'vue';
import type { HallBattle } from '../../game/battlefield';
import { armBuyAgain } from '../../game/battlefieldBuyAgain';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import CreateBattleDialog from './CreateBattleDialog.vue';

/**
 * Battle.BattleChoiceDialog: the 战场 hall — the 剧情战场 / 据点战场 tabs over the
 * `cfg_battle_field` rows (type 0 / 1 of the getBattleInfo reply), the selected battle's detail
 * panel (`showBattleDetail`), 新建战场 (`onCreateBattle`) and the 请战书 重置参战次数
 * (`onResetTodayWarCount`). 加入战场 is driven from BattlePanel (`getPVPBattleInfo` reply opens
 * the JoinBattleDialog there); the 跨服 / 赤壁 / 商店 tabs are out of the stage-9 local scope.
 */
const props = defineProps<{
  battles: HallBattle[];
  todayWarCount: number;
}>();
const emit = defineEmits<{ join: [bid: number] }>();

const game = useGame();

/** `mBattleType`: 0 剧情战场 (type-0 rows), 1 据点战场 (type-1 rows). */
const battleType = ref(0);
const lastIndex = ref(0);

/** `initBattleGroups`: type 0 → group 0, type 1 → group 1 (the local tabs only). */
const groupBattles = computed(() => props.battles.filter((b) => b.type === battleType.value));
const selected = computed(() => groupBattles.value[lastIndex.value] ?? null);

/** `showBattleDetail`: the right-hand detail panel's lines. */
const detailTop = computed(() => {
  const battle = selected.value;
  if (!battle) return '';
  const people =
    Number(battle.maxpeople) === 1
      ? `${battle.maxpeople}${i18n('Battle_BattleChoiceDialogSrc_13')}`
      : `${battle.minpeople}~${battle.maxpeople}${i18n('Battle_BattleChoiceDialogSrc_13')}`;
  return (
    i18n('Battle_BattleChoiceDialogSrc_8') +
    i18n('Battle_BattleChoiceDialogSrc_9') +
    `1~${battle.maxlevel}${i18n('Battle_BattleChoiceDialogSrc_10')}` +
    i18n('Battle_BattleChoiceDialogSrc_11') +
    i18n('Battle_BattleChoiceDialogSrc_12') +
    people +
    i18n('Battle_BattleChoiceDialogSrc_14')
  );
});

/** `onShowBattleInstruction`: the popup line set from the selected row. */
const instruction = ref(false);
const instructionLevel = computed(() => {
  const battle = selected.value;
  return Number(battle?.maxpeople) === 1
    ? '----------'
    : `${battle?.minpeople ?? 0}~${battle?.maxpeople ?? 0}`;
});
const instructionImage = computed(() => `images/${selected.value?.id ?? 0}_battle_info.jpg`);

/** `doClickBattleItem` (the list click) + `switchPanel` (the tab). */
function switchPanel(group: number): void {
  battleType.value = group;
  lastIndex.value = 0;
}
function onClickBattle(_row: HallBattle, index: number): void {
  lastIndex.value = index;
}

function onTabInstruction(): void {
  instruction.value = true;
}

// ---- 新建战场 (onCreateBattle) ----
const creating = ref(false);

function onCreateBattle(): void {
  if (!selected.value) return;
  creating.value = true;
}

// ---- 加入场 (onJoinPVPBattle): BattlePanel fetches getPVPBattleInfo and opens the dialog ----
function onJoinPVPBattle(): void {
  if (!selected.value) return;
  emit('join', selected.value.id);
}

// ---- 重置参战次数 (onResetTodayWarCount) ----
async function onResetTodayWarCount(): Promise<void> {
  const answer = await showAlert(i18n('Battle_BattleChoiceDialogSrc_5'), '', ['yes', 'no']);
  if (answer !== 'yes') return;
  // a missing 请战书 (gid 138) opens the buy-and-use popup, which re-sends the command
  armBuyAgain([138], () => game.sendGlobalCommand('battle', 'resetTodayWarCount'));
  game.sendGlobalCommand('battle', 'resetTodayWarCount');
}

/** `onClose`: just hides; BattlePanel falls back to the world view. */
function close(): void {
  game.gotoView('world');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="12" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="16"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Battle_BattleChoiceDialog_1_1')"
    />
    <!-- tab row (the 跨服 / 赤壁 / 商城 tabs are out of scope) -->
    <FxButton
      :x="21"
      :y="42"
      :w="75"
      style-name="ButtonGreen"
      :selected="battleType === 0"
      :label="i18n('Battle_BattleChoiceDialog_2_1')"
      @click="switchPanel(0)"
    />
    <FxButton
      :x="95"
      :y="42"
      :w="75"
      style-name="ButtonGreen"
      :selected="battleType === 1"
      :label="i18n('Battle_BattleChoiceDialog_3_1')"
      @click="switchPanel(1)"
    />
    <FxCanvas :x="472" :y="47" :w="150" :h="25" style-name="BoardListDown">
      <FxLabel
        :x="0"
        :y="3"
        :w="147"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', fontWeight: 'bold' }"
        :text="`${i18n('Battle_BattleChoiceDialogSrc_4')}${props.todayWarCount}/5)`"
      />
    </FxCanvas>
    <FxButton
      :x="478"
      :y="446"
      :w="85"
      style-name="ButtonGreen"
      :fx="{ fontSize: 16 }"
      :label="i18n('Battle_BattleChoiceDialog_8_1')"
      :tip="i18n('Battle_BattleChoiceDialogSrc_5')"
      @click="onResetTodayWarCount"
    />
    <FxButton :x="593" :y="447" style-name="Close" :fx="{ fontSize: 16 }" @click="close" />

    <!-- battle list -->
    <FxCanvas :x="21" :y="79" :w="147" :h="366" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="141"
        :h="360"
        :row-height="20"
        :columns="[{ header: i18n('Battle_BattleChoiceDialogSrc_1'), field: 'name', width: 141 }]"
        :rows="groupBattles"
        selectable
        :selected-index="lastIndex"
        @item-click="onClickBattle"
      >
        <template #cell="{ row }">
          <span style="position: relative">
            {{ row.name }}
            <FxImage
              v-if="row.hasBattleAct"
              :x="0"
              :y="0"
              :w="20"
              :h="14"
              source="images/flag_battle_act.png"
            />
          </span>
        </template>
      </FxDataGrid>
    </FxCanvas>

    <!-- detail (`switchPanel` hides it when the tab has no battle) -->
    <FxCanvas
      v-if="groupBattles.length > 0"
      :x="176"
      :y="79"
      :w="483"
      :h="366"
      style-name="BoardListUp"
    >
      <FxImage
        :x="9"
        :y="12"
        :w="250"
        :h="150"
        :source="`images/${selected?.id ?? 0}_battle_info.jpg`"
      />
      <FxLabel
        :x="270"
        :y="40"
        :w="205"
        :h="120"
        :fx="{ textAlign: 'center', color: 3289650 }"
        :text="detailTop"
      />
      <FxLabel
        :x="10"
        :y="170"
        :w="465"
        :h="140"
        :fx="{ color: 16776960 }"
        :text="String(selected?.content ?? '')"
      />
    </FxCanvas>

    <!-- bottom buttons -->
    <FxButton
      :x="21"
      :y="446"
      :w="85"
      style-name="ButtonYellow"
      :fx="{ fontWeight: 'bold', fontSize: 14 }"
      :label="i18n('Battle_BattleChoiceDialog_5_1')"
      :tip="i18n('Battle_BattleChoiceDialog_4')"
      @click="onJoinPVPBattle"
    />
    <FxButton
      :x="114"
      :y="446"
      :w="85"
      style-name="ButtonYellow"
      :fx="{ fontWeight: 'bold', fontSize: 14 }"
      :label="i18n('Battle_BattleChoiceDialog_7_1')"
      :tip="
        selected?.canCreate
          ? i18n('Battle_BattleChoiceDialogSrc_6')
          : i18n('Battle_BattleChoiceDialogSrc_7')
      "
      :enabled="Boolean(selected?.canCreate)"
      @click="onCreateBattle"
    />
    <FxButton
      :x="207"
      :y="446"
      :w="85"
      style-name="ButtonYellow"
      :fx="{ fontWeight: 'bold', fontSize: 14 }"
      :label="i18n('Battle_BattleChoiceDialog_12')"
      @click="onTabInstruction"
    />

    <!-- the dialogs over the hall -->
    <CreateBattleDialog
      v-if="creating && selected"
      :battle-id="selected.id"
      :battle-name="String(selected.name ?? '')"
      :max-level="Number(selected.maxlevel ?? 1)"
      @close="creating = false"
    />
    <!-- `onShowBattleInstruction`: the 战场说明 popup of the selected battle -->
    <FxCanvas
      v-if="instruction && selected"
      :w="682"
      :h="492"
      :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }"
      @click="instruction = false"
    >
      <FxCanvas :x="130" :y="60" :w="420" :h="380" style-name="PanelGreyGreen">
        <FxCanvas :x="153" :y="10" :w="114" :h="26" style-name="PopupTitle">
          <FxLabel
            :x="0"
            :y="3"
            :w="114"
            style-name="PopupDialogTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('Battle_BattleInfor_2_1')"
          />
        </FxCanvas>
        <FxImage :x="12" :y="44" :w="240" :h="140" :source="instructionImage" />
        <FxLabel
          :x="260"
          :y="48"
          :w="150"
          :h="20"
          :text="`${i18n('Battle_BattleInfor_7_1')}${selected?.name ?? ''}`"
        />
        <FxLabel
          :x="260"
          :y="72"
          :w="150"
          :h="20"
          :text="`${i18n('Battle_BattleInfor_8_1')}${instructionLevel}`"
        />
        <FxLabel
          :x="12"
          :y="192"
          :w="396"
          :h="120"
          :fx="{ color: 16776960 }"
          :text="String(selected?.content ?? '')"
        />
        <FxLabel :x="12" :y="312" :w="396" :h="20" :text="String(selected?.winCondition ?? '')" />
        <FxLabel :x="12" :y="336" :w="396" :h="20" :text="String(selected?.loseCondition ?? '')" />
        <FxButton
          :x="335"
          :y="330"
          :w="65"
          :h="30"
          :label="i18n('Battle_BattleInfor_1_1')"
          @click="instruction = false"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
