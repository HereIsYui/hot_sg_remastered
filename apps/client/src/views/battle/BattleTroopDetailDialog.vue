<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { parseSoldierPairs } from '../../game/battlefield';
import { armBuyAgain } from '../../game/battlefieldBuyAgain';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleTroopDetailDialog: the 军队详情 card of `getBattleTroopDetail [troopid]` — lord,
 * camp, hero, level, the soldiers table, the state / target / remaining / arrival lines and the
 * troop's item. 加速行军 confirms `Battle_BattleTroopDetailDialogSrc_1` and sends `fasterArmy`
 * (one 急行军令, gid 136); 调遣援军 opens the CallArmyDialog; 召回军队 confirms
 * `Battle_BattlePanelSrc_22` and sends `callBackToField`.
 */
const props = defineProps<{
  info: Record<string, unknown>;
}>();
const emit = defineEmits<{ close: []; callArmy: []; back: [troopid: number] }>();

const game = useGame();

const heroinfo = computed(() => (props.info.heroinfo ?? {}) as Record<string, unknown>);
const soldiers = computed(() => parseSoldierPairs(String(props.info.soldiers ?? '')));

const stateText = computed(() => String(props.info.state ?? ''));
const targetCityName = computed(() => String(props.info.targetcityname ?? ''));
const marching = computed(() => {
  // the reader blanks pathtime/endtime for the non-marching states
  return String(props.info.pathtime ?? '--') !== '--';
});
const leftTimeStr = ref('');
const arrivalStr = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

function refresh(): void {
  const endtime = Number(props.info.endtime ?? 0);
  const s = Math.max(0, Math.trunc(endtime - serverTime()));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  leftTimeStr.value = `${h > 0 ? h : '00'}${i18n('_Utils_5')}${pad(m)}${i18n('_Utils_6')}${pad(s % 60)}${i18n('_Utils_7')}`;
  const d = new Date(endtime * 1000);
  arrivalStr.value = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
refresh();
timer = setInterval(refresh, 1000);
onUnmounted(() => clearInterval(timer));

/** `onFasterArmy`: confirm then `fasterArmy [troopid]` (the reply refreshes this card). */
async function onFaster(): Promise<void> {
  const answer = await showAlert(i18n('Battle_BattleTroopDetailDialogSrc_1'), '', ['yes', 'no']);
  if (answer !== 'yes') return;
  // a missing 急行军令 (gid 136) opens the buy-and-use popup, which re-sends the command
  armBuyAgain([136], () => game.sendGlobalCommand('battle', 'fasterArmy', [Number(props.info.id)]));
  game.sendGlobalCommand('battle', 'fasterArmy', [Number(props.info.id)]);
}

const COLUMNS: { header: string; field: 'sid' | 'count'; width: number }[] = [
  { header: i18n('Battle_BattleTroopDetailDialog_6_1'), field: 'sid', width: 110 },
  { header: i18n('Battle_BattleTroopDetailDialog_7_1'), field: 'count', width: 110 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="131" :y="36" :w="420" :h="420" style-name="PanelGreyGreen">
      <FxCanvas :x="126" :y="10" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_BattleTroopDetailDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="16" :y="44" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="60"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopDetailDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="84" :y="44" :w="120" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="114"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(props.info.name ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="216" :y="44" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="60"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopDetailDialog_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="284" :y="44" :w="120" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="114"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(props.info.unionname ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="16" :y="78" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="60"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopDetailDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="84" :y="78" :w="120" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="114"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(heroinfo.name ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="216" :y="78" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="60"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopDetailDialog_5_1')"
        />
      </FxCanvas>
      <FxCanvas :x="284" :y="78" :w="120" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="114"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(heroinfo.level ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="16" :y="112" :w="388" :h="180" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="382"
          :h="174"
          :columns="COLUMNS"
          :rows="
            soldiers.map((p) => ({ sid: game.global.soldierNames[p.sid] ?? p.sid, count: p.count }))
          "
        />
      </FxCanvas>
      <FxLabel
        :x="16"
        :y="300"
        :w="390"
        :h="20"
        :text="`${i18n('Battle_BattleTroopDetailDialog_12_1')}${stateText}`"
      />
      <FxLabel
        :x="16"
        :y="322"
        :w="390"
        :h="20"
        :text="`${i18n('Battle_BattleTroopDetailDialog_13_1')}${targetCityName}`"
      />
      <FxLabel
        v-if="marching"
        :x="16"
        :y="344"
        :w="390"
        :h="20"
        :text="`${i18n('Battle_BattleTroopDetailDialog_14_1')}${leftTimeStr}`"
      />
      <FxLabel
        v-if="marching"
        :x="16"
        :y="366"
        :w="390"
        :h="20"
        :text="`${i18n('Battle_BattleTroopDetailDialog_15_1')}${arrivalStr}`"
      />
      <FxLabel
        :x="16"
        :y="388"
        :w="390"
        :h="20"
        :text="`${i18n('Battle_BattleTroopDetailDialog_16_1')}${props.info.thingname ?? '--'} ${props.info.thingcount ?? ''}`"
      />
      <FxButton
        v-if="marching"
        :x="16"
        :y="420"
        :w="80"
        :h="30"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleTroopDetailDialog_9_1')"
        @click="onFaster"
      />
      <FxButton
        :x="106"
        :y="420"
        :w="80"
        :h="30"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleTroopDetailDialog_11_1')"
        @click="emit('callArmy')"
      />
      <FxButton
        :x="196"
        :y="420"
        :w="80"
        :h="30"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleTroopDetailDialog_10_1')"
        @click="emit('back', Number(props.info.id))"
      />
      <FxButton
        :x="340"
        :y="420"
        :w="65"
        :h="30"
        :label="i18n('Battle_BattleTroopDetailDialog_8_1')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
