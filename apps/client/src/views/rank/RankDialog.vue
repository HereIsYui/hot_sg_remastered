<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import {
  activityRankColumns,
  parseRankConfig,
  parseRankReply,
  parseRankReward,
  RANK_PANELS,
  rankColumns,
  rankPageLabel,
  rankPanel,
  rankType,
  rankUpdateTime,
  type RankPanelId,
  type RankSearch,
} from '../../game/rank';
import { treasureItems, type TreasureItem } from '../../game/goods';
import TreasureGetDialog from '../goods/TreasureGetDialog.vue';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const game = useGame();
const panelId = ref<RankPanelId>('king');
const sort = ref(0);
const reply = ref(parseRankReply(null));
const search = ref<RankSearch>({ kind: null, value: '' });
const searchRank = ref('');
const searchName = ref('');
const config = ref(parseRankConfig(null));
const rewardEnabled = ref(false);
const treasure = ref<TreasureItem[] | null>(null);
const panel = computed(() => rankPanel(panelId.value));
const type = computed(() => rankType(panelId.value, sort.value));
const columns = computed(() => {
  const current =
    panelId.value === 'activity'
      ? { ...panel.value, columns: activityRankColumns(config.value.activity?.title) }
      : panel.value;
  return rankColumns(current, search.value);
});
const activityDesc = computed(() => String(config.value.activity?.desc ?? ''));
const pageLabel = computed(() => rankPageLabel(reply.value));
const updated = computed(() =>
  reply.value.updateTime > 0
    ? `${i18n('Rank_RankDialogSrc_5') || '更新时间：'}${rankUpdateTime(reply.value.updateTime, i18n)}`
    : '',
);
const canSearchMine = computed(() => panelId.value !== 'hero' && panelId.value !== 'rich');

function send(command: string, ...args: CommandArg[]): void {
  game.sendGlobalCommand('rank', command, args);
}

function reload(): void {
  search.value = { kind: null, value: '' };
  send('getPageRank', reply.value.page, type.value);
}

function loadConfig(): void {
  if (panelId.value === 'king' || panelId.value === 'activity') {
    send('getRankConfig', type.value);
  }
}

function switchPanel(id: RankPanelId): void {
  panelId.value = id;
  sort.value = 0;
  rewardEnabled.value = false;
  config.value = parseRankConfig(null);
  reply.value = parseRankReply(null);
  reload();
  loadConfig();
}

function changeSort(index: number): void {
  sort.value = index;
  rewardEnabled.value = false;
  reply.value = parseRankReply(null);
  reload();
  loadConfig();
}

function previousPage(): void {
  if (reply.value.page > 0) send('getPageRank', reply.value.page - 1, type.value);
}

function nextPage(): void {
  if (reply.value.page + 1 < reply.value.pageCount) {
    send('getPageRank', reply.value.page + 1, type.value);
  }
}

function findRank(): void {
  const rank = parseInt(searchRank.value, 10) || 0;
  if (rank <= 0) {
    void showAlert(i18n('Rank_RankDialogSrc_6') || '请输入正确的排名。');
    return;
  }
  search.value = { kind: 'rank', value: rank };
  send('getRankRank', rank, type.value);
}

function findName(): void {
  if (!searchName.value) {
    void showAlert(i18n('Rank_RankDialogSrc_7') || '请输入要查询的名称。');
    return;
  }
  search.value = { kind: 'name', value: searchName.value };
  send('getNameRank', searchName.value, type.value);
}

function findMine(): void {
  const union = panelId.value === 'union';
  if (union && game.user.unionid <= 0) {
    void showAlert(i18n('Rank_RankDialogSrc_8') || '你尚未加入联盟。');
    return;
  }
  const name = union ? game.user.unionname : game.user.username;
  search.value = { kind: 'name', value: name };
  send('getMyRank', name, type.value);
}

const unregister = game.addGlobalReceiver('rank', (command, data) => {
  if (command === 'getRankConfig') {
    const result = parseRankConfig(data);
    config.value = result;
    rewardEnabled.value = result.enabled;
    return;
  }
  if (command === 'getRankReward') {
    const result = parseRankReward(data);
    if (!result.ok) {
      void showAlert(result.message);
      return;
    }
    treasure.value = treasureItems(result.items);
    rewardEnabled.value = false;
    loadConfig();
    return;
  }
  const result = parseRankReply(data);
  if (result.type === type.value) reply.value = result;
});

onMounted(() => {
  send('getPageRank', 0, type.value);
  loadConfig();
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas
    :w="682"
    :h="492"
    style-name="PanelGreyGreen"
    :style="{ overflow: 'visible', zIndex: 50 }"
  >
    <FxImage :x="215" :y="12" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="16"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Rank_RankDialog_1_1') || '排行榜'"
    />
    <FxLabel :x="23" :y="21" :w="210" :text="updated" :fx="{ color: 15192461 }" />
    <FxText v-if="panelId === 'activity'" :x="475" :y="16" :w="180" :h="36" :text="activityDesc" />
    <FxButton
      v-for="(item, index) in RANK_PANELS"
      :key="item.id"
      :x="23 + index * 50"
      :y="50"
      :w="48"
      style-name="ButtonRed"
      :label="item.label"
      :selected="panelId === item.id"
      @click="switchPanel(item.id)"
    />
    <FxCanvas :x="423" :y="58" :w="85" :h="25" style-name="BoardListDown">
      <FxLabel
        :y="3"
        :w="85"
        :h="20"
        :text="pageLabel"
        :fx="{ color: 15192461, textAlign: 'center', fontWeight: 'bold' }"
      />
    </FxCanvas>
    <FxButton
      :x="520"
      :y="52"
      style-name="ButtonRed"
      :label="i18n('Rank_RankDialog_8_1') || '上一页'"
      @click="previousPage"
    />
    <FxButton
      :x="593"
      :y="52"
      style-name="ButtonRed"
      :label="i18n('Rank_RankDialog_9_1') || '下一页'"
      @click="nextPage"
    />
    <FxCanvas :x="23" :y="94" :w="632" :h="332" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="626"
        :h="326"
        :columns="columns"
        :rows="reply.rows"
        :row-height="30"
      />
    </FxCanvas>
    <template v-if="panelId !== 'activity'">
      <FxCanvas :x="23" :y="442" :w="75" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="searchRank"
          :x="3"
          :y="3"
          :w="70"
          :max-chars="6"
          restrict="0-9"
          style-name="EmptyTextInput"
          @enter="findRank"
        />
      </FxCanvas>
      <FxButton
        :x="106"
        :y="437"
        :w="80"
        :h="38"
        style-name="ButtonYellow"
        :label="i18n('Rank_RankDialog_10_1') || '查询排名'"
        @click="findRank"
      />
      <FxCanvas :x="197" :y="442" :w="116" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="searchName"
          :x="3"
          :y="3"
          :w="110"
          :max-chars="8"
          style-name="EmptyTextInput"
          @enter="findName"
        />
      </FxCanvas>
      <FxButton
        :x="321"
        :y="437"
        :w="80"
        :h="38"
        style-name="ButtonYellow"
        :label="i18n('Rank_RankDialog_11_1') || '查询名称'"
        @click="findName"
      />
    </template>
    <FxButton
      v-if="canSearchMine"
      :x="406"
      :y="437"
      :w="80"
      :h="38"
      style-name="ButtonGreen"
      :label="panelId === 'union' ? '本盟排名' : i18n('Rank_RankDialog_12_1') || '我的排名'"
      @click="findMine"
    />
    <FxButton
      v-if="panelId === 'king' || panelId === 'activity'"
      :x="496"
      :y="437"
      :w="80"
      :h="38"
      style-name="ButtonGreen"
      :enabled="rewardEnabled"
      :label="i18n('Task_TaskDialog_10_1') || '领取奖励'"
      @click="rewardEnabled && send('getRankReward', type)"
    />
    <template v-if="panel.sortLabels.length > 0">
      <FxLabel
        v-if="panelId !== 'activity'"
        :x="409"
        :y="446"
        :w="76"
        text="排列方式"
        style-name="ItemTitle"
      />
      <FxComboBox
        v-model:selected-index="sort"
        :x="panelId === 'activity' ? 308 : 493"
        :y="444"
        :w="90"
        :items="panel.sortLabels"
        @change="changeSort"
      />
    </template>
    <FxButton :x="594" :y="439" style-name="Close" @click="game.closeDialog()" />
    <TreasureGetDialog v-if="treasure" :items="treasure" @close="treasure = null" />
  </FxCanvas>
</template>
