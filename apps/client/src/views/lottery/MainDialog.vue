<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onUnmounted, ref } from 'vue';
import { assets } from '../../assets/registry';
import { treasureItems, type TreasureItem } from '../../game/goods';
import {
  findWinItemIndex,
  flattenGoods,
  LOTTERY_TOTAL_GOODS,
  lotteryItemImage,
  lotteryWinFailText,
  parseAutoGetReward,
  parseLotteryRound,
  parseWinReply,
  type LotteryGood,
  type LotteryRound,
} from '../../game/lottery';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import { vTip } from '../../ui/tooltip';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import TreasureGetDialog from '../goods/TreasureGetDialog.vue';

/**
 * Lottery/MainDialog (514x504): the 幸运宝盒 wheel. `startLottery` spins (the GlowTween cadence of
 * onTimer: step every 10/5/3/5/10/15 ticks of a 10 ms timer), `restart` rerolls once per round,
 * and the win lands in the targetGoods frame (or a TreasureGetDialog through autoGetReward). The
 * original onCreate's `getGoods` call is not whitelisted (command_exception in the original too),
 * so the wheel fills from getLotteryReward / autoGetReward instead. The top-bar entry replaces
 * the original's broken `showNewLotteryDialog` call.
 */
const game = useGame();

const round = ref<LotteryRound | null>(null);
const goods = ref<LotteryGood[]>([]);
const todayCount = ref(0);
const restartCount = ref(0);
const win = ref<{ winType: number; winId: number; winCnt: number } | null>(null);
/** The centre frame shows the pending win (`targetGoods`). */
const target = ref<LotteryGood | null>(null);
const treasure = ref<TreasureItem[] | null>(null);

/** `startBtn.styleName`: ready / disabled while spinning / claim the pending win. */
const startStyle = ref<'LotteryStart' | 'LotteryStartDisable' | 'LotteryGet'>(
  'LotteryStartDisable',
);
const restartEnabled = ref(false);

const glowIndex = ref(-1);

const spinTimer = ref<ReturnType<typeof setInterval> | undefined>(undefined);
/** `mLoop` / `mInterval` / `mElapseTime` of the original. */
const spin = ref({ loop: 0, interval: 0, elapse: 0 });

const wheelSlots = computed(() => {
  const positions = [
    { left: 75.5, top: 1 },
    { right: 76, top: 1 },
    { right: 1, top: 76 },
    { right: 1, top: 175.5 },
    { right: 76, bottom: 2 },
    { left: 76, bottom: 1.5 },
    { left: 1, top: 175.5 },
    { left: 1, top: 76 },
  ];
  return goods.value.slice(0, LOTTERY_TOTAL_GOODS).map((good, i) => ({
    good,
    pos: positions[i]!,
    image: assets.url(lotteryItemImage(good)),
    count: String(good.count ?? ''),
    tip: String(good.description ?? good.name ?? ''),
  }));
});

const targetImage = computed(() => {
  const path = lotteryItemImage(target.value);
  return path ? assets.url(path) : '';
});

function send(command: string, args: CommandArg[] = []): void {
  game.sendGlobalCommand('lottery', command, args);
}

/** `MainDialog.newRound` (AS3 975-1025): fill the wheel from a parsed round. */
function applyRound(parsed: LotteryRound): void {
  round.value = parsed;
  goods.value = flattenGoods(parsed);
  todayCount.value = parsed.todayCount;
  restartCount.value = parsed.restartCount;
  win.value = { winType: parsed.winType, winId: parsed.winId, winCnt: parsed.winCnt };
  target.value = null;
  glowIndex.value = -1;
  if (parsed.winType !== -1) {
    const index = findWinItemIndex(goods.value, parsed.winId, parsed.winCnt);
    if (index >= 0) {
      target.value = goods.value[index] ?? null;
      if (parsed.restartCount === 0) startStyle.value = 'LotteryGet';
      // `enableRestartBtn`: only the first round may 重开.
      restartEnabled.value = parsed.restartCount === 0;
      if (parsed.restartCount >= 1) send('autoGetReward');
      return;
    }
  }
  startStyle.value = 'LotteryStart';
  restartEnabled.value = false;
}

/** `MainDialog.startTimer`: clear the frame and start the 10 ms spin timer. */
function startTimer(winId: number, winCnt: number): void {
  startStyle.value = 'LotteryStartDisable';
  target.value = null;
  spin.value = { loop: 0, interval: 0, elapse: 0 };
  const winIndex = findWinItemIndex(goods.value, winId, winCnt);
  if (winIndex < 0) {
    void showAlert(i18n('Lottery_Abnormal'));
    return;
  }
  spinTimer.value = setInterval(() => onSpinTick(winIndex), 10);
}

/** `MainDialog.onTimer` (AS3 884-935): the slow-down cadence of the GlowTween steps. */
function onSpinTick(winIndex: number): void {
  const s = spin.value;
  const period =
    s.elapse <= 30
      ? 10
      : s.elapse <= 60
        ? 5
        : s.elapse <= 90
          ? 3
          : s.elapse <= 120
            ? 5
            : s.elapse <= 150
              ? 10
              : 15;
  if (s.interval % period === 0) {
    glowStep(winIndex);
  }
  s.interval += 1;
  s.elapse += 1;
}

/** `MainDialog.glowTween` (AS3 1042-1081): advance the lit slot; land on the win. */
function glowStep(winIndex: number): void {
  if (spin.value.loop === winIndex) {
    clearInterval(spinTimer.value);
    spinTimer.value = undefined;
    glowIndex.value = winIndex;
    target.value = goods.value[winIndex] ?? null;
    if (restartCount.value === 0) startStyle.value = 'LotteryGet';
    if (restartCount.value === 0) restartEnabled.value = true;
    return;
  }
  glowIndex.value = spin.value.loop;
  spin.value.loop = (spin.value.loop + 1) % LOTTERY_TOTAL_GOODS;
}

/** `MainDialog.start` (AS3 629-652). */
function onStart(): void {
  if (startStyle.value === 'LotteryStartDisable') return;
  if (startStyle.value === 'LotteryGet') {
    restartEnabled.value = false;
    restartCount.value = 2;
    send('getLotteryReward');
    return;
  }
  if (game.user.nobilityPos < 1) {
    void showAlert(i18n('Lottery_nobilityLimit'));
    return;
  }
  startStyle.value = 'LotteryStartDisable';
  send('startLottery');
}

/** `MainDialog.restart` (AS3 465-484). */
function onRestart(): void {
  if (!restartEnabled.value || restartCount.value >= 1) return;
  if (game.user.nobilityPos < 1) {
    void showAlert(i18n('Lottery_nobilityLimit'));
    return;
  }
  restartCount.value += 1;
  startStyle.value = 'LotteryStartDisable';
  restartEnabled.value = false;
  send('restart', [win.value?.winId ?? 0, win.value?.winType ?? -1]);
}

/** The lottery replies (`MainDialog.onCommand`, AS3 653-716). */
const unregister = game.addGlobalReceiver('lottery', (command, data) => {
  if (command === 'getLotteryReward') {
    // `Global.app.alert(Lottery_GetWin)` + a fresh round in the same reply.
    void showAlert(i18n('Lottery_GetWin'));
    applyRound(parseLotteryRound(data));
  } else if (command === 'autoGetReward') {
    const parsed = parseAutoGetReward(data);
    treasure.value = treasureItems([{ ...parsed.win, gtype: parsed.gtype }]);
    startStyle.value = 'LotteryStart';
    applyRound(parsed.round);
  } else if (command === 'startLottery' || command === 'restart') {
    const reply = parseWinReply(data);
    if (reply.todayCount !== null) todayCount.value = reply.todayCount;
    win.value = { winType: reply.winType, winId: reply.winId, winCnt: reply.winCnt };
    if (reply.winType === -1) {
      const text = lotteryWinFailText(reply.winId);
      if (text) void showAlert(text);
      startStyle.value = 'LotteryStart';
    } else {
      startTimer(reply.winId, reply.winCnt);
    }
  }
});

onUnmounted(() => {
  unregister();
  if (spinTimer.value) clearInterval(spinTimer.value);
});
</script>

<template>
  <div class="lottery-dialog">
    <FxCanvas :x="162" :y="48" :w="179" :h="36" style-name="LotteryTitle" />
    <FxButton :right="11" :y="69" style-name="LotteryClose" @click="game.closeDialog()" />
    <FxCanvas :x="11" :y="64" :w="496" :h="403" style-name="LotteryBG">
      <FxCanvas :x="25" :y="50" :w="298" :h="300" style-name="TurnTable">
        <div
          v-for="(slot, i) in wheelSlots"
          :key="i"
          class="slot"
          :class="{ glow: glowIndex === i }"
          :style="slot.pos"
        >
          <img v-tip="slot.tip" class="pic" :src="slot.image" alt="" draggable="false" />
          <span class="count">{{ slot.count }}</span>
        </div>
        <div class="target">
          <img v-if="targetImage" :src="targetImage" alt="" draggable="false" />
        </div>
        <FxButton :x="93" :y="176" :style-name="startStyle" @click="onStart" />
      </FxCanvas>
      <FxCanvas :x="348" :y="50" :w="123" :h="212" style-name="LotteryDes">
        <FxText :x="5" :y="25" :w="118" :h="91" :text="i18n('Lottery_Des')" />
        <FxLabel :x="5" :y="112" style-name="LabelText" :text="i18n('Lottery_PlayCount')" />
        <FxLabel :x="65" :y="112" :w="55" style-name="LabelText" :text="String(todayCount)" />
        <FxText :x="5" :y="164" :w="118" :h="67" :text="i18n('Lottery_Des2')" />
      </FxCanvas>
      <FxButton
        :right="22"
        :y="282"
        :style-name="restartEnabled ? 'LotteryReStart' : 'LotteryReStartDisable'"
        @click="onRestart"
      />
    </FxCanvas>
    <TreasureGetDialog v-if="treasure" :items="treasure" @close="treasure = null" />
  </div>
</template>

<style scoped>
.lottery-dialog {
  /* MainDialog x=90 y=0 of the dialog layer. */
  position: relative;
  margin-left: 90px;
  width: 514px;
  height: 504px;
}

.slot {
  position: absolute;
  width: 48px;
  height: 48px;
}

.slot .pic {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 44px;
  height: 44px;
}

.slot .count {
  position: absolute;
  right: 2px;
  bottom: 0;
  color: #fff;
  font-size: 12px;
  text-shadow: 1px 1px 0 #000;
}

/* The GlowTween highlight (color 0xFFFF00 blink) of the original. */
.slot.glow {
  filter: drop-shadow(0 0 6px #ff0);
}

.target {
  position: absolute;
  left: 116px;
  top: 97px;
  width: 64px;
  height: 64px;
}

.target img {
  width: 64px;
  height: 64px;
}
</style>
