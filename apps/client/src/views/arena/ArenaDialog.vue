<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  GOTO_RANKS,
  npcPosOf,
  npcPosText,
  ownBattleHtml,
  parseArenaBase,
  parseArenaInit,
  parseBattleHeroInfos,
  parseGotoRank,
  parseRankList,
  rewardTip,
  rowColor,
  winRecordHtml,
  type ArenaRankRow,
} from '../../game/arena';
import { parsePkBattle } from '../../game/campaign-pk';
import { treasureItems } from '../../game/goods';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import TreasureGetDialog from '../goods/TreasureGetDialog.vue';
import AssembleHeroPanel from './AssembleHeroPanel.vue';
import HeroBattlePanel from '../guoguanzhuanjiang/HeroBattlePanel.vue';
import RankRewardDialog from './RankRewardDialog.vue';

/**
 * Arena.ArenaDialog (`showArenaDialog`, the 功能按钮区 将领配置/竞技场 button): the arena. The
 * 竞技挑战 / 首榜挑战 lists load via loadBeforeUser10 / loadRankBefore10, challenges send
 * `startArenaChallenge [targetUid, isSkip]` and replay through the shared HeroBattlePanel; the own
 * lineup is configured in AssembleHeroPanel (`holdBattleHeroInfo`), the daily rank rewards in
 * RankRewardDialog. 跨服挑战 (CrossArenaDialog) is not ported — the original shows
 * Arena_Battle_tip_1 when its server is absent, and the tab keeps that alert.
 */
const game = useGame();
const user = useUserStore();

const TABS = [
  { index: 0, label: 'Arena_Battle_title_1' },
  { index: 1, label: 'Arena_Battle_title_2' },
  { index: 2, label: 'Arena_Battle_title_3' },
  { index: 3, label: 'Arena_Battle_title_4' },
  { index: 4, label: 'Arena_Battle_title_5' },
];

const tab = ref(0);
const base = ref<ReturnType<typeof parseArenaBase>>(null);
const ownHtml = ref('');
const winHtml = ref('');
const rankRows = ref<ArenaRankRow[]>([]);
const npcPos = ref(0);
const gotoRank = ref(0);
const refreshCooling = ref(0);
const leaveTime = ref(0);
const showAssemble = ref(false);
const showRankReward = ref(false);
const battle = ref<ReturnType<typeof parsePkBattle>>(null);
const battleNames = ref<Record<number, string>>({});
const treasure = ref<ReturnType<typeof treasureItems>>([]);

const COLUMNS = [
  { header: 'Arena_Battle_3_1', width: 50 },
  { header: 'Arena_Battle_3_2', width: 110 },
  { header: 'Arena_Battle_3_8', width: 60 },
  { header: 'Arena_Battle_3_4', width: 90 },
  { header: 'Arena_Battle_3_3', width: 130 },
  { header: 'Arena_Battle_3_7', width: 50 },
];

/** `loadArenaBattleInitDataFunc`. */
onMounted(() => game.sendGlobalCommand('ArenaBattle', 'loadArenaBattleInitData'));

/** `reduceTime`: the challenge-cooling and refresh-cooling tick down per second. */
const unregisterTick = setInterval(() => {
  if (leaveTime.value > 0) leaveTime.value--;
  if (refreshCooling.value > 0) refreshCooling.value--;
}, 1000);
onUnmounted(() => clearInterval(unregisterTick));

/** `dealWithOwnBattleInfo` / `dealWithWinRecrod`: the html text of the two textareas. */
function applyRecords(own: unknown, wins: unknown): void {
  ownHtml.value = ownBattleHtml(own, user.uid, i18n);
  winHtml.value = winRecordHtml(wins, i18n);
}

const unregister = game.addGlobalReceiver('ArenaBattle', (command, data) => {
  if (command === 'loadArenaBattleInitData') {
    const init = parseArenaInit(data);
    if (!init.base) return;
    base.value = init.base;
    leaveTime.value = init.base.leavingtime;
    applyRecords(init.ownRecords, init.winRecords);
    npcPos.value = npcPosOf(init.rankList);
    rankRows.value = parseRankList(init.rankList, user.uid);
    showAssemble.value = true;
  } else if (command === 'loadBeforeUser10' || command === 'loadRankBefore10') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      npcPos.value = npcPosOf(d[0]);
      rankRows.value = parseRankList(d[0], user.uid);
    }
  } else if (command === 'refreshAssembleRankInfo') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      applyRecords(d[0], d[1]);
      npcPos.value = npcPosOf(d[2]);
      rankRows.value = parseRankList(d[2], user.uid);
    }
    refreshCooling.value = 6;
  } else if (command === 'gotoSelectedRank') {
    const parsed = parseGotoRank(data);
    if (parsed.base) base.value = parseArenaBase(parsed.base);
    rankRows.value = parseRankList(parsed.list, user.uid);
  } else if (command === 'startArenaChallenge') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    const names: Record<number, string> = {};
    for (const hero of parseBattleHeroInfos(d.shift())) {
      names[Number(hero.hid)] = String(hero.name ?? '');
    }
    battleNames.value = names;
    battle.value = parsePkBattle(d);
  } else if (command === 'clearArenaCoolTime') {
    if ((Array.isArray(data) ? data.length : 0) > 0) leaveTime.value = 0;
  } else if (command === 'getArenaReward') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    const sub = Array.isArray(d[0]) ? [...(d[0] as unknown[])] : [];
    if (Number(sub[0]) === 0) {
      void showAlert(`${i18n('Arena_Battle_reward_1_15')}${String(sub[1] ?? '')}`);
    } else if (Number(sub[0]) === 1) {
      // the item reward surfaces through the shared treasure popup (TreasureGetDialog.loadGoods)
      treasure.value = treasureItems(sub[1]);
    }
    game.sendGlobalCommand('ArenaBattle', 'loadBeforeUser10');
  }
});
onUnmounted(unregister);

/** `switchPanel`. */
function switchTab(index: number): void {
  tab.value = index;
  if (index === 0) game.sendGlobalCommand('ArenaBattle', 'loadBeforeUser10');
  else if (index === 1) game.sendGlobalCommand('ArenaBattle', 'loadRankBefore10');
  else if (index === 2)
    void showAlert(i18n('Arena_Battle_tip_1')); // CrossArenaDialog 不移植
  else if (index === 4) showRankReward.value = true;
}

/** `refreshRank`. */
function refreshRank(): void {
  if (refreshCooling.value > 0) return;
  game.sendGlobalCommand('ArenaBattle', 'refreshAssembleRankInfo', [tab.value === 1 ? 1 : 0]);
}

/** `speedCoolTime` → `clearArenaCoolTime` (the 元宝 cost is charged server-side). */
function clearCooling(): void {
  game.sendGlobalCommand('ArenaBattle', 'clearArenaCoolTime');
}

/** `selectGoToRank`: jumps by the combo's rank window. */
function onGotoRank(index: number): void {
  const goto = GOTO_RANKS[index]?.goto ?? 0;
  if (goto > 0) game.sendGlobalCommand('ArenaBattle', 'gotoSelectedRank', [goto]);
}

/** `startChallenge` + `sendArenaBattleCommand` (AS3:818/1225): `[targetUid, isSkip]`, the flag
 *  set when the challenge comes from the 首榜挑战 tab (its own confirm). */
function challenge(row: ArenaRankRow): void {
  game.sendGlobalCommand('ArenaBattle', 'startArenaChallenge', [
    Number(row.userid),
    tab.value === 1,
  ]);
}

/** `getChallengReward [rewardUid]`: only the own row's claim. */
function claimReward(row: ArenaRankRow): void {
  if (Number(row.userid) !== user.uid) {
    void showAlert(i18n('Arena_Battle_reward_1_16'));
    return;
  }
  game.sendGlobalCommand('ArenaBattle', 'getArenaReward', [user.uid]);
}

const rewardText = (row: ArenaRankRow): string => rewardTip(row, user.uid, i18n);
const npcText = computed(() => npcPosText(npcPos.value, i18n));
const gotoLabels = computed(() => GOTO_RANKS.map((r) => i18n(r.label)));
const refreshLabel = computed(() =>
  refreshCooling.value > 0
    ? `${i18n('Arena_Battle_6_4')}(${refreshCooling.value})`
    : i18n('Arena_Battle_6_4'),
);
const endtimeText = computed(() => (leaveTime.value > 0 ? String(leaveTime.value) : ''));
</script>

<template>
  <FxCanvas :w="733" :h="525" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="240" :y="12" source="images/title.png" />
    <FxLabel
      :y="17"
      :w="733"
      :h="18"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Arena_Battle_first_title')"
    />
    <FxButton
      v-for="t in TABS"
      :key="t.index"
      :x="232 + t.index * 90 + (t.index >= 3 ? 14 : 0) + (t.index === 4 ? 7 : 0)"
      :y="63"
      :w="t.index === 4 ? 102 : 85"
      :h="40"
      :style-name="t.index >= 3 ? 'ButtonYellow' : 'ButtonRed'"
      :selected="tab === t.index"
      :label="i18n(t.label)"
      @click="switchTab(t.index)"
    />
    <!-- left info panel -->
    <FxCanvas :x="20" :y="67" :w="207" :h="114" style-name="BoardListDown">
      <FxLabel
        :x="3"
        :y="3"
        :w="99"
        :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
        :text="i18n('Arena_Battle_2_1')"
      />
      <FxLabel
        :x="100"
        :y="3"
        :w="84"
        :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
        :text="String(base?.rank ?? '')"
      />
      <FxLabel
        :x="3"
        :y="25"
        :w="99"
        :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
        :text="i18n('Arena_Battle_2_2')"
      />
      <FxLabel
        :x="100"
        :y="25"
        :w="84"
        :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
        :text="base?.countStr ?? ''"
      />
      <FxLabel
        :x="3"
        :y="47"
        :w="99"
        :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
        :text="i18n('Arena_Battle_2_3')"
      />
      <FxLabel
        :x="100"
        :y="47"
        :w="84"
        :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
        :text="endtimeText"
      />
      <FxLabel
        v-if="leaveTime > 0"
        :x="178"
        :y="47"
        :tip="i18n('Arena_Battle_4_2')"
        :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
        hand
        text=">>"
        @click="clearCooling"
      />
      <FxLabel
        :x="3"
        :y="69"
        :w="99"
        :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
        :text="i18n('Arena_Battle_2_4')"
      />
      <FxLabel
        :x="100"
        :y="69"
        :w="84"
        :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
        :text="String(base?.maxrank ?? '')"
      />
      <FxLabel
        :x="3"
        :y="91"
        :w="99"
        :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
        :text="i18n('Arena_Battle_2_5')"
      />
      <FxLabel
        :x="100"
        :y="91"
        :w="84"
        :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
        :text="String(base?.maxwin ?? '')"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="189" :w="207" :h="155" style-name="BoardListDown">
      <FxText
        :left="5"
        :top="3"
        :right="5"
        :bottom="3"
        scroll
        :html="winHtml"
        :fx="{ fontSize: 12, color: 16777215, paddingLeft: 5, paddingTop: 3 }"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="353" :w="207" :h="160" style-name="BoardListDown">
      <FxText
        :left="5"
        :top="3"
        :right="5"
        :bottom="3"
        scroll
        :html="ownHtml"
        :fx="{ fontSize: 13, color: 16777215, paddingLeft: 5, paddingTop: 3 }"
      />
    </FxCanvas>
    <!-- rank list -->
    <FxCanvas :x="233" :y="110" :w="490" :h="370" style-name="BoardListDown">
      <FxCanvas :x="0" :y="0" :w="490" :h="24" :fx="{ color: 16247152 }">
        <FxLabel
          v-for="(col, i) in COLUMNS"
          :key="col.header"
          :x="COLUMNS.slice(0, i).reduce((sum, c) => sum + c.width, 0) + 6"
          :y="4"
          :w="col.width"
          :fx="{ fontSize: 13 }"
          :text="i18n(col.header)"
        />
      </FxCanvas>
      <FxCanvas
        v-for="(row, i) in rankRows"
        :key="`${row.userid}-${i}`"
        :x="0"
        :y="24 + i * 34"
        :w="490"
        :h="34"
        :fx="{ color: rowColor(Number(row.userid), user.uid) }"
      >
        <FxLabel :x="6" :y="8" :w="46" :fx="{ fontSize: 13 }" :text="String(row.rank ?? '')" />
        <FxLabel
          :x="56"
          :y="8"
          :w="110"
          :fx="{ fontSize: 13 }"
          :text="String(row.username ?? '')"
        />
        <FxLabel
          :x="176"
          :y="8"
          :w="60"
          :fx="{ fontSize: 13 }"
          :text="String(row.lefttimeStr ?? '')"
        />
        <FxLabel
          :x="240"
          :y="8"
          :w="90"
          :fx="{ fontSize: 13 }"
          :text="String(row.kingLevel ?? '')"
        />
        <FxLabel :x="334" :y="8" :w="94" :fx="{ fontSize: 12 }" :text="rewardText(row)" />
        <FxButton
          v-if="row.butChallengeIsShow"
          :x="434"
          :y="5"
          :w="50"
          :h="24"
          style-name="ButtonYellow"
          :fx="{ fontSize: 12 }"
          :label="i18n('Arena_Battle_3_5')"
          @click="challenge(row)"
        />
        <FxButton
          v-if="row.butRewardIsShow"
          :x="434"
          :y="5"
          :w="50"
          :h="24"
          style-name="ButtonYellow"
          :fx="{ fontSize: 12 }"
          :label="i18n('Arena_Battle_3_6')"
          @click="claimReward(row)"
        />
      </FxCanvas>
    </FxCanvas>
    <FxLabel
      v-if="npcText"
      :x="20"
      :y="41"
      :w="226"
      :h="25"
      :fx="{ fontSize: 13, color: 16547361, fontWeight: 'bold', paddingTop: 5 }"
      :text="npcText"
    />
    <FxButton
      :x="233"
      :y="479"
      :w="100"
      :h="40"
      style-name="ButtonYellow"
      :label="refreshLabel"
      :enabled="refreshCooling === 0"
      @click="refreshRank"
    />
    <FxLabel
      :x="351"
      :y="488"
      :w="88"
      :fx="{ color: 16247152, fontSize: 13, textAlign: 'right' }"
      :text="i18n('Arena_Battle_7_7')"
    />
    <FxComboBox
      v-model="gotoRank"
      :x="432"
      :y="488"
      :w="132"
      :items="gotoLabels"
      @change="onGotoRank"
    />
    <FxButton :x="661" :y="481" style-name="Close" @click="game.closeDialog()" />

    <AssembleHeroPanel v-if="showAssemble" @close="showAssemble = false" />
    <RankRewardDialog v-if="showRankReward" @close="showRankReward = false" />
    <TreasureGetDialog v-if="treasure.length > 0" :items="treasure" @close="treasure = []" />
    <HeroBattlePanel
      v-if="battle"
      :battle="battle"
      :names="battleNames"
      @finish="battle = null"
      @quit="battle = null"
    />
  </FxCanvas>
</template>
