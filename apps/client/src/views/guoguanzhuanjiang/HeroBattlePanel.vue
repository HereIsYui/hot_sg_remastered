<script setup lang="ts">
import { computed, ref } from 'vue';
import { battleRewards, type PkBlow, type PkBattle } from '../../game/campaign-pk';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import BattleRewardPanel from './BattleRewardPanel.vue';

/**
 * GuoGuanZhanJiang.HeroBattlePanel: the 3v3 round playback of the standalone PK engine (shared
 * with the arena). The original animates every blow with swf effects; the remade panel steps
 * through the rounds on a timer, showing each blow as the original's report line
 * (writeReportToText, AS3:1196) and the fighters' remaining blood, then offers the result panel.
 */
const props = defineProps<{ battle: PkBattle | null; names?: Record<number, string> }>();
const emit = defineEmits<{ finish: []; quit: [] }>();

const roundIndex = ref(-1);
const showResult = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const rounds = computed<PkBlow[][]>(() => props.battle?.report ?? []);
const curRound = computed<PkBlow[]>(() => rounds.value[roundIndex.value] ?? []);

/** `getHeroName`: the fighter's name over its hid, the hid itself as the fallback. */
const heroName = (hid: number): string => String(props.names?.[hid] ?? hid);

/** `getEffectName(1, n)`: the attacker effect (1 暴击, 2 破击). */
const attackEffect = (n: number): string =>
  n === 1
    ? i18n('Hero_Battle_Dialog_battle_report_effect_1')
    : n === 2
      ? i18n('Hero_Battle_Dialog_battle_report_effect_2')
      : '';

/** `getEffectName(0, n)`: the defender effect (1 格挡, 2 闪避). */
const resistEffect = (n: number): string =>
  n === 1
    ? i18n('Hero_Battle_Dialog_battle_report_effect_3')
    : n === 2
      ? i18n('Hero_Battle_Dialog_battle_report_effect_4')
      : '';

/** `writeReportToText`: one blow's html — attacker hits, defender keeps `blood` hp. */
function blowText(b: PkBlow): string {
  const attacker = `<font color='#0099CC'>${heroName(b.attackhid)}</font>`;
  const defender = `<font color='#FFCC33'>${heroName(b.resisthid)}</font>`;
  const atk = attackEffect(b.attack);
  const res = resistEffect(b.resist);
  const damage = `<font color='#e88817'>${b.damage}</font>`;
  let line = attacker + i18n('Hero_Battle_Dialog_battle_report_attack') + defender;
  if (atk && res) {
    line +=
      i18n('Hero_Battle_Dialog_battle_report_3') +
      `<font color='#EC0300'>${atk}</font>，` +
      `${defender}<font color='#009933'>${res}</font>`;
  } else if (atk) {
    line += i18n('Hero_Battle_Dialog_battle_report_3') + `<font color='#EC0300'>${atk}</font>`;
  } else if (res) {
    line += `，${defender}<font color='#009933'>${res}</font>`;
  }
  return `${line}${i18n('Hero_Battle_Dialog_battle_report_1')}${damage}${i18n('Hero_Battle_Dialog_battle_report_2')}`;
}

/** `HeroBattlePanel.initData`: the playback restarts from round 0. */
function start(): void {
  roundIndex.value = -1;
  showResult.value = false;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (roundIndex.value + 1 >= rounds.value.length) {
      stopTimer();
      roundIndex.value = rounds.value.length - 1;
      showResult.value = true;
      return;
    }
    roundIndex.value++;
  }, 700);
}
function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
start();

const win = computed(() => props.battle?.winer === 1);
const rewards = computed(() => (win.value ? battleRewards(props.battle?.reward) : []));
</script>

<template>
  <FxCanvas :w="733" :h="525" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.75 }">
    <FxImage source="images/hero_battle_bg.jpg" />
    <FxLabel
      :x="0"
      :y="8"
      :w="733"
      :h="20"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center' }"
      :text="i18n('Hero_Battle_Dialog_title')"
    />
    <FxLabel
      :x="0"
      :y="34"
      :w="733"
      :h="20"
      :fx="{ textAlign: 'center', color: 16777215 }"
      :text="`${i18n('Hero_Battle_Dialog_battle_panel_1')}${Math.max(1, roundIndex + 1)}/${props.battle?.totalNum ?? 0}`"
    />
    <FxCanvas :x="33" :y="70" :w="667" :h="90" style-name="BoardListUp">
      <FxText
        :x="8"
        :y="6"
        :w="650"
        :h="78"
        :html="curRound.map(blowText).join('<br />')"
        :fx="{ color: 16777215 }"
      />
    </FxCanvas>
    <FxCanvas :x="33" :y="168" :w="667" :h="270" style-name="BoardListUp">
      <FxText
        :x="8"
        :y="6"
        :w="650"
        :h="258"
        scroll
        :html="
          rounds
            .slice(0, roundIndex + 1)
            .map(
              (round, i) =>
                `<p align='center'><b>${i18n('Hero_Battle_Dialog_battle_report_round_1')}${i + 1}${i18n('Hero_Battle_Dialog_battle_report_round_2')}</b></p>` +
                round.map(blowText).join('<br />'),
            )
            .join('<br />')
        "
        :fx="{ color: 16777215 }"
      />
    </FxCanvas>
    <FxButton :x="640" :y="470" :w="71" style-name="Close" @click="emit('quit')" />
    <BattleRewardPanel
      v-if="showResult"
      :win="win"
      :rewards="rewards"
      @confirm="emit('finish')"
      @close="emit('quit')"
    />
  </FxCanvas>
</template>
