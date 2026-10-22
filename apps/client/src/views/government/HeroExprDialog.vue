<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import {
  ID_BUILDING_OFFICE,
  parseExprHeros,
  startableHeros,
  type ExprHero,
  type ExprType,
} from '../../game/heroExpr';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import BeginHeroExprDialog from './BeginHeroExprDialog.vue';

/**
 * Office.HeroExprDialog: lists the city's 历练-eligible heroes with their timers, and starts /
 * cancels / speeds an expr. Reached from the 官府; `param` round-trips the building position.
 */
const props = defineProps<{ param: number }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const now = ref(serverTime());
const heros = shallowRef<ExprHero[]>([]);
const types = shallowRef<ExprType[]>([]);
const showBegin = ref(false);
const showDesp = ref(false);

function send(cmd: string, args: CommandArg[]) {
  game.sendDialogCommand(cmd, ID_BUILDING_OFFICE, props.param, args);
}

const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === ID_BUILDING_OFFICE && p === props.param,
  onData(reply) {
    if (!Array.isArray(reply)) return;
    const parsed = parseExprHeros(reply);
    now.value = parsed.now;
    heros.value = parsed.heros;
    types.value = parsed.types;
  },
});

function reload() {
  send('getExprHeros', []);
}

/** `HeroExprDialog.getState` / `getExprLeftTime` / `getExprTime`: the display columns. */
const HERO_STATE = ['空闲', '', '', '', '', '', '', '', '', '', '历练中', '召回中'];
const rows = computed(() =>
  heros.value.map((h) => ({
    hero: h,
    heroname: h.heroname,
    exprname: h.exprname ?? '---',
    state: h.state === 10 || h.state === 11 ? (HERO_STATE[h.state] ?? '') : HERO_STATE[0],
    leftTimeStr: h.endtime == null ? '---' : timeLeftText(h.endtime - now.value, i18n),
    onTimeStr:
      h.state !== 10 || h.starttime == null ? '---' : timeLeftText(now.value - h.starttime, i18n),
  })),
);

const columns = [
  { header: i18n('Office_HeroExprDialog_3_1'), field: 'heroname' as const, width: 80 },
  { header: i18n('Office_HeroExprDialog_4_1'), field: 'exprname' as const, width: 80 },
  { header: i18n('Office_HeroExprDialog_5_1'), field: 'onTimeStr' as const, width: 120 },
  { header: i18n('Office_HeroExprDialog_6_1'), field: 'leftTimeStr' as const, width: 120 },
  { header: i18n('Office_HeroExprDialog_7_1'), field: 'state' as const, width: 80 },
];

const freeHeros = computed(() => startableHeros(heros.value));

function onBegin(args: [number, number, number, number, number]) {
  send('beginExprHero', args);
  showBegin.value = false;
  reload();
}

/** `cancelHeroExpr`: confirm, then end the expr early. */
async function onCancel(hero: ExprHero) {
  if ((await showAlert(i18n('Office_HeroExprDialog_15_1'), '', ['yes', 'no'])) !== 'yes') return;
  send('cancelHeroExpr', [hero.hid]);
  reload();
}

/** `fasterHeroExpr`: 通关文书 (state 10) or 急召令 (cancelled). */
async function onFaster(hero: ExprHero) {
  const key = hero.state === 10 ? 'Office_HeroExprDialog_16_1' : 'Office_HeroExprDialog_20_1';
  if ((await showAlert(i18n(key), '', ['yes', 'no'])) !== 'yes') return;
  send('fasterHeroExpr', [hero.hid]);
  reload();
}

/** `onTimer`: tick the countdowns and reload once something finishes. */
let needReload = false;
let timer: ReturnType<typeof setInterval> | undefined;
function onTimer() {
  now.value = serverTime();
  for (const h of heros.value) {
    if ((h.state === 10 || h.state === 11) && h.endtime != null && h.endtime - now.value <= 0) {
      needReload = true;
    }
  }
  if (needReload && !showBegin.value) {
    needReload = false;
    reload();
  }
}

onMounted(() => {
  reload();
  timer = setInterval(onTimer, 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  unregister();
});
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="246.5" :y="10" source="images/title.png" />
    <FxLabel
      :x="315"
      :y="13"
      :w="160"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Office_HeroExprDialog_1_1')"
    />
    <FxCanvas :x="10" :y="52" :w="662" :h="308" style-name="BoardListDown">
      <FxDataGrid
        :x="0"
        :y="0"
        :w="662"
        :h="308"
        :columns="columns"
        :rows="rows"
        :row-height="28"
      />
    </FxCanvas>

    <FxButton
      :x="359"
      :bottom="10"
      :w="101"
      :h="36"
      style-name="ButtonYellow"
      :label="i18n('heroexprdialog_new_8')"
      @click="showDesp = true"
    />
    <FxButton
      :x="468"
      :bottom="10"
      :w="100"
      :h="36"
      style-name="ButtonGreen"
      :label="i18n('Office_HeroExprDialog_9_1')"
      @click="showBegin = true"
    />
    <FxButton :x="587" :bottom="10" :w="65" :h="36" style-name="Close" @click="emit('close')" />

    <!-- Row action buttons: the selected hero drives 取消 / 加速. -->
    <template v-for="(r, i) in rows" :key="r.hero.hid">
      <FxButton
        v-if="r.hero.state === 10 || r.hero.state === 11"
        :x="560"
        :y="60 + i * 28"
        :w="48"
        :h="22"
        style-name="ButtonYellow"
        :label="i18n('Office_HeroExprDialog_18_1')"
        @click="onCancel(r.hero)"
      />
      <FxButton
        v-if="r.hero.state === 10 || r.hero.state === 11"
        :x="612"
        :y="60 + i * 28"
        :w="48"
        :h="22"
        style-name="ButtonGreen"
        :label="i18n('Office_HeroExprDialog_19_1')"
        @click="onFaster(r.hero)"
      />
    </template>

    <BeginHeroExprDialog
      v-if="showBegin"
      :heros="freeHeros"
      :types="types"
      @begin="onBegin"
      @close="showBegin = false"
    />

    <!-- `expdesp`: the 历练说明 overlay. -->
    <FxCanvas
      v-if="showDesp"
      :x="0"
      :y="0"
      :w="672"
      :h="482"
      :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }"
    >
      <FxCanvas :x="121" :y="73" :w="436" :h="327" style-name="PopupDialog">
        <FxCanvas :x="129.5" :y="10" :w="169" :h="24" style-name="PopupTitle">
          <FxLabel
            :x="4.5"
            :y="3"
            :w="160"
            style-name="PopupDialogTitle"
            :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
            :text="i18n('Office_HeroExprDialog_1_1')"
          />
        </FxCanvas>
        <FxCanvas :x="18" :y="54" :w="400" :h="217" style-name="BoardListDown">
          <FxText :x="0" :y="0" :w="400" :h="217" scroll :html="i18n('heroexprdialog_new_9')" />
        </FxCanvas>
        <FxButton :x="353" :y="277" style-name="Close" @click="showDesp = false" />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
