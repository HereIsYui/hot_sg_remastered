<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { i18n } from '../../i18n';
import { serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import { parseTrickBuffer, type TrickBufferRow } from '../../game/trick';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Buffer/TrickBufferDialog (296x312): the 计谋状态 pop-up of the top bar's trick button. It asks
 * `getTrickBuffer [cid]` — the original sent it under the `buffer` action, the port hosts it in
 * the `trick` module — and reformats the remaining times every second; a lapsed buffer triggers a
 * refresh after five seconds (`onTimer`, AS3 409-437).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();

/** The parsed rows keep their raw endtime so the countdown follows the server clock. */
const rows = ref<(TrickBufferRow & { endtime: number })[]>([]);
const timer = ref<ReturnType<typeof setInterval> | undefined>(undefined);
/** `mWaitTime`: seconds until the refresh after a row lapsed. */
const waitTime = ref(0);

const columns = [
  { header: i18n('Buffer_TrickBufferDialog_2_1'), field: 'name' as const, width: 110 },
  { header: i18n('Buffer_TrickBufferDialog_3_1'), field: 'leftTime' as const, width: 140 },
];

/** `TrickBufferDialog.showBufferDetail` (+ the onCommand getTrickBuffer branch). */
function reload(): void {
  game.sendGlobalCommand('trick', 'getTrickBuffer', [game.city.cid]);
}

const unregister = game.addGlobalReceiver('trick', (command, data) => {
  if (command === 'getTrickBuffer') {
    rows.value = parseTrickBuffer(data, i18n).map((row) => ({
      ...row,
      endtime: Number(row.endtime ?? 0),
    }));
  }
});

onMounted(() => {
  reload();
  timer.value = setInterval(onTimer, 1000);
});

onUnmounted(() => {
  clearInterval(timer.value);
  unregister();
});

/** `TrickBufferDialog.onTimer`: tick the countdowns, refresh five seconds after a lapse. */
function onTimer(): void {
  const now = serverTime();
  let lapsed = false;
  for (const row of rows.value) {
    row.time = row.endtime - now;
    if (row.time <= 0) lapsed = true;
  }
  if (lapsed) {
    if (waitTime.value > 0 && --waitTime.value <= 0) reload();
    else if (waitTime.value === 0) waitTime.value = 5;
  } else {
    waitTime.value = 0;
  }
}

const gridRows = computed(() =>
  rows.value.map((row) => ({
    name: row.name,
    leftTime: row.time > 0 ? timeLeftText(row.time, i18n) : row.leftTime,
  })),
);
</script>

<template>
  <FxCanvas :x="217" :y="50" :w="296" :h="312" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="64" :y="20" :w="168" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="2"
        :w="168"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Buffer_TrickBufferDialog_1_1')"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="62" :w="256" :h="174" style-name="BoardListDown">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="250"
        :h="168"
        :columns="columns"
        :rows="gridRows"
        :row-height="28"
      />
    </FxCanvas>
    <FxButton :x="211" :y="251" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
