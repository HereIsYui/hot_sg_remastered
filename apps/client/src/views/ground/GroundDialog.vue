<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { shallowRef } from 'vue';
import { useGame } from '../../game/game';
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import AttackTacticsDialog from './AttackTacticsDialog.vue';
import CaptiveDialog from './CaptiveDialog.vue';
import GroundPanel from './GroundPanel.vue';
import LamsterDialog from './LamsterDialog.vue';
import ManeuverDialog from './ManeuverDialog.vue';
import ResistTacticsDialog from './ResistTacticsDialog.vue';
import WoundedDialog from './WoundedDialog.vue';

/**
 * Ground.GroundDialog: the 校场's upgrade dialog with its action panel and pop-ups.
 *
 * Replies are routed by the `get*` command's ttype, matching the original GroundDialog:
 * 3 getAttackTactics, 4 getResistTactics, 5 getWoundedSoldier, 7 getLamster, 9 getCaptiveSoldier.
 * The action commands (conscript / set* / accept* / cure* / dismiss* / say*) answer `[0, message]`,
 * shown by the global alert path, so they carry no sub-dialog ttype.
 */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

type SubName = 'attack' | 'resist' | 'wounded' | 'lamster' | 'captive';

/** ttype of each `get*` reply (GroundDialog.onBuildingInfo) and the command that fetches it. */
const GET: Record<SubName, { cmd: string; ttype: number }> = {
  attack: { cmd: 'getAttackTactics', ttype: 3 },
  resist: { cmd: 'getResistTactics', ttype: 4 },
  wounded: { cmd: 'getWoundedSoldier', ttype: 5 },
  lamster: { cmd: 'getLamster', ttype: 7 },
  captive: { cmd: 'getCaptiveSoldier', ttype: 9 },
};

type Popup = { name: SubName; data: unknown } | { name: 'maneuver' };

const game = useGame();
const popup = shallowRef<Popup | null>(null);
/** The sub-dialog awaiting its `get*` reply, and the ttype that reply must carry. */
let pending: { name: SubName; ttype: number } | null = null;

/** Requests a list/tactics pop-up's data at its ttype; the reply opens it (onReplyTtype). */
function request(send: (cmd: string, args: CommandArg[], ttype?: number) => void, name: SubName) {
  pending = { name, ttype: GET[name].ttype };
  send(GET[name].cmd, [], GET[name].ttype);
}

function onReplyTtype(data: unknown[], ttype: number) {
  if (!pending || pending.ttype !== ttype) return;
  popup.value = { name: pending.name, data };
  pending = null;
}
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
    @reply-ttype="onReplyTtype"
  >
    <template #default="{ send }">
      <GroundPanel
        :x="10"
        :y="118"
        @campaign="game.showCampaign(building.bid, building.y * 10 + building.x)"
        @conscript="send('conscript', [], 4)"
        @resist="request(send, 'resist')"
        @wounded="request(send, 'wounded')"
        @lamster="request(send, 'lamster')"
        @captive="request(send, 'captive')"
        @attack="request(send, 'attack')"
        @maneuver="popup = { name: 'maneuver' }"
      />
      <AttackTacticsDialog
        v-if="popup?.name === 'attack'"
        :data="popup.data"
        @save="(a) => (send('setAttackTactics', a, 0), (popup = null))"
        @close="popup = null"
      />
      <ResistTacticsDialog
        v-else-if="popup?.name === 'resist'"
        :data="popup.data"
        @save="(a) => (send('setResistTactics', a, 0), (popup = null))"
        @close="popup = null"
      />
      <WoundedDialog
        v-else-if="popup?.name === 'wounded'"
        :data="popup.data"
        @send="(c, a) => (send(c, a, 0), (popup = null))"
        @close="popup = null"
      />
      <LamsterDialog
        v-else-if="popup?.name === 'lamster'"
        :data="popup.data"
        @send="(c, a) => (send(c, a, 0), (popup = null))"
        @close="popup = null"
      />
      <CaptiveDialog
        v-else-if="popup?.name === 'captive'"
        :data="popup.data"
        @send="(c, a) => (send(c, a, 0), (popup = null))"
        @close="popup = null"
      />
      <ManeuverDialog v-else-if="popup?.name === 'maneuver'" @close="popup = null" />
    </template>
  </UpgradeBuildingDialog>
</template>
