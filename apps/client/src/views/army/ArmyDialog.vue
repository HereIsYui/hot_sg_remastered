<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { convertChoices, convertDoneText, type ConvertChoice } from '../../game/soldierConvert';
import { parseArmyInfo, type ArmySoldierState } from '../../game/soldiers';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import { useGlobalStore } from '../../stores/global';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import ArmyDissolveDialog from './ArmyDissolveDialog.vue';
import ArmyDraftDialog from './ArmyDraftDialog.vue';
import ArmyDraftPanel from './ArmyDraftPanel.vue';
import SoldierChangerPanel from './SoldierChangerPanel.vue';

/** Army.ArmyDialog: the 兵营's upgrade dialog with its draft panel and pop-ups. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

/** 兵种转化 opens in the main city from 兵营 level 11. */
const CONVERT_CITY_TYPE = 5;
const CONVERT_MIN_LEVEL = 11;

const game = useGame();
const city = useCityStore();
const global = useGlobalStore();
const drafting = shallowRef<ArmySoldierState | null>(null);
const dissolving = shallowRef<ArmySoldierState | null>(null);
/** `showChangePanel`: the soldier lists and allowance as they were when it opened. */
const changing = shallowRef<{
  from: ConvertChoice[];
  to: ConvertChoice[];
  rates: unknown[][];
  remain: number;
} | null>(null);
/** `lastConvertInfo`: announced with the next reply, whatever it answers. */
let lastConvert: [number, number, number, number] | null = null;

function showChangePanel(extra: unknown[]) {
  const info = parseArmyInfo(extra);
  if (!info) return;
  changing.value = {
    ...convertChoices(info.soldiers),
    rates: info.rates,
    remain: info.convert.value - info.convert.convert,
  };
}

function startConvert(
  send: (cmd: string, args: CommandArg[]) => void,
  b: BuildingState,
  convert: [number, number, number, number],
) {
  lastConvert = convert;
  send('soldierConvert', [b.inner, b.x, b.y, ...convert]);
  changing.value = null;
}

/**
 * `ArmyDissolveDialog.onDraft`: disbanding any soldiers takes the 二级密码 first, which replaces
 * this dialog until it is accepted.
 */
function dissolve(
  send: (cmd: string, args: CommandArg[]) => void,
  b: BuildingState,
  sid: number,
  count: number,
) {
  const args = [b.inner, b.x, b.y, sid, count];
  if (count < 1) {
    send('dissolveSoldier', args);
    return;
  }
  game.requestUnlock('dismissSoldier', () => {
    game.showBuildingDialog(
      city.buildings.find(
        (o) => o.bid === b.bid && o.inner === b.inner && o.x === b.x && o.y === b.y,
      ) ?? b,
    );
    game.sendDialogCommand('dissolveSoldier', b.bid, b.y * 10 + b.x, args);
  });
}

function onReply() {
  if (!lastConvert) return;
  const [fromSid, fromCount, toSid, toCount] = lastConvert;
  lastConvert = null;
  const name = (sid: number) => global.soldierNames[sid] ?? '';
  const template = i18n('SolderChangePanel_1_9');
  void showAlert(convertDoneText(template, fromCount, name(fromSid), toCount, name(toSid)));
}
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
    @reply="onReply"
  >
    <template #default="{ extra, level, now, send, reload }">
      <template v-if="city.type === CONVERT_CITY_TYPE && level >= CONVERT_MIN_LEVEL">
        <FxButton
          :x="20"
          :y="445"
          style-name="ButtonGreen"
          :label="i18n('SolderChangePanel_1_7')"
          @click="showChangePanel(extra)"
        />
        <FxLabel :x="90" :y="450" :text="i18n('SolderChangePanel_1_8')" />
        <FxTextInput
          :x="180"
          :y="450"
          :w="60"
          style-name="DownEmptyInput"
          :editable="false"
          :model-value="String(parseArmyInfo(extra)?.convert.convert || '')"
        />
      </template>
      <ArmyDraftPanel
        :x="18"
        :y="125"
        :extra="extra"
        :level="level"
        :now="now"
        @draft="drafting = $event"
        @dissolve="dissolving = $event"
        @cancel="send('stopDraftQueue', [building.inner, building.x, building.y, $event])"
        @reload="reload()"
      />
      <ArmyDraftDialog
        v-if="drafting"
        :key="drafting.sid"
        :soldier="drafting"
        @draft="
          (sid, count, double) =>
            send('startDraftQueue', [building.inner, building.x, building.y, sid, count, double])
        "
        @close="drafting = null"
      />
      <ArmyDissolveDialog
        v-if="dissolving"
        :key="dissolving.sid"
        :soldier="dissolving"
        @dissolve="(sid, count) => dissolve(send, building, sid, count)"
        @close="dissolving = null"
      />
      <SoldierChangerPanel
        v-if="changing"
        v-bind="changing"
        @convert="(...c) => startConvert(send, building, c)"
        @close="changing = null"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
