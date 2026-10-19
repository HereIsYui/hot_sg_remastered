<script setup lang="ts">
import { shallowRef } from 'vue';
import { parseWallInfo, type WallDefenceState, type WallInfo } from '../../game/defences';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import FxLabel from '../../ui/FxLabel.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import WallDissolveDialog from './WallDissolveDialog.vue';
import WallReinforceDialog from './WallReinforceDialog.vue';
import WallReinforcePanel from './WallReinforcePanel.vue';

/** Wall.WallDialog: the 城墙's upgrade dialog with its build panel and pop-ups. */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

const reinforcing = shallowRef<WallDefenceState | null>(null);
const dissolving = shallowRef<WallDefenceState | null>(null);

/** `StringDef.WALL_SPACE_DESC`: capacity, used and free wall space. */
function spaceText(info: WallInfo | null): string {
  if (!info) return '';
  return [info.area, info.areaUsed, info.area - info.areaUsed].reduce(
    (text, n) => text.replace('%d', String(n)),
    i18n('Basic_StringDef_4'),
  );
}
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
      <WallReinforcePanel
        :x="18"
        :y="125"
        :extra="extra"
        :level="level"
        :now="now"
        @reinforce="reinforcing = $event"
        @dissolve="dissolving = $event"
        @cancel="send('stopReinforceQueue', [$event])"
        @accelerate="send('accReinforceQueue', [$event])"
        @reload="reload()"
      />
      <FxLabel
        :x="20"
        :y="450"
        :w="450"
        :fx="{ textAlign: 'left', color: 0xe7d18d }"
        :text="spaceText(parseWallInfo(extra))"
      />
      <WallReinforceDialog
        v-if="reinforcing"
        :key="reinforcing.did"
        :defence="reinforcing"
        @reinforce="(did, count) => send('startReinforceQueue', [did, count])"
        @close="reinforcing = null"
      />
      <WallDissolveDialog
        v-if="dissolving"
        :key="dissolving.did"
        :defence="dissolving"
        @dissolve="(did, count) => send('dissolveDefence', [did, count])"
        @close="dissolving = null"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
