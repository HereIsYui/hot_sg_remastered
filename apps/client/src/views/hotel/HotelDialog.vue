<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { actMessage, parseHotelInfo, type HeroRecruit } from '../../game/hotel';
import { ID_BUILDING_HOTEL } from '../../game/hotelLionize';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import HeroRecruitDialog from './HeroRecruitDialog.vue';
import HotelRecruitPanel from './HotelRecruitPanel.vue';
import LionizeDialog from './LionizeDialog.vue';
import RumorDialog from './RumorDialog.vue';

/**
 * Hotel.HotelDialog: the 客栈's upgrade dialog with its recruit list. 鉴定宝藏 is wired to
 * `treasureIdentify`; 市井传闻 (RumorDialog) and 结交名将 (LionizeDialog) open over it, sharing
 * the building's (bid, param) address and routing their replies by ttype (1/2/13/22).
 */
const props = defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

const game = useGame();

/** 市井传闻 and 鉴定宝藏 open at 客栈 level 5. */
const RUMOR_MIN_LEVEL = 5;

const recruiting = shallowRef<HeroRecruit | null>(null);
const showRumor = ref(false);
const showLionize = ref(false);

/** `getBuildingParam`: the building position round-tripped with every dialog command. */
const param = computed(() => props.building.y * 10 + props.building.x);

/** The hero id a pending 结交 confirm applies to (`mLastHeroID`). */
let lionizeHid = 0;

/** `tryLionizeHero` resolves `[hid, goldNeed]`; confirm, then `lionizeHero` (both reply ttype 22). */
const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === ID_BUILDING_HOTEL && p === param.value,
  onData(reply, ttype) {
    if (ttype !== 22 || !Array.isArray(reply) || reply.length < 2) return;
    lionizeHid = parseInt(String(reply[0]), 10) || 0;
    const gold = parseInt(String(reply[1]), 10) || 0;
    void showAlert(i18n('Hotel_HotelDialogSrc_2') + gold + i18n('Hotel_HotelDialogSrc_3'), '', [
      'yes',
      'no',
    ]).then((answer) => {
      if (answer === 'yes') {
        game.sendDialogCommand('lionizeHero', ID_BUILDING_HOTEL, param.value, [lionizeHid], 22);
      }
    });
  },
});
onUnmounted(unregister);

/** `onBuildingInfo`: an event hero's gift is announced after the list. */
function onReply(data: unknown[]) {
  const text = actMessage(data);
  if (text !== null) void showAlert(text);
}

/** `onResetRecruitHero` / `onUseZhaoXinBan`: refreshing takes a 招贤榜. */
async function onReset(send: (cmd: string, args: CommandArg[]) => void) {
  const answer = await showAlert(i18n('Hotel_HotelRecruitPanelSrc_5'), '', ['yes', 'no']);
  if (answer === 'yes') send('resetRecruitHero', []);
}

/** `HotelRecruitPanel.onClickRumor`: 市井传闻 needs 客栈 level 5. */
function onRumor(level: number) {
  if (level < RUMOR_MIN_LEVEL) {
    void showAlert(i18n('Hotel_HotelRecruitPanelSrc_1'));
    return;
  }
  showRumor.value = true;
}

/** `HotelRecruitPanel.onClickMakeFriends`: open the 结交名将 roster. */
function onMakeFriends() {
  showLionize.value = true;
}

/**
 * `HotelRecruitPanel.onClickTreasure`: 鉴定宝藏 needs 客栈 level 5 and spends a 藏宝图, then
 * `treasureIdentify` throws the result message (shown by the global command receiver).
 */
async function onTreasure(level: number, send: (cmd: string, args: CommandArg[]) => void) {
  if (level < RUMOR_MIN_LEVEL) {
    void showAlert(i18n('Hotel_HotelRecruitPanelSrc_1'));
    return;
  }
  const answer = await showAlert(i18n('Hotel_HotelRecruitPanelSrc_3'), '', ['yes', 'no']);
  if (answer === 'yes') send('treasureIdentify', [0]);
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
    <template #default="{ extra, level, send }">
      <HotelRecruitPanel
        :x="20"
        :y="125"
        :recruits="parseHotelInfo(extra).recruits"
        @reset="onReset(send)"
        @rumor="onRumor(level)"
        @make-friends="onMakeFriends()"
        @treasure="onTreasure(level, send)"
        @recruit="recruiting = $event"
      />
      <HeroRecruitDialog
        v-if="recruiting"
        :key="recruiting.id"
        :recruit="recruiting"
        :valid-position="parseHotelInfo(extra).validPosition"
        @recruit="send('recruitHero', [$event])"
        @close="recruiting = null"
      />
      <RumorDialog v-if="showRumor" :param="param" @close="showRumor = false" />
      <LionizeDialog v-if="showLionize" :param="param" @close="showLionize = false" />
    </template>
  </UpgradeBuildingDialog>
</template>
