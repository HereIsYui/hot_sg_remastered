<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import { useGame } from '../../game/game';
import {
  announcementOpenCommands,
  openAnnouncement as shouldAutoOpen,
} from '../../game/loginActivity';
import FxButton from '../../ui/FxButton.vue';
import Announcement from '../game/Announcement.vue';
import ProgressDialog from './ProgressDialog.vue';
/** GameView owns this host; scene changes must not remount its login announcement. */
const props = withDefaults(defineProps<{ autoOpen?: boolean }>(), { autoOpen: true });
const game = useGame();
// BloodWar.onLoadUserInfo skips the automatic announcement for a newly created role.
const announcement = ref(shouldAutoOpen(props.autoOpen, game.guide.justCreatedRole));
function openAnnouncement() {
  announcement.value = true;
  // CityInnerPanel/CityPanel.onAnnounce marks the task before requesting announcement data.
  for (const command of announcementOpenCommands(true)) game.sendGlobalCommand('reward', command);
}
const progress = ref<'huangjin' | 'dongzhuo' | null>(null);
defineExpose({
  openAnnouncement,
  openProgress: (kind: 'huangjin' | 'dongzhuo') => {
    progress.value = kind;
  },
});
</script>
<template>
  <div class="activity-hub">
    <FxButton
      :x="748"
      :y="67"
      :w="80"
      :h="25"
      style-name="ButtonRed"
      :label="i18n('Announcement_Dialog_1')"
      @click="openAnnouncement"
    />
    <FxButton
      :x="831"
      :y="67"
      :w="80"
      :h="25"
      style-name="ButtonRed"
      :label="i18n('Rank_HuangJinProgressDlg_2_1')"
      @click="progress = 'huangjin'"
    />
    <FxButton
      :x="914"
      :y="67"
      :w="80"
      :h="25"
      style-name="ButtonRed"
      :label="i18n('Hero_Battle_Dialog_battle_name_3')"
      @click="progress = 'dongzhuo'"
    />
    <Announcement v-if="announcement" @close="announcement = false" />
    <ProgressDialog v-if="progress" :key="progress" :kind="progress" @close="progress = null" />
  </div>
</template>
<style scoped>
.activity-hub {
  position: absolute;
  inset: 0;
  /* GameView restores pointer events on its direct children; keep this host transparent. */
  pointer-events: none !important;
}
.activity-hub > :deep(*) {
  pointer-events: auto;
}
</style>
