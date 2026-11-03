<script setup lang="ts">
import { computed, ref } from 'vue';
import { parseSoldierPairs } from '../../game/battlefield';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattlefieldAddArmyDialog: the 征召士兵 popup of a 据点's 增加兵力 button
 * (`getInfoForBattleArmyReinforce [cid]` answers `[troops, reinforceSoldiers]`). One of the
 * troops standing there is picked and soldiers are taken from the 据点's shared
 * `reinforce_soldiers` pool, capped by the troop's headroom (MAX_SOLDIER_PEOPLE 100000).
 *
 * Deliberate difference: the shipped AS3 submits once via the cross-server channel
 * (`netcmd addArmyFromReinforce [troopid, soldiers]`, a BattleNetFunc signature); the ported
 * local BattleFunc.php command takes one soldier type per call — the submit sends
 * `addArmyFromReinforce [cid, troopid, sid]` per taken sid.
 */
const props = defineProps<{
  troops: Record<string, unknown>[];
  reinforce: unknown;
  cid: number;
  cityName: string;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

/** `MAX_SOLDIER_PEOPLE`. */
const MAX_SOLDIER_PEOPLE = 100000;

interface SoldierRow {
  sid: number;
  name: string;
  peopleNeed: number;
  takecount: number;
}

/** `onCreate`: every city soldier type except 10/11/12 with an unlimited count. */
const soldierRows = ref<SoldierRow[]>(
  Object.entries(game.global.soldierNames)
    .map(([sid, name]) => ({
      sid: Number(sid),
      name,
      peopleNeed: peopleOf(Number(sid)),
      takecount: 0,
    }))
    .filter((r) => ![10, 11, 12].includes(r.sid))
    .sort((a, b) => a.sid - b.sid),
);

/** `Define.SOLDIER_PEOPLE` (indexed 0..11 = sid 1..12). */
function peopleOf(sid: number): number {
  return [1, 1, 1, 1, 1, 2, 3, 6, 4, 5, 10, 8][sid - 1] ?? 1;
}

/** `getSoldierPeopleValue`: heads the reinforce pool string carries. */
function soldierPeopleValue(soldiers: unknown): number {
  return parseSoldierPairs(String(soldiers ?? '')).reduce(
    (sum, p) => sum + p.count * peopleOf(p.sid),
    0,
  );
}

const heroIndex = ref(0);
const heroItems = computed(() =>
  props.troops.map(
    (t) => `${t.heroname ?? ''} ${t.level ?? ''}${i18n('Battle_BattleTroopItem_6')}`,
  ),
);

/** `resetData`: the per-troop current soldier maps. */
const troopMaps = computed(() =>
  props.troops.map((t) => parseSoldierPairs(String(t.soldiers ?? ''))),
);
const curSoldierValue = computed(() => {
  const map = troopMaps.value[heroIndex.value] ?? [];
  return map.reduce((sum, p) => sum + p.count * peopleOf(p.sid), 0);
});

/** `getMaxSoldierLimit`. */
const maxSoldierLimit = computed(() =>
  Math.min(MAX_SOLDIER_PEOPLE - curSoldierValue.value, soldierPeopleValue(props.reinforce)),
);
/** `resetResult`. */
const availableSoldierValue = computed(() => maxSoldierLimit.value + curSoldierValue.value);
const alreadyUsed = computed(() =>
  soldierRows.value.reduce((sum, r) => sum + r.takecount * r.peopleNeed, 0),
);
const leftSoldierValue = computed(() => availableSoldierValue.value - alreadyUsed.value);

/** `onChangeComboBox`: pre-fill the taken counts from the selected troop's soldiers. */
function onChangeHero(): void {
  const map = troopMaps.value[heroIndex.value] ?? [];
  for (const r of soldierRows.value) {
    r.takecount = map.find((p) => p.sid === r.sid)?.count ?? 0;
  }
}

/** `changeCount`: the cap follows the original's `takecount + floor(available / people_need)`. */
function changeCount(item: SoldierRow, value: string): void {
  let count = parseInt(value, 10);
  if (Number.isNaN(count) || count < 0) count = 0;
  const maxPossible = item.takecount + Math.floor(availableSoldierValue.value / item.peopleNeed);
  if (count > maxPossible) count = maxPossible;
  item.takecount = count;
}

function takeMax(item: SoldierRow): void {
  changeCount(
    item,
    String(item.takecount + Math.floor(availableSoldierValue.value / item.peopleNeed)),
  );
}

/** `addArmy` → `doAddArmy`: one local command per taken soldier type. */
async function addArmy(): Promise<void> {
  const troop = props.troops[heroIndex.value];
  const tid = Number(troop?.id ?? 0);
  if (tid <= 0) {
    void showAlert(i18n('Battle_BattleAddArmyDialog_6_1'));
    return;
  }
  const taken = soldierRows.value.filter((r) => r.takecount > 0);
  if (taken.length === 0) {
    void showAlert(i18n('Battle_BattleCampaignDialogSrc_4'));
    return;
  }
  if (leftSoldierValue.value > 10) {
    const answer = await showAlert(i18n('Battle_BattleCampaignDialogSrc_7'), '', ['yes', 'no']);
    if (answer !== 'yes') return;
  }
  for (const row of taken) {
    game.sendGlobalCommand('battle', 'addArmyFromReinforce', [props.cid, tid, row.sid]);
  }
  gameAlert(i18n('Battle_BattleAddArmyDialog_5_1'));
  emit('close');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="40" :y="43" :w="602" :h="439" style-name="PanelGreyGreen">
      <FxCanvas :x="201" :y="21" :w="200" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="24"
          :y="2"
          :w="151"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleAddArmyDialog_1_1')"
        />
      </FxCanvas>
      <!-- soldier picker -->
      <FxCanvas :x="19" :y="53" :w="314" :h="376" style-name="BoardListUp">
        <FxLabel
          :x="11"
          :y="10"
          :w="290"
          style-name="ItemTitle"
          :text="i18n('Battle_BattleAddArmyDialog_4_1')"
        />
        <FxCanvas
          v-for="(item, i) in soldierRows"
          :key="item.sid"
          :x="i % 2 === 0 ? 2 : 152"
          :y="40 + Math.floor(i / 2) * 46"
          :w="148"
          :h="44"
        >
          <FxLabel :x="0" :y="0" :w="70" :h="20" :text="item.name" />
          <FxLabel
            :x="0"
            :y="20"
            :w="70"
            :h="20"
            :fx="{ color: 13421772 }"
            :text="`人口 ${item.peopleNeed}`"
          />
          <input
            class="take-input"
            :value="String(item.takecount)"
            @input="changeCount(item, ($event.target as HTMLInputElement).value)"
          />
          <FxButton
            :x="104"
            :y="12"
            :w="40"
            :h="22"
            :label="i18n('Battle_BattleCampaignDialog_4_1')"
            @click="takeMax(item)"
          />
        </FxCanvas>
      </FxCanvas>
      <!-- right column -->
      <FxCanvas :x="335" :y="53" :w="257" :h="376" style-name="BoardListUp">
        <FxCanvas :x="17" :y="24" :w="83" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="60"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('Battle_BattleAddArmyDialog_3_1')"
          />
        </FxCanvas>
        <FxComboBox
          v-model:selected-index="heroIndex"
          :x="110"
          :y="24"
          :w="119"
          :h="26"
          :items="heroItems"
          @change="onChangeHero"
        />
        <FxLabel
          :x="17"
          :y="66"
          :w="220"
          :h="20"
          :text="`${i18n('Battle_BattleAddArmyDialog_9_1')}${availableSoldierValue}`"
        />
        <FxLabel
          :x="17"
          :y="90"
          :w="220"
          :h="20"
          :text="`${i18n('Battle_BattleAddArmyDialog_10_1')}${alreadyUsed}`"
        />
        <FxLabel
          :x="17"
          :y="114"
          :w="220"
          :h="20"
          :text="`${i18n('Battle_BattleAddArmyDialog_12_1')}${leftSoldierValue}`"
        />
        <FxLabel
          :x="17"
          :y="140"
          :w="220"
          :h="20"
          :text="`${i18n('Battle_BattleAddArmyDialog_11_1')}${props.cityName}`"
        />
        <FxButton
          :x="40"
          :y="330"
          :w="80"
          :h="34"
          style-name="ButtonYellow"
          :label="i18n('Battle_BattleAddArmyDialog_8_1')"
          @click="addArmy"
        />
        <FxButton
          :x="150"
          :y="330"
          :w="65"
          :h="34"
          :label="i18n('Battle_BattleCampaignDialog_3_1')"
          @click="emit('close')"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.take-input {
  position: absolute;
  left: 44px;
  top: 12px;
  width: 52px;
  height: 22px;
  box-sizing: border-box;
  border: 1px inset #b7babc;
  background: #fff;
  color: #000;
  font-size: 12px;
  padding: 0 3px;
}
</style>
