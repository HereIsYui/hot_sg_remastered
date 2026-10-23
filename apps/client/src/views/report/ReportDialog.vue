<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import {
  parseReportDetail,
  parseReportList,
  reportPageLabel,
  type ReportItem,
} from '../../game/report';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import KingRewardPanel from './KingRewardPanel.vue';

/**
 * Report.ReportDialog: the 战报 dialog. The list panel (ReportListPanel) shows one report tab at a
 * time (`getReport`/`getUnreadReport`), with select-all / 删除 (`delReport`) and paging; a
 * double-click opens the detail panel (ReportDetailPanel) showing the report body — a battle
 * report (`battleid > 0`) fetches its rounds via `getReportDetail` and offers 查看战报 to open the
 * live 战斗 view, a plain report shows its HTML `content`. 领取奖励 (KingRewardPanel) sits on the
 * list. finishCommonExpr / finishMeetWife belong to the 历练 / 婚姻 modules (not ported) → 暂未开放.
 */
const game = useGame();
const d = (n: number) => i18n(`Report_ReportDialog_${n}_1`);
const src = (n: number) => i18n(`Report_ReportListPanelSrc_${n}`);

/** 战报分类标签 (type): -1 未读, 0 军情, 1 内政, 2 系统, 3 其它. */
const TABS = [
  { type: -1, label: 'Report_ReportDialog_3_1' },
  { type: 0, label: 'Report_ReportDialog_4_1' },
  { type: 1, label: 'Report_ReportDialog_5_1' },
  { type: 2, label: 'Report_ReportDialog_6_1' },
  { type: 3, label: 'Report_ReportDialog_7_1' },
] as const;

type View = 'list' | 'detail';
const view = ref<View>('list');
const currentType = ref(-1);
const page = ref(0);
const pageCount = ref(0);
const items = ref<ReportItem[]>([]);
const allSelected = ref(false);
const kingReward = ref(false);

/** The report opened in the detail panel. */
const detail = ref<ReportItem | null>(null);
const detailHtml = ref('');

const pageText = computed(() => reportPageLabel(pageCount.value, page.value));

function loadList(type = currentType.value): void {
  if (type !== currentType.value) {
    currentType.value = type;
    page.value = 0;
  }
  allSelected.value = false;
  const command = type < 0 ? 'getUnreadReport' : 'getReport';
  game.sendGlobalCommand('report', command, [type, page.value]);
}

function prevPage(): void {
  if (page.value > 0) {
    page.value--;
    loadList();
  }
}

function nextPage(): void {
  if (page.value < pageCount.value - 1) {
    page.value++;
    loadList();
  }
}

function selectAll(): void {
  for (const r of items.value) r.selected = true;
  if (items.value.length > 0) allSelected.value = true;
}

function deselectAll(): void {
  for (const r of items.value) r.selected = false;
  allSelected.value = false;
}

function deleteSelected(): void {
  const ids = items.value.filter((r) => r.selected).map((r) => r.id);
  if (ids.length > 0)
    game.sendGlobalCommand('report', 'delReport', [ids, currentType.value, page.value]);
  allSelected.value = false;
}

/** Double-click / 查看: open the detail panel. A battle report fetches its rounds. */
function openDetail(item: ReportItem): void {
  item.bold = false;
  detail.value = item;
  detailHtml.value = item.content;
  view.value = 'detail';
  if (item.battleid > 0) game.sendGlobalCommand('report', 'getReportDetail', [item.battleid]);
}

function backToList(): void {
  view.value = 'list';
  detail.value = null;
}

/** 查看战报: open the live 战斗 view for the battle this report came from. */
function viewBattle(): void {
  if (detail.value && detail.value.battleid > 0) {
    game.showBattle(detail.value.battleid);
  }
}

const unregister = game.addGlobalReceiver('report', (command, data) => {
  if (command === 'getReport' || command === 'getUnreadReport' || command === 'delReport') {
    const reply = parseReportList(data);
    pageCount.value = reply.pageCount;
    page.value = reply.page;
    items.value = reply.items;
  } else if (command === 'getReportDetail') {
    detailHtml.value = parseReportDetail(data).html;
  }
});

onMounted(() => loadList(-1));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="27" :y="54" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="15" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="19"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="d(1) || '战报'"
    />
    <FxButton
      :right="20"
      :top="12"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeReport()"
    />

    <!-- ========================= list ========================= -->
    <template v-if="view === 'list'">
      <!-- category tabs -->
      <FxButton
        v-for="(tab, i) in TABS"
        :key="tab.type"
        :x="23 + i * 75"
        :y="50"
        :w="73"
        :h="38"
        style-name="ButtonRed"
        :selected="currentType === tab.type"
        :label="i18n(tab.label)"
        @click="loadList(tab.type)"
      />
      <FxButton
        :x="410"
        :y="51"
        :w="90"
        :h="36"
        style-name="ButtonYellow"
        :label="d(9) || '领取奖励'"
        @click="kingReward = true"
      />

      <!-- paging -->
      <FxButton
        :x="520"
        :y="51"
        style-name="ButtonRed"
        :label="d(10) || '上一页'"
        @click="prevPage()"
      />
      <FxCanvas :x="455" :y="58" :w="60" :h="25" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="60"
          :h="20"
          :fx="{ color: 15192461, textAlign: 'center', fontWeight: 'bold' }"
          :text="pageText"
        />
      </FxCanvas>
      <FxButton
        :x="593"
        :y="51"
        style-name="ButtonRed"
        :label="d(11) || '下一页'"
        @click="nextPage()"
      />

      <!-- report list -->
      <FxCanvas :x="23" :y="94" :w="635" :h="332" style-name="BoardListDown">
        <FxCanvas :x="3" :y="3" :w="629" :h="24" :fx="{ fontWeight: 'bold', color: 15192461 }">
          <FxLabel :x="0" :w="40" :fx="{ textAlign: 'center' }" :text="src(50) || '选择'" />
          <FxLabel :x="40" :w="200" :fx="{ textAlign: 'center' }" :text="src(51) || '标题'" />
          <FxLabel :x="240" :w="105" :fx="{ textAlign: 'center' }" :text="src(52) || '来源'" />
          <FxLabel :x="345" :w="75" :fx="{ textAlign: 'center' }" :text="src(53) || '发生地'" />
          <FxLabel :x="420" :w="155" :fx="{ textAlign: 'center' }" :text="src(54) || '时间'" />
          <FxLabel :x="575" :w="55" :fx="{ textAlign: 'center' }" :text="src(55) || '查看'" />
        </FxCanvas>
        <FxCanvas :x="3" :y="30" :w="629" :h="298" scroll-y>
          <FxCanvas
            v-for="(r, i) in items"
            :key="r.id"
            :x="0"
            :y="i * 30"
            :w="626"
            :h="30"
            :style-name="i % 2 === 0 ? 'BoardListUp' : 'BoardListDown'"
          >
            <FxButton
              :x="12"
              :y="7"
              style-name="CheckBox"
              :selected="r.selected"
              @click="r.selected = !r.selected"
            />
            <FxLabel
              :x="40"
              :y="6"
              :w="200"
              :fx="{ textAlign: 'center', fontWeight: r.bold ? 'bold' : 'normal', color: r.color }"
              :text="r.titleName"
              hand
              @click="openDetail(r)"
            />
            <FxLabel
              :x="240"
              :y="6"
              :w="105"
              :fx="{ textAlign: 'center', color: 16777215 }"
              :text="`${r.origincity}${r.fromcid}`"
            />
            <FxLabel
              :x="345"
              :y="6"
              :w="75"
              :fx="{ textAlign: 'center', color: 16777215 }"
              :text="r.happencidLabel"
            />
            <FxLabel
              :x="420"
              :y="6"
              :w="155"
              :fx="{ textAlign: 'center', color: 16777215 }"
              :text="r.happentime"
            />
            <FxButton
              :x="583"
              :y="4"
              :w="44"
              :h="22"
              style-name="ButtonGreen"
              :label="src(55) || '查看'"
              @click="openDetail(r)"
            />
          </FxCanvas>
        </FxCanvas>
      </FxCanvas>

      <FxButton
        v-if="!allSelected"
        :x="352"
        :y="438"
        :w="80"
        :h="38"
        style-name="ButtonGreen"
        :label="d(12) || '全选'"
        @click="selectAll()"
      />
      <FxButton
        v-else
        :x="352"
        :y="438"
        :w="80"
        :h="38"
        style-name="ButtonGreen"
        :label="d(13) || '取消全选'"
        @click="deselectAll()"
      />
      <FxButton
        :x="440"
        :y="438"
        :w="80"
        :h="38"
        style-name="ButtonRed"
        :label="d(14) || '删除'"
        @click="deleteSelected()"
      />
    </template>

    <!-- ========================= detail ========================= -->
    <template v-else-if="detail">
      <FxCanvas :x="23" :y="50" :w="635" :h="376" style-name="BoardListDown">
        <!-- header -->
        <FxLabel
          :x="20"
          :y="12"
          :w="595"
          :h="20"
          :fx="{ fontWeight: 'bold', color: 16776960, textAlign: 'center' }"
          :text="detail.titleName"
        />
        <FxLabel
          :x="20"
          :y="38"
          :w="300"
          :fx="{ color: 15983262 }"
          :text="`${detail.origincity}${detail.fromcid}`"
        />
        <FxLabel
          :x="330"
          :y="38"
          :w="285"
          :fx="{ color: 15983262, textAlign: 'right' }"
          :text="detail.happentime"
        />
        <!-- body: HTML report content / concatenated battle rounds -->
        <FxCanvas :x="10" :y="64" :w="615" :h="300" style-name="BoardListDown">
          <FxText
            :x="6"
            :y="6"
            :w="603"
            :h="288"
            scroll
            :html="detailHtml"
            :fx="{ color: 15983262 }"
          />
        </FxCanvas>
      </FxCanvas>

      <!-- 查看战报: open the live battle view (battle reports only) -->
      <FxButton
        v-if="detail.battleid > 0"
        :x="388"
        :y="438"
        :w="90"
        :h="36"
        style-name="ButtonGreen"
        :label="d(8) || '查看战报'"
        @click="viewBattle()"
      />
      <FxButton :x="500" :y="438" style-name="Return" @click="backToList()" />
    </template>

    <KingRewardPanel v-if="kingReward" @close="kingReward = false" />
  </FxCanvas>
</template>
