<script setup lang="ts">
import { shallowRef } from 'vue';
import { parseArmyInfo, type ArmySoldierState } from '../../game/soldiers';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import ArmyDissolveDialog from './ArmyDissolveDialog.vue';
import ArmyDraftDialog from './ArmyDraftDialog.vue';
import ArmyDraftPanel from './ArmyDraftPanel.vue';

/** Army.ArmyDialog: the 兵营's upgrade dialog with its draft panel and pop-ups. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

/** 兵种转化 opens in the main city from 兵营 level 11. */
const CONVERT_CITY_TYPE = 5;
const CONVERT_MIN_LEVEL = 11;

const city = useCityStore();
const drafting = shallowRef<ArmySoldierState | null>(null);
const dissolving = shallowRef<ArmySoldierState | null>(null);
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
  >
    <template #default="{ extra, level, now, send, reload }">
      <template v-if="city.type === CONVERT_CITY_TYPE && level >= CONVERT_MIN_LEVEL">
        <!-- SoldierChangerPanel is not ported yet. -->
        <FxButton
          :x="20"
          :y="445"
          style-name="ButtonGreen"
          :label="i18n('SolderChangePanel_1_7')"
          :enabled="false"
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
        @dissolve="
          (sid, count) =>
            send('dissolveSoldier', [building.inner, building.x, building.y, sid, count])
        "
        @close="dissolving = null"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
