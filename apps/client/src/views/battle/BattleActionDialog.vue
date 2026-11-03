<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { parseSoldierPairs } from '../../game/battlefield';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleActionDialog: the 调遣 confirmation of `getInfoForBattleArmySend` — hero, level,
 * the soldiers table (`parseSoldier`), the target 据点 and the single-way march time; 确定 sends
 * `battleTroopDispatch [troopid, targetid, heroname, targetname]`.
 */
const props = defineProps<{ troop: Record<string, unknown> }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const troops = computed(() => parseSoldierPairs(String(props.troop.soldiers ?? '')));
const singleTime = computed(() => Number(props.troop.pathtime ?? 0));
const singleTimeStr = ref('');
const arrivalTimeStr = ref('');

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function refresh(): void {
  // `onTimer`: the single-way time and the arrival clock re-read every second
  const s = Math.max(0, Math.trunc(singleTime.value));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  singleTimeStr.value = `${h > 0 ? h : '00'}${i18n('_Utils_5')}${pad(m)}${i18n('_Utils_6')}${pad(s % 60)}${i18n('_Utils_7')}`;
  const d = new Date((serverTime() + singleTime.value) * 1000);
  arrivalTimeStr.value = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
refresh();
const timer = setInterval(refresh, 1000);
onUnmounted(() => clearInterval(timer));

/** `onAction`. */
function onAction(): void {
  game.sendGlobalCommand('battle', 'battleTroopDispatch', [
    Number(props.troop.id),
    Number(props.troop.targetid),
    String(props.troop.heroname ?? ''),
    String(props.troop.targetname ?? ''),
  ]);
}

const COLUMNS: { header: string; field: 'sid' | 'count'; width: number }[] = [
  { header: i18n('Battle_BattleActionDialog_4_1'), field: 'sid', width: 164 },
  { header: i18n('Battle_BattleActionDialog_5_1'), field: 'count', width: 164 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="141" :y="43" :w="400" :h="400" style-name="PanelGreyGreen">
      <FxCanvas :x="113" :y="20" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_BattleActionDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="94" :y="61" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleActionDialog_8_1')"
        />
      </FxCanvas>
      <FxCanvas :x="164" :y="61" :w="132" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="132"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(props.troop.targetname ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="30" :y="95" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleActionDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="83" :y="95" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(props.troop.heroname ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="201" :y="95" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleActionDialog_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="254" :y="95" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="String(props.troop.level ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="30" :y="129" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleActionDialog_9_1')"
        />
      </FxCanvas>
      <FxCanvas :x="83" :y="129" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="singleTimeStr"
        />
      </FxCanvas>
      <FxCanvas :x="201" :y="129" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleActionDialog_10_1')"
        />
      </FxCanvas>
      <FxCanvas :x="254" :y="129" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="arrivalTimeStr"
        />
      </FxCanvas>
      <FxCanvas :x="30" :y="173" :w="334" :h="161" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="328"
          :h="153"
          :columns="COLUMNS"
          :rows="
            troops.map((p) => ({ sid: game.global.soldierNames[p.sid] ?? p.sid, count: p.count }))
          "
        />
      </FxCanvas>
      <FxButton
        :x="230"
        :y="356"
        :w="66"
        :h="30"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleActionDialog_7_1')"
        @click="onAction"
      />
      <FxButton
        :x="304"
        :y="356"
        :w="65"
        :h="30"
        :label="i18n('Battle_BattleActionDialog_6_1')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
