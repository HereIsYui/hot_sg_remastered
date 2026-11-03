<script setup lang="ts">
import { computed } from 'vue';
import type { BattleTroop, FiledViewRow } from '../../game/battlefield';
import type { BattleFieldState } from '../../game/battlefield';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleFiledViewDialog: the clicked 据点's troop list (`getBattleFieldState` reply).
 * The bottom buttons: 派遣 (`onSendArmy`), 增援 (`onAddArmy`, only when a自家军队 stands there),
 * 探索 (`onQuest`); each row's ops follow `resetData`: 详情 (canView), 巡逻 (canPatrol),
 * 攻击 (canAttack), 对话 (canChat + enableChat).
 */
const props = defineProps<{
  state: BattleFieldState;
  rows: FiledViewRow[];
  canSend: boolean;
  selectedTroop: BattleTroop | null;
}>();
const emit = defineEmits<{
  sendArmy: [];
  attack: [targetTroopId: number];
  patrol: [targetTroopId: number];
  chat: [targetTroopId: number];
  view: [targetTroopId: number];
  addArmy: [];
  quest: [];
  close: [];
}>();

/** `resetData`: 探索 sits at x=106 when there is no 增兵 button, else 188. */
const questX = computed(() => (props.state.canAddArmy ? 188 : 106));

const COLUMNS = [
  { header: i18n('Battle_BattleFiledViewDialog_2_1'), field: 'name', width: 100 },
  { header: i18n('Battle_BattleFiledViewDialog_3_1'), field: 'union', width: 100 },
  { header: i18n('Battle_BattleFiledViewDialog_4_1'), field: 'hero', width: 100 },
  { header: i18n('Battle_BattleFiledViewDialog_5_1'), field: 'level', width: 100 },
  { header: i18n('Battle_BattleFiledViewDialog_6_1'), field: 'op', width: 144 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="40" :y="43" :w="602" :h="400" style-name="PanelGreyGreen">
      <FxCanvas :x="232" :y="21" :w="138" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="14"
          :y="4"
          :w="112"
          :h="18"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="props.state.cityname"
        />
      </FxCanvas>
      <FxCanvas :x="26" :y="64" :w="550" :h="272" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="544"
          :h="262"
          :row-height="28"
          :columns="COLUMNS"
          :rows="props.rows"
          selectable
        >
          <template #cell="{ row, column }">
            <template v-if="column.field === 'op'">
              <FxButton
                v-if="row.canView"
                :w="44"
                :h="22"
                style-name="ButtonYellow"
                :fx="{ fontSize: 11 }"
                :label="i18n('Battle_BattleFiledViewDialog_7_1')"
                @click="emit('view', Number(row.id))"
              />
              <FxButton
                v-if="row.canPatrol"
                :w="44"
                :h="22"
                style-name="ButtonYellow"
                :fx="{ fontSize: 11 }"
                :label="i18n('Battle_BattleFiledViewDialog_8_1')"
                @click="emit('patrol', Number(row.id))"
              />
              <FxButton
                v-if="row.canAttack"
                :w="44"
                :h="22"
                style-name="ButtonYellow"
                :fx="{ fontSize: 11 }"
                :label="i18n('Battle_BattleFiledViewDialog_9_1')"
                @click="emit('attack', Number(row.id))"
              />
              <FxButton
                v-if="row.canChat"
                :w="44"
                :h="22"
                style-name="ButtonYellow"
                :fx="{ fontSize: 11 }"
                :enabled="row.enableChat"
                :label="i18n('Battle_BattleFiledViewDialog_10_1')"
                @click="emit('chat', Number(row.id))"
              />
            </template>
            <template v-else>{{ row[column.field] ?? '' }}</template>
          </template>
        </FxDataGrid>
      </FxCanvas>
      <!-- 派遣 (canSend stays true while no enemy row blocks it) -->
      <FxButton
        :x="26"
        :y="354"
        :w="74"
        :h="36"
        style-name="ButtonYellow"
        :enabled="props.canSend && Boolean(props.selectedTroop)"
        :label="i18n('Battle_BattleFiledViewDialog_1_1')"
        @click="emit('sendArmy')"
      />
      <FxButton
        v-if="props.state.canAddArmy"
        :x="106"
        :y="354"
        :w="74"
        :h="36"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleAddArmyDialog_8_1')"
        @click="emit('addArmy')"
      />
      <FxButton
        v-if="props.state.canQuest"
        :x="questX"
        :y="354"
        :w="74"
        :h="36"
        style-name="ButtonYellow"
        :enabled="props.state.enableQuest"
        :label="i18n('Battle_BattleFiledViewDialog_12_1')"
        @click="emit('quest')"
      />
      <FxButton
        :x="511"
        :y="354"
        :w="65"
        :h="36"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
