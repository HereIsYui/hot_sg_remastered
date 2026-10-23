<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { parseStayTroops, parseTroopRows, type TroopRow } from '../../game/troop';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';
import EnemyTroopSetPanel from './EnemyTroopSetPanel.vue';
import TroopTablePanel from './TroopTablePanel.vue';

/**
 * Troop/TroopDialog: the 军队 dialog (本国 / 敌军 / 驻扎 / 联盟 tabs). Each tab loads its own troop
 * list (`getArmyTroops` / `getEnemyTroops` / `getStayTroops` / `getUnionTroops`) and renders a
 * TroopTablePanel; the 驻扎 tab adds 自动遣返 (allowAutoDiscard), 全部集结 / 结束集结
 * (gatherStartAll / gatherEndAll); the 敌军 tab adds the 警报过滤 (EnemyTroopSetPanel). Row clicks
 * open the TroopDetailDialog; the 召回 / 踢回 buttons run callBackTroop / kickTroop.
 */
const game = useGame();

type Tab = 'army' | 'enemy' | 'stay' | 'union';
const tab = ref<Tab>('army');
const army = ref<TroopRow[]>([]);
const enemy = ref<TroopRow[]>([]);
const stay = ref<TroopRow[]>([]);
const union = ref<TroopRow[]>([]);
const autoDiscard = ref(false);
const showEnemySet = ref(false);

const current = computed(() => {
  switch (tab.value) {
    case 'army':
      return army.value;
    case 'enemy':
      return enemy.value;
    case 'stay':
      return stay.value;
    default:
      return union.value;
  }
});

/** `switchPanel`: load the newly selected tab's troops. */
function load(which: Tab = tab.value): void {
  if (which === 'army') game.sendGlobalCommand('troop', 'getArmyTroops', [serverTime()]);
  else if (which === 'enemy') game.sendGlobalCommand('troop', 'getEnemyTroops', [serverTime()]);
  else if (which === 'stay') game.sendGlobalCommand('troop', 'getStayTroops', [serverTime()]);
  else game.sendGlobalCommand('troop', 'getUnionTroops');
}

function switchTab(which: Tab): void {
  tab.value = which;
  load(which);
}

const unregister = game.addGlobalReceiver('troop', (command, data) => {
  switch (command) {
    case 'getArmyTroops':
      army.value = parseTroopRows(data);
      break;
    case 'getEnemyTroops':
      enemy.value = parseTroopRows(data);
      break;
    case 'getStayTroops': {
      const parsed = parseStayTroops(data);
      autoDiscard.value = parsed.allowAutoDiscard;
      stay.value = parsed.troops;
      break;
    }
    case 'getUnionTroops':
      union.value = parseTroopRows(data);
      break;
    case 'callBackTroop':
    case 'luoyangCallbackTroop':
    case 'kickTroop':
      load();
      break;
    case 'gatherFieldStart':
    case 'gatherStartAll':
    case 'gatherEndAll':
    case 'gatherFieldEnd':
      load('stay');
      break;
  }
});

/** A row click opens the detail pop-up, with the army type the current tab implies. */
function onRow(troop: TroopRow): void {
  const armyType = tab.value === 'enemy' ? 'enemy' : tab.value === 'union' ? 'union' : 'self';
  game.showTroopDetail(troop, armyType);
}

/** `onControlTroop`: 召回 the own / stay / union troop (kick for union list). */
function onControl(troop: TroopRow): void {
  if (tab.value === 'union') {
    game.sendGlobalCommand('troop', 'kickTroop', [troop.id]);
    return;
  }
  const cmd = troop.targetcid === 215265 ? 'luoyangCallbackTroop' : 'callBackTroop';
  game.sendGlobalCommand('troop', cmd, [troop.id]);
}

function onAutoDiscard(value: boolean): void {
  autoDiscard.value = value;
  game.sendGlobalCommand('troop', 'allowAutoDiscard', [value]);
}

async function onGatherStartAll(): Promise<void> {
  if (
    (await showAlert(i18n('Troop_TroopDialogSrc_26') || '确定全部集结？', '', ['yes', 'no'])) ===
    'yes'
  ) {
    game.sendGlobalCommand('troop', 'gatherStartAll');
  }
}

function onGatherEndAll(): void {
  game.sendGlobalCommand('troop', 'gatherEndAll');
}

const d = (n: number) => i18n(`Troop_TroopDialog_${n}_1`);

onMounted(() => load('army'));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxLabel
      :x="263"
      :y="15"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Troop_TroopDialog_1_1') || '军队'"
    />
    <FxButton
      :right="20"
      :top="12"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeTroopDialog()"
    />

    <!-- tabs -->
    <FxButton
      :x="20"
      :y="53"
      :w="78"
      :h="36"
      style-name="ButtonGreen"
      :selected="tab === 'army'"
      :label="d(2) || '本国'"
      @click="switchTab('army')"
    />
    <FxButton
      :x="106"
      :y="53"
      :w="78"
      :h="36"
      style-name="ButtonRed"
      :selected="tab === 'enemy'"
      :label="d(3) || '敌军'"
      @click="switchTab('enemy')"
    />
    <FxButton
      :x="192"
      :y="53"
      :w="78"
      :h="36"
      style-name="ButtonYellow"
      :selected="tab === 'stay'"
      :label="d(4) || '驻扎'"
      @click="switchTab('stay')"
    />
    <FxButton
      :x="278"
      :y="53"
      :w="78"
      :h="36"
      style-name="ButtonGreen"
      :selected="tab === 'union'"
      :label="d(5) || '联盟'"
      @click="switchTab('union')"
    />

    <!-- enemy filter button (敌军 tab) -->
    <FxButton
      v-if="tab === 'enemy'"
      :x="420"
      :y="57"
      :w="120"
      :h="28"
      style-name="ButtonGreen"
      :label="i18n('Enemy_Troop_Set_1') || '警报过滤'"
      @click="showEnemySet = true"
    />

    <!-- the troop table -->
    <div class="panel">
      <TroopTablePanel
        :key="tab"
        :troops="current"
        :kind="tab"
        @action="onRow"
        @control="onControl"
        @reload="load()"
      />
    </div>

    <!-- 驻扎 tab controls -->
    <template v-if="tab === 'stay'">
      <div class="auto-discard">
        <FxToggle
          v-model:selected="autoDiscard"
          :label="d(10) || '自动遣返'"
          @change="onAutoDiscard"
        />
      </div>
      <FxButton
        :x="425"
        :y="438"
        :w="70"
        :h="30"
        style-name="ButtonYellow"
        :label="d(12) || '全部集结'"
        @click="onGatherStartAll"
      />
      <FxButton
        :x="512"
        :y="438"
        :w="70"
        :h="30"
        style-name="ButtonYellow"
        :label="d(11) || '结束集结'"
        @click="onGatherEndAll"
      />
    </template>

    <EnemyTroopSetPanel v-if="showEnemySet" @close="showEnemySet = false" />
  </FxCanvas>
</template>

<style scoped>
.panel {
  position: absolute;
  left: 20px;
  top: 98px;
}

.auto-discard {
  position: absolute;
  left: 278px;
  top: 448px;
}
</style>
