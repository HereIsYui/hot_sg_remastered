<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  campaignFoodUse,
  campaignSoldierBlocked,
  maxCampaignSoldierLimit,
  startBattleTroopArgs,
  type BattleState,
} from '../../game/battlefield';
import { armBuyAgain } from '../../game/battlefieldBuyAgain';
import { GAME_SPEED_RATE } from '../../game/battlefield';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * Battle.BattleCampaignDialog: the 战场出征 dialog (`getCurrentCityGroundLevel2 [cid]` answers the
 * 校场 level). The hero combo lists the idle heroes (`onShow`), the target combo the camps'
 * starting cities (`startCityInfo`), the soldier rows take counts from the city's soldier list;
 * the 军旗 toggle (type-0 fields only) adds 25% to both caps. 确定 (`startCampaign`) confirms the
 * 军旗 / 千里走单骑 single-dispatch branches and sends `startBattleTroop [cid, hid, soldiers,
 * useFlag, xy]` followed by `getUserBattleState`.
 */
const props = defineProps<{
  groundLevel: number;
  battle: BattleState;
  startCityInfo: Record<string, unknown>[];
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();

/** `onShow`: `City.soldierList` with fresh counts and takecount 0. */
interface TakeRow {
  sid: number;
  name: string;
  count: number;
  food_use: number;
  takecount: number;
}
const soldierRows = ref<TakeRow[]>(
  game.global.soldiers
    .filter((s) => String(s.fromcity) === '1')
    .map((s) => ({
      sid: Number(s.sid),
      name: String(s.name ?? ''),
      count: city.soldierCounts[Number(s.sid)] ?? 0,
      food_use: Number(s.food_use ?? 0),
      takecount: 0,
    }))
    .sort((a, b) => a.sid - b.sid),
);

/** `onShow`: 出征中 heroes first (`Battle_BattleCampaignDialogSrc_1` placeholder), then the idle
 *  ones (state 0 + hero_health 0). */
const heroIndex = ref(0);
const heroItems = computed(() => {
  const items = [i18n('Battle_BattleCampaignDialogSrc_1')];
  for (const hero of city.heroes) {
    if (Number(hero.state) === 0 && Number(hero.hero_health) === 0) {
      items.push(String(hero.name ?? ''));
    }
  }
  return items;
});
const heroIds = computed(() => {
  const ids = [0];
  for (const hero of city.heroes) {
    if (Number(hero.state) === 0 && Number(hero.hero_health) === 0) ids.push(Number(hero.hid));
  }
  return ids;
});

/** `onShow`: the camps' starting city names. */
const targetIndex = ref(0);
const targetItems = computed(() => props.startCityInfo.map((c) => String(c.name ?? '')));

const useFlag = ref(false);
/** `onShow`: the 军旗 checkbox exists only on type-0 battlefields. */
const flagVisible = computed(() => props.battle.type === 0);

/** `getMaxSoldierLimit` (the client-side cap; the server re-validates). */
const maxLimit = computed(() =>
  maxCampaignSoldierLimit(props.groundLevel, useFlag.value, city.type, {
    bid: props.battle.bid,
    level: props.battle.level,
  }),
);

const allTaken = computed(() => soldierRows.value.reduce((sum, r) => sum + r.takecount, 0));

/** `getFoodUse` + `resetResult`. */
const foodUse = computed(() =>
  Math.floor(campaignFoodUse(soldierRows.value, Math.max(0, props.battle.endtime - serverTime()))),
);

/** `onTimer`: a fixed 10s march time per the AS3 (`mPathNeedTime = 10`). */
const pathNeedTime = 10;
const arriveStr = computed(() => {
  const d = new Date((serverTime() + pathNeedTime * GAME_SPEED_RATE) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

/** `onTriggleUseFlag`: un-checking the flag re-fills to the cap (`takeAllSoldier`). */
function onFlagChange(next: boolean): void {
  useFlag.value = next;
  if (!next) takeAll();
}

/** `changeCount`. */
function changeCount(item: TakeRow, value: string): void {
  let max = maxLimit.value;
  if (campaignSoldierBlocked(props.battle.bid, item.sid)) max = 0;
  max = Math.min(max, item.count);
  let count = parseInt(value, 10);
  if (Number.isNaN(count) || count < 0) count = 0;
  if (count > max) count = max;
  item.takecount = count;
}

/** `takeMaxSoldier`. */
function takeMax(item: TakeRow): void {
  let max = maxLimit.value;
  if (campaignSoldierBlocked(props.battle.bid, item.sid)) max = 0;
  const cur = allTaken.value;
  const room = Math.min(item.count - item.takecount, max - cur);
  item.takecount = Math.max(0, item.takecount + room);
}

/** `takeNoneSoldier`. */
function takeNone(): void {
  for (const r of soldierRows.value) r.takecount = 0;
}

/** `takeAllSoldier`. */
function takeAll(): void {
  let all = 0;
  for (const r of soldierRows.value) {
    if (all + r.count <= maxLimit.value) {
      r.takecount = r.count;
      all += r.count;
    } else {
      r.takecount = Math.max(0, maxLimit.value - all);
      all = maxLimit.value;
    }
    if (campaignSoldierBlocked(props.battle.bid, r.sid)) r.takecount = 0;
  }
}

/** `startCampaign` → `onStartCampaignAlert` → `startTroop`. */
async function startCampaign(): Promise<void> {
  if (useFlag.value) {
    const answer = await showAlert(i18n('Battle_BattleCampaignDialogSrc_2'), '', ['yes', 'no']);
    if (answer !== 'yes') return;
    if (props.battle.bid === 5001) {
      const second = await showAlert(i18n('Battle_BattleCampaignDialogSrc_5'), '', ['yes', 'no']);
      if (second !== 'yes') return;
    }
    startTroop();
    return;
  }
  if (props.battle.bid === 5001) {
    const answer = await showAlert(i18n('Battle_BattleCampaignDialogSrc_5'), '', ['yes', 'no']);
    if (answer !== 'yes') return;
  }
  startTroop();
}

/** `startTroop`: build the soldiers string and send the command (军旗 gid 59 on short). */
function startTroop(): void {
  const hid = heroIds.value[heroIndex.value] ?? 0;
  if (hid <= 0) {
    void showAlert(i18n('Battle_BattleCampaignDialogSrc_3'));
    return;
  }
  if (!soldierRows.value.some((r) => r.takecount > 0)) {
    void showAlert(i18n('Battle_BattleCampaignDialogSrc_4'));
    return;
  }
  const startCity = props.startCityInfo[targetIndex.value];
  if (!startCity) return;
  armBuyAgain([59], () =>
    game.sendGlobalCommand(
      'battle',
      'startBattleTroop',
      startBattleTroopArgs(
        game.city.cid,
        hid,
        soldierRows.value,
        useFlag.value,
        Number(startCity.xy),
      ),
    ),
  );
  game.sendGlobalCommand(
    'battle',
    'startBattleTroop',
    startBattleTroopArgs(
      game.city.cid,
      hid,
      soldierRows.value,
      useFlag.value,
      Number(startCity.xy),
    ),
  );
  game.sendGlobalCommand('battle', 'getUserBattleState');
  emit('close');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="21" :y="10" :w="640" :h="470" style-name="PanelGreyGreen">
      <FxCanvas :x="220" :y="12" :w="200" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="200"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleCampaignDialog_14_1')"
        />
      </FxCanvas>
      <FxLabel
        :x="20"
        :y="44"
        :w="300"
        :h="20"
        :fx="{ color: 16777215 }"
        :text="`${i18n('Battle_BattleCampaignDialog_14_1')}${props.battle.name}`"
      />
      <FxCanvas :x="20" :y="70" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleCampaignDialog_9_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="heroIndex"
        :x="128"
        :y="70"
        :w="140"
        :h="26"
        :items="heroItems"
      />
      <FxCanvas :x="290" :y="70" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleCampaignDialog_8_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="targetIndex"
        :x="398"
        :y="70"
        :w="140"
        :h="26"
        :items="targetItems"
      />
      <FxToggle
        v-if="flagVisible"
        v-model:selected="useFlag"
        :x="548"
        :y="72"
        :label="i18n('Battle_BattleCampaignDialog_6_1')"
        :tip="i18n('Battle_BattleCampaignDialog_7_1')"
        @change="onFlagChange"
      />
      <!-- soldier picker rows (BattleCampaignSoldierItem) -->
      <FxCanvas :x="20" :y="104" :w="600" :h="250" style-name="BoardListUp">
        <FxCanvas
          v-for="(item, i) in soldierRows"
          :key="item.sid"
          :x="i % 2 === 0 ? 2 : 302"
          :y="6 + Math.floor(i / 2) * 46"
          :w="296"
          :h="44"
        >
          <FxLabel :x="0" :y="0" :w="90" :h="20" :text="`${item.name}（${item.count}）`" />
          <input
            class="take-input"
            :value="String(item.takecount)"
            :disabled="campaignSoldierBlocked(props.battle.bid, item.sid)"
            @input="changeCount(item, ($event.target as HTMLInputElement).value)"
          />
          <FxButton
            :x="150"
            :y="10"
            :w="60"
            :h="24"
            :label="i18n('Battle_BattleCampaignDialog_4_1')"
            @click="takeMax(item)"
          />
          <FxButton
            :x="216"
            :y="10"
            :w="60"
            :h="24"
            :label="i18n('Battle_BattleCampaignDialog_5_1')"
            @click="changeCount(item, '0')"
          />
        </FxCanvas>
      </FxCanvas>
      <FxLabel
        :x="20"
        :y="362"
        :w="200"
        :h="20"
        :fx="{ color: 16777215 }"
        :text="`${i18n('Battle_BattleCampaignDialog_10_1')}${pathNeedTime}${i18n('_Utils_7')}`"
      />
      <FxLabel
        :x="220"
        :y="362"
        :w="260"
        :h="20"
        :fx="{ color: 16777215 }"
        :text="`${i18n('Battle_BattleCampaignDialog_11_1')}${arriveStr}`"
      />
      <FxLabel
        :x="20"
        :y="386"
        :w="300"
        :h="20"
        :fx="{ color: 16777215 }"
        :text="`${i18n('Battle_BattleCampaignDialog_12_1')}${foodUse}`"
      />
      <FxButton
        :x="30"
        :y="416"
        :w="70"
        :h="34"
        :label="i18n('Battle_BattleCampaignDialog_1_1')"
        @click="emit('close')"
      />
      <FxButton
        :x="230"
        :y="416"
        :w="70"
        :h="34"
        :label="i18n('Battle_BattleCampaignDialog_5_1')"
        @click="takeNone"
      />
      <FxButton
        :x="420"
        :y="416"
        :w="80"
        :h="34"
        style-name="ButtonYellow"
        :fx="{ fontSize: 14, fontWeight: 'bold' }"
        :label="i18n('Battle_BattleCampaignDialog_13_1')"
        @click="startCampaign"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.take-input {
  position: absolute;
  left: 92px;
  top: 10px;
  width: 52px;
  height: 24px;
  box-sizing: border-box;
  border: 1px inset #b7babc;
  background: #fff;
  color: #000;
  font-size: 12px;
  padding: 0 3px;
}
</style>
