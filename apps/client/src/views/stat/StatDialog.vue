<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import {
  parseStatsReply,
  sortHeroStats,
  statHeroSorts,
  statTabs,
  type StatRow,
} from '../../game/stat';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Stat/StatDialog (682x492): the 幕僚统计 dialog. The six ButtonRed tabs each send
 * `stats/getStats [index]` and the reply fills the matching DataGrid (`onCommand`, the tag
 * selects the panel). The 将领 tab offers the 排列方式 combo, whose `onChangeSort` re-orders the
 * rows client-side.
 */
const game = useGame();

const tabs = statTabs();
const heroSorts = statHeroSorts();
const selected = ref(0);
/** The rows per tab, kept between switches like the original's allStats. */
const rowsByTab = ref<Record<string, StatRow[]>>({});
const sortIndex = ref(0);

const rows = computed(() => {
  const tab = tabs[selected.value]!;
  const stored = rowsByTab.value[tab.key] ?? [];
  return tab.key === 'hero' ? sortHeroStats(stored, sortIndex.value) : stored;
});

function switchPanel(index: number): void {
  selected.value = index;
  game.sendGlobalCommand('stats', 'getStats', [index]);
}

const unregister = game.addGlobalReceiver('stats', (_command, data) => {
  const reply = parseStatsReply(data);
  const tab = tabs[reply.tag];
  if (tab) rowsByTab.value = { ...rowsByTab.value, [tab.key]: reply.rows };
  selected.value = reply.tag;
});

onMounted(() => switchPanel(0));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="10" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="14"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Stat_StatDialog_1_1')"
    />
    <FxButton
      v-for="(tab, i) in tabs"
      :key="tab.key"
      :x="[23, 96, 169, 242, 315, 385][i]"
      :y="53"
      style-name="ButtonRed"
      :label="tab.label"
      :selected="selected === i"
      @click="switchPanel(i)"
    />
    <FxCanvas :x="23" :y="94" :w="632" :h="332" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="626"
        :h="326"
        :columns="tabs[selected]!.columns"
        :rows="rows"
        :row-height="30"
      />
    </FxCanvas>
    <template v-if="selected === 3">
      <FxLabel :x="473" :y="56" style-name="ItemTitle" :text="i18n('Stat_StatDialog_79_1')" />
      <FxComboBox
        v-model:selected-index="sortIndex"
        :x="545"
        :y="56"
        :w="110"
        :row-count="6"
        :items="heroSorts.map((s) => s.label)"
      />
    </template>
    <FxButton :x="597" :y="434" style-name="Close" @click="game.closeDialog()" />
  </FxCanvas>
</template>
