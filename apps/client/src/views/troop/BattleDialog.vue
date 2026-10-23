<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import {
  battleFinished,
  battleResultLine,
  maxRound,
  parseBattleData,
  parseBattleReport,
  parseRoundHtml,
  type BattleData,
} from '../../game/battle';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * Troop.BattleDialog: the live 战斗 view, replacing the 暂未开放 that TroopDialog / TroopDetailDialog
 * showed. It opens on `getBattleData` (both sides' user / city / hero and the first rounds), then
 * polls `getBattleReport` for new rounds, appending each round's HTML until `sys_battle.state == 1`
 * when it writes the win / lose / draw line and stops. The player may order their own soldier
 * types with `setSoldierTactics` while the battle runs.
 */
const props = defineProps<{ battleid: number; userIsAttack: boolean }>();
const game = useGame();
const t = (n: number) => i18n(`Troop_BattleDialog_${n}_1`);
const str = (v: unknown) => (v == null ? '' : String(v));

const data = ref<BattleData | null>(null);
const html = ref('');
const lastRound = ref(0);
const finished = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;

const attackName = computed(() => str(data.value?.attackUser?.name));
const resistName = computed(() => str(data.value?.resistUser?.name));
const attackCity = computed(() => str(data.value?.attackCity?.name));
const resistCity = computed(() => str(data.value?.resistCity?.name));
const attackHero = computed(() => str(data.value?.attackHero?.name));
const resistHero = computed(() => str(data.value?.resistHero?.name));

/** Append the rounds newer than lastRound and, once finished, the result line. */
function appendRounds(
  rounds: { round: number; report: string }[],
  sysbattle: Record<string, unknown> | null,
): void {
  for (const r of rounds) {
    if (r.round > lastRound.value) {
      lastRound.value = r.round;
      html.value += parseRoundHtml(r.round, r.report);
    }
  }
  lastRound.value = Math.max(lastRound.value, maxRound(rounds));
  if (!finished.value && battleFinished(sysbattle)) {
    html.value += battleResultLine(sysbattle, props.userIsAttack);
    finished.value = true;
    stopPoll();
  }
}

function requestRounds(): void {
  if (finished.value) return;
  game.sendBattleCommand('getBattleReport', [props.battleid, lastRound.value]);
}

function startPoll(): void {
  stopPoll();
  if (!finished.value) poll = setInterval(requestRounds, 5000);
}

function stopPoll(): void {
  if (poll) clearInterval(poll);
  poll = undefined;
}

const unregister = game.addGlobalReceiver('troop', (command, payload) => {
  if (command === 'getBattleData') {
    const bd = parseBattleData(payload);
    data.value = bd;
    appendRounds(bd.report.rounds, bd.report.sysbattle);
    startPoll();
  } else if (command === 'getBattleReport') {
    const rep = parseBattleReport(payload);
    appendRounds(rep.rounds, rep.sysbattle);
  }
});

onMounted(() => game.sendBattleCommand('getBattleData', [props.battleid]));
onUnmounted(() => {
  stopPoll();
  unregister();
});
</script>

<template>
  <FxCanvas :x="27" :y="54" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="15" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="19"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="t(1) || '战斗'"
    />
    <FxButton
      :right="20"
      :top="12"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeBattle()"
    />

    <!-- both sides -->
    <FxCanvas :x="23" :y="50" :w="635" :h="70" style-name="BoardListUp">
      <FxLabel
        :x="16"
        :y="10"
        :w="300"
        :fx="{ color: 16711680, fontWeight: 'bold' }"
        :text="`${t(2) || '攻方'}：${attackName} ${attackCity}`"
      />
      <FxLabel :x="16" :y="38" :w="300" :fx="{ color: 15983262 }" :text="attackHero" />
      <FxLabel
        :x="330"
        :y="10"
        :w="290"
        :fx="{ color: 39423, fontWeight: 'bold', textAlign: 'right' }"
        :text="`${t(3) || '守方'}：${resistName} ${resistCity}`"
      />
      <FxLabel
        :x="330"
        :y="38"
        :w="290"
        :fx="{ color: 15983262, textAlign: 'right' }"
        :text="resistHero"
      />
    </FxCanvas>

    <!-- rounds (HTML) -->
    <FxCanvas :x="23" :y="128" :w="635" :h="300" style-name="BoardListDown">
      <FxText :x="6" :y="6" :w="623" :h="288" scroll :html="html" :fx="{ color: 15983262 }" />
    </FxCanvas>

    <FxLabel
      v-if="finished"
      :x="23"
      :y="438"
      :w="300"
      :h="30"
      :fx="{ color: 16776960, fontWeight: 'bold' }"
      :text="t(5) || '战斗已结束'"
    />
    <FxButton :x="505" :y="438" style-name="Return" @click="game.closeBattle()" />
  </FxCanvas>
</template>
