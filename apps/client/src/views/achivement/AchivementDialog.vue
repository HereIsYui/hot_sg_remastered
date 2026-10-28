<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  ACHIVE_RANK_TYPES,
  parseAchiveRankReply,
  type AchiveRankReply,
} from '../../game/achivement';
import { useGame } from '../../game/game';
import { makeMailTime } from '../../game/mail';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Achivement/AchivementDialog (682x492): the 英雄成就 成就排行. `getPageRank` pages the ranking,
 * `getRankRank` / `getNameRank` / `getMyRank` search it, the combo switches 获得成就 / 成就点数,
 * and a row's 查看 (or double click) opens that lord's 个人成就 (`onViewUserDetail`,
 * AS3 674-684). The rank commands went out under the achivement action in the original; the
 * remade sends them to the `rank` module where the ported commands live.
 */
const game = useGame();

const reply = ref<AchiveRankReply>(parseAchiveRankReply(null));
const searchRank = ref('');
const searchName = ref('');
const sortIndex = ref(0);

const comboItems = [
  i18n('Achivement_AchivementDialog_12_1'),
  i18n('Achivement_AchivementDialog_13_1'),
];

const columns = computed(() => [
  { header: i18n('Achivement_AchivementDialog_9_1'), field: 'rank' as const, width: 90 },
  { header: i18n('Achivement_AchivementDialog_10_1'), field: 'name' as const, width: 125 },
  { header: i18n('Achivement_AchivementDialog_11_1'), field: 'union' as const, width: 125 },
  {
    header: i18n('Achivement_AchivementDialog_12_1'),
    field: 'achivement_count' as const,
    width: 125,
  },
  {
    header: i18n('Achivement_AchivementDialog_13_1'),
    field: 'achivement_point' as const,
    width: 145,
  },
  { header: '', field: 'view' as const, width: 68 },
]);

const pageLabel = computed(() =>
  reply.value.pageCount > 0 ? `${reply.value.page + 1}/${reply.value.pageCount}` : '0/0',
);

const updated = computed(() =>
  reply.value.updateTime > 0
    ? `${i18n('Rank_RankDialogSrc_5')}${makeMailTime(reply.value.updateTime, i18n)}`
    : '',
);

function send(command: string, args: CommandArg[]): void {
  game.sendGlobalCommand('rank', command, args);
}

const type = () => ACHIVE_RANK_TYPES[sortIndex.value] ?? ACHIVE_RANK_TYPES[0];

/** `AchivementDialog.reloadList` (AS3 1036-1052). */
function reload(): void {
  reply.value = parseAchiveRankReply(null);
  send('getPageRank', [reply.value.page, type()]);
}

/** `onChangeUnionSort` (AS3 719-725). */
function onSortChange(): void {
  reply.value = parseAchiveRankReply(null);
  send('getPageRank', [0, type()]);
}

function prevPage(): void {
  if (reply.value.page > 0) send('getPageRank', [reply.value.page - 1, type()]);
}

function nextPage(): void {
  if (reply.value.page + 1 < reply.value.pageCount) {
    send('getPageRank', [reply.value.page + 1, type()]);
  }
}

/** `searchRank` (AS3 1064-1079). */
async function findRank(): Promise<void> {
  const rank = parseInt(searchRank.value, 10) || 0;
  if (rank <= 0) {
    void showAlert(i18n('Rank_RankDialogSrc_6'));
    return;
  }
  send('getRankRank', [rank, type()]);
}

/** `searchUserRank` (AS3 727-742). */
function findName(): void {
  if (!searchName.value) {
    void showAlert(i18n('Rank_RankDialogSrc_7'));
    return;
  }
  send('getNameRank', [searchName.value, type()]);
}

/** `searchMyRank` (AS3 992-1002). */
function findMine(): void {
  send('getMyRank', [game.user.username, type()]);
}

/** `onViewUserDetail` (AS3 674-684): the lord's 个人成就 over this dialog. */
function viewUser(row: Record<string, unknown>): void {
  const userid = parseInt(String(row.userid ?? row.uid ?? 0), 10) || 0;
  const username = String(row.name ?? '');
  if (userid > 0) game.openUserAchievement(userid, username);
}

function onRowClick(row: Record<string, unknown>): void {
  viewUser(row);
}

/** The rank replies (`AchivementDialog.onCommand`, AS3 804-871). */
const unregister = game.addGlobalReceiver('rank', (command, data) => {
  if (!['getPageRank', 'getRankRank', 'getMyRank', 'getNameRank'].includes(command)) return;
  const result = parseAchiveRankReply(data);
  if (result.type === type()) reply.value = result;
});

onMounted(reload);
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="10" source="images/title.png" />
    <FxLabel
      :x="313"
      :y="15"
      :fx="{ color: 16777215 }"
      :text="i18n('Achivement_AchivementDialog_1_1')"
    />
    <FxLabel :x="23" :y="21" :w="236" :fx="{ color: 15192461 }" :text="updated" />
    <FxButton
      :x="23"
      :y="50"
      :w="100"
      style-name="ButtonRed"
      :label="i18n('Achivement_AchivementDialog_3_1')"
      @click="game.openUserAchievement()"
    />
    <FxCanvas :x="421" :y="56" :w="80" :h="25" style-name="BoardListDown">
      <FxLabel
        :y="3"
        :w="80"
        :h="20"
        :fx="{ color: 15192461, textAlign: 'center', fontWeight: 'bold' }"
        :text="pageLabel"
      />
    </FxCanvas>
    <FxButton :x="512" :y="50" :label="i18n('Achivement_AchivementDialog_4_1')" @click="prevPage" />
    <FxButton :x="586" :y="49" :label="i18n('Achivement_AchivementDialog_5_1')" @click="nextPage" />
    <FxCanvas :x="20" :y="90" :w="642" :h="331" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="636"
        :h="325"
        :columns="columns"
        :rows="reply.rows"
        :row-height="30"
        selectable
        @item-click="onRowClick"
      >
        <template #cell="{ row, column }">
          <FxButton
            v-if="column.field === 'view'"
            :x="3"
            :y="2"
            :w="50"
            :h="27"
            style-name="ButtonRed"
            :label="i18n('Achivement_AchivementDialog_14_1')"
            @click="viewUser(row)"
          />
          <span v-else>{{ row[column.field] }}</span>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxCanvas :x="20" :y="443" :w="80" :h="26" style-name="BoardListDown">
      <FxTextInput
        v-model="searchRank"
        :x="3"
        :y="3"
        :w="74"
        :max-chars="6"
        restrict="0-9"
        style-name="EmptyTextInput"
        @enter="findRank"
      />
    </FxCanvas>
    <FxButton
      :x="106"
      :y="438"
      :w="80"
      :h="38"
      style-name="ButtonRed"
      :label="i18n('Achivement_AchivementDialog_6_1')"
      @click="findRank"
    />
    <FxCanvas :x="194" :y="443" :w="125" :h="26" style-name="BoardListDown">
      <FxTextInput
        v-model="searchName"
        :x="3"
        :y="3"
        :w="119"
        style-name="EmptyTextInput"
        @enter="findName"
      />
    </FxCanvas>
    <FxButton
      :x="327"
      :y="438"
      :w="80"
      :h="38"
      style-name="ButtonRed"
      :label="i18n('Achivement_AchivementDialog_7_1')"
      @click="findName"
    />
    <FxButton
      :x="411"
      :y="438"
      :w="80"
      :h="38"
      style-name="ButtonRed"
      :label="i18n('Achivement_AchivementDialog_8_1')"
      @click="findMine"
    />
    <FxComboBox
      v-model:selected-index="sortIndex"
      :x="493"
      :y="444"
      :w="90"
      :items="comboItems"
      @change="onSortChange"
    />
    <FxButton :x="596" :y="438" style-name="Return" @click="game.closeDialog()" />
  </FxCanvas>
</template>
