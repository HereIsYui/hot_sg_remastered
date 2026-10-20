<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { shallowRef } from 'vue';
import { actMessage, parseHotelInfo, type HeroRecruit } from '../../game/hotel';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import HeroRecruitDialog from './HeroRecruitDialog.vue';
import HotelRecruitPanel from './HotelRecruitPanel.vue';

/**
 * Hotel.HotelDialog: the 客栈's upgrade dialog with its recruit list. 市井传闻, 结交名将 and
 * 鉴定宝藏 open dialogs that are not ported.
 */
defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();

/** 市井传闻 opens at 客栈 level 5. */
const RUMOR_MIN_LEVEL = 5;

const recruiting = shallowRef<HeroRecruit | null>(null);

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

function onRumor(level: number) {
  void showAlert(i18n(level < RUMOR_MIN_LEVEL ? 'Hotel_HotelRecruitPanelSrc_1' : 'NotYetValid'));
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
        @make-friends="showAlert(i18n('NotYetValid'))"
        @treasure="showAlert(i18n('NotYetValid'))"
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
    </template>
  </UpgradeBuildingDialog>
</template>
