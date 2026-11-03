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
 * Battle.BattleAttackDialog: the 攻击 confirmation of `getInfoForBattleArmyAttack` — both sides'
 * hero (等级) and soldiers, the march time; 确定 sends `battleAttack [troopid, targetTroopId,
 * heroname, targetCityName]`.
 */
const props = defineProps<{
  mine: Record<string, unknown>;
  target: Record<string, unknown>;
  city: string;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const myHero = computed(
  () =>
    `${props.mine.heroname ?? ''} (${Number(props.mine.level ?? 0)}${i18n('Battle_BattleAttackDialogSrc_1')}`,
);
const targetHero = computed(
  () =>
    `${props.target.heroname ?? ''} (${Number(props.target.level ?? 0)}${i18n('Battle_BattleAttackDialogSrc_2')}`,
);
const target = computed(
  () => `${props.city} ${props.target.heroname ?? ''}${i18n('Battle_BattleAttackDialogSrc_3')}`,
);
const mySoldiers = computed(() => parseSoldierPairs(String(props.mine.soldiers ?? '')));
const targetSoldiers = computed(() => parseSoldierPairs(String(props.target.soldiers ?? '')));
const singleTime = computed(() => Number(props.mine.pathtime ?? 0));
const singleTimeStr = ref('');
const arrivalTimeStr = ref('');

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function refresh(): void {
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
  game.sendGlobalCommand('battle', 'battleAttack', [
    Number(props.mine.id),
    Number(props.target.id),
    String(props.mine.heroname ?? ''),
    props.city,
  ]);
}

const COLUMNS: { header: string; field: 'sid' | 'count'; width: number }[] = [
  { header: i18n('Battle_BattleAttackDialog_11_1'), field: 'sid', width: 122 },
  { header: i18n('Battle_BattleAttackDialog_12_1'), field: 'count', width: 122 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="40" :y="43" :w="602" :h="400" style-name="PanelGreyGreen">
      <FxCanvas :x="215" :y="10" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_BattleAttackDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="41" :y="62" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleAttackDialog_7_1')"
        />
      </FxCanvas>
      <FxCanvas :x="107" :y="62" :w="184" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="178"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="target"
        />
      </FxCanvas>
      <FxCanvas :x="41" :y="96" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleAttackDialog_8_1')"
        />
      </FxCanvas>
      <FxCanvas :x="107" :y="96" :w="184" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="178"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="singleTimeStr"
        />
      </FxCanvas>
      <FxCanvas :x="308" :y="96" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleAttackDialog_9_1')"
        />
      </FxCanvas>
      <FxCanvas :x="374" :y="96" :w="184" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="178"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="arrivalTimeStr"
        />
      </FxCanvas>
      <FxCanvas :x="41" :y="130" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleAttackDialog_10_1')"
        />
      </FxCanvas>
      <FxCanvas :x="107" :y="130" :w="184" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="178"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="myHero"
        />
      </FxCanvas>
      <FxCanvas :x="308" :y="131" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleAttackDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="374" :y="130" :w="184" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="178"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="targetHero"
        />
      </FxCanvas>
      <FxCanvas :x="41" :y="164" :w="250" :h="177" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="244"
          :h="171"
          :columns="COLUMNS"
          :rows="
            mySoldiers.map((p) => ({
              sid: game.global.soldierNames[p.sid] ?? p.sid,
              count: p.count,
            }))
          "
        />
      </FxCanvas>
      <FxCanvas :x="308" :y="164" :w="250" :h="177" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="244"
          :h="171"
          :columns="COLUMNS"
          :rows="
            targetSoldiers.map((p) => ({
              sid: game.global.soldierNames[p.sid] ?? p.sid,
              count: p.count,
            }))
          "
        />
      </FxCanvas>
      <FxButton
        :x="411"
        :y="349"
        :w="66"
        :h="30"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleAttackDialog_6_1')"
        @click="onAction"
      />
      <FxButton
        :x="495"
        :y="349"
        :w="65"
        :h="30"
        :label="i18n('Battle_BattleAttackDialog_5_1')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
