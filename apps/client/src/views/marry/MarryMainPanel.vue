<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import MarryChild from './MarryChild.vue';
import MarryKingExpr from './MarryKingExpr.vue';
import MarryMadam from './MarryMadam.vue';

/**
 * MarrySystem.MarryMainPanel (`showMarrayMainPanel`, the 功能按钮区 XJLYBtn button): the 喜结良缘
 * dialog. `sendMarryCommand(tab)` switches 缔结姻缘 / 天降麟儿 / 教馆培养 — each tab loads its own
 * command on the MarrySystem action (1 loadMarryInfo, 2 loadMarryMadam, 3 loadMarryChild).
 */
const game = useGame();

const TABS = [
  { index: 1, label: 'Marry_System_type_1', command: 'loadMarryInfo' },
  { index: 2, label: 'Marry_System_type_2', command: 'loadMarryMadam' },
  { index: 3, label: 'Marry_System_type_3', command: 'loadMarryChild' },
];
const tab = ref(0);

/** `MarryMainPanel.sendMarryCommand`. */
function sendMarryCommand(index: number): void {
  tab.value = index;
  const entry = TABS.find((t) => t.index === index);
  if (entry) game.sendGlobalCommand('MarrySystem', entry.command);
}

const unregister = game.addGlobalReceiver('MarrySystem', (command, data) => {
  // the tabs parse their own replies; this receiver only guards the not-ported functions
  if (command === 'loadMarryInfo' && tab.value === 0) sendMarryCommand(1);
  void data;
});

onMounted(() => sendMarryCommand(1));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="240" :y="12" source="images/title.png" />
    <FxLabel
      :y="17"
      :w="682"
      :h="18"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Marry_System_title')"
    />
    <FxButton
      v-for="t in TABS"
      :key="t.index"
      :x="34 + (t.index - 1) * 100"
      :y="55"
      :w="92"
      :h="40"
      style-name="ButtonRed"
      :selected="tab === t.index"
      :label="i18n(t.label)"
      @click="sendMarryCommand(t.index)"
    />
    <FxCanvas :x="33" :y="98" :w="625" :h="353" style-name="BoardListDown">
      <MarryKingExpr v-if="tab === 1" />
      <MarryMadam v-else-if="tab === 2" />
      <MarryChild v-else-if="tab === 3" />
    </FxCanvas>
    <FxButton :x="609" :y="450" style-name="Close" @click="game.closeDialog()" />
  </FxCanvas>
</template>
