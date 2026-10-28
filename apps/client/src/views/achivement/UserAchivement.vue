<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onUnmounted, ref } from 'vue';
import {
  achieveGroupNames,
  ACHIVE_PROGRESS_ORDER,
  parseAchiveDetail,
  parseAchivementsByGroup,
  parseOverviewStat,
  type AchiveGuideView,
  type AchiveRow,
} from '../../game/achivement';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useSessionStore } from '../../stores/session';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import AchieveGuide from './AchieveGuide.vue';
import AchieveItem from './AchieveItem.vue';
import AchieveProgress from './AchieveProgress.vue';

/**
 * Achivement/UserAchivement (682x492): the 个人成就 page. The left list picks 总览 or one of the
 * groups; the overview shows the two recent achievements and the per-group 进展总览
 * (getOverviewStat); a group shows its 5-per-page list (getAchivementsByGroup with the
 * 全部/获得/未完成 combo); a row opens the 成就指南 (getAchivementDetail). 英雄成就 opens the
 * 成就排行 (`showAchievementRank`, AS3 1677-1681).
 */
const props = defineProps<{ userid: number; username: string }>();

const game = useGame();
const session = useSessionStore();

const profile = ref(parseOverviewStat(null));
const groupRows = ref<AchiveRow[]>([]);
const guide = ref<AchiveGuideView | null>(null);
/** The visible canvas: profileCanvas / groupCanvas / achieveGuideCanvas. */
const view = ref<'profile' | 'group' | 'guide'>('profile');
/** The canvas `onReturn` goes back to (`mCurrentCanvas`). */
const returnTo = ref<'profile' | 'group'>('profile');

const groupNames = achieveGroupNames();
const selectedGroup = ref(0);
const comboIndex = ref(0);
const page = ref(0);
const pageCount = ref(1);

const comboItems = [
  i18n('Achivement_UserAchivement_16'),
  i18n('Achivement_UserAchivement_17'),
  i18n('Achivement_UserAchivement_18'),
];

const groupListColumns = [{ header: '', field: 'name' as const, width: 119 }];
const groupListRows = computed(() => groupNames.map((name) => ({ name })));

/** Progress rows of the 总览, in the fixed layout order, looked up by group_name. */
const progressRows = computed(() => {
  const byName = new Map(profile.value.groups.map((g) => [g.groupName, g]));
  return ACHIVE_PROGRESS_ORDER.map((key) => {
    const name = i18n(key);
    const group = byName.get(name);
    return {
      key,
      name,
      current: group?.finishCount ?? 0,
      total: group?.totalCount ?? 0,
    };
  });
});

/** `UserAchivement.setTotalProgress`: the 410px bar and the `已获得成就 f/t` label. */
const totalFill = computed(() =>
  profile.value.total > 0 ? Math.trunc((410 * profile.value.finished) / profile.value.total) : 0,
);
const totalLabel = computed(
  () => `${i18n('Achivement_UserAchivement_20')}${profile.value.finished}/${profile.value.total}`,
);

const pageLabel = computed(() =>
  pageCount.value > 0 ? `${page.value + 1}/${pageCount.value}` : '0/0',
);

function send(command: string, args: CommandArg[]): void {
  game.sendGlobalCommand('achivement', command, args);
}

/** `UserAchivement.reloadAchivementsByGroup` (AS3 1453-1470). */
function reloadGroup(): void {
  send('getAchivementsByGroup', [
    props.userid,
    selectedGroup.value,
    0,
    comboIndex.value,
    page.value,
  ]);
}

/** `UserAchivement.onAchieveGroupList` (AS3 1260-1272): row 0 is 总览. */
function onGroupRow(_row: unknown, index: number): void {
  selectedGroup.value = index;
  if (index === 0) {
    view.value = 'profile';
    returnTo.value = 'profile';
  } else {
    page.value = 0;
    returnTo.value = 'group';
    reloadGroup();
  }
}

/** `UserAchivement.achieveItemClick` → `reloadAchivementDetail` (AS3 1481-1484, 1593-1599). */
function onItemOpen(id: number): void {
  send('getAchivementDetail', [props.userid, id]);
}

/** `onPrevPage` / `onNextPage` (AS3 1000-1007, 1601-1616). */
function prevPage(): void {
  if (page.value > 0) {
    page.value -= 1;
    reloadGroup();
  }
}

function nextPage(): void {
  if (page.value < pageCount.value - 1) {
    page.value += 1;
    reloadGroup();
  }
}

/** `onComboBoxChange` (AS3 1618-1623). */
function onComboChange(): void {
  page.value = 0;
  reloadGroup();
}

/** `showAchievementRank` (AS3 1677-1681). */
function openRank(): void {
  session.dialog = { name: 'achievementRank' };
}

/** `onReturn` (AS3 1997-2005). */
function onReturn(): void {
  if (view.value === 'guide') view.value = returnTo.value;
}

/** The global replies of the `achivement` action (AchivementDialog.onCommand forwarding). */
const unregister = game.addGlobalReceiver('achivement', (command, data) => {
  if (command === 'getOverviewStat') {
    profile.value = parseOverviewStat(data);
    view.value = 'profile';
    returnTo.value = 'profile';
    selectedGroup.value = 0;
  } else if (command === 'getAchivementsByGroup') {
    const parsed = parseAchivementsByGroup(data);
    pageCount.value = parsed.pageCount;
    if (parsed.pageCount === 0) page.value = -1;
    groupRows.value = parsed.rows;
    view.value = 'group';
  } else if (command === 'getAchivementDetail') {
    guide.value = parseAchiveDetail(data);
    if (guide.value) view.value = 'guide';
  }
});

onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="12" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="17"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Achivement_UserAchivement_1')"
    />
    <FxLabel
      :x="29"
      :y="61"
      :w="54"
      :h="25"
      :fx="{ color: 65280, fontWeight: 'bold' }"
      :text="i18n('Achivement_UserAchivement_2')"
    />
    <FxCanvas :x="73" :y="59" :w="120" :h="25" style-name="BoardListDown">
      <FxLabel
        :left="0"
        :right="0"
        :top="3"
        :bottom="4"
        style-name="ItemValue"
        :fx="{ textAlign: 'center' }"
        :text="username"
      />
    </FxCanvas>
    <FxLabel
      :x="501"
      :y="61"
      :w="131"
      :h="25"
      :fx="{ color: 65280, fontWeight: 'bold' }"
      :text="i18n('Achivement_UserAchivement_3')"
    />
    <FxCanvas :x="572" :y="59" :w="84" :h="25" style-name="BoardListDown">
      <FxLabel
        :left="0"
        :right="0"
        :top="3"
        :bottom="4"
        style-name="ItemValue"
        :fx="{ textAlign: 'center' }"
        :text="String(profile.point)"
      />
    </FxCanvas>

    <!-- the group list -->
    <FxCanvas :x="30" :y="97" :w="125" :h="339" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="2"
        :w="119"
        :h="336"
        :columns="groupListColumns"
        :rows="groupListRows"
        :row-height="24"
        :header-height="0"
        selectable
        :selected-index="selectedGroup"
        @item-click="onGroupRow"
      />
    </FxCanvas>

    <!-- profileCanvas: the overview -->
    <FxCanvas v-if="view === 'profile'" :x="162" :y="97" :w="493" :h="339" style-name="BoardListUp">
      <FxLabel
        :left="0"
        :right="0"
        :top="8"
        :w="81"
        :fx="{ color: 14930449, textAlign: 'center', fontWeight: 'bold', fontSize: 14 }"
        :text="i18n('Achivement_UserAchivement_4')"
      />
      <AchieveItem
        v-for="(row, i) in profile.recent.slice(0, 2)"
        :key="String(row.id ?? i)"
        :row="row"
        :style="{ left: '10px', top: `${36 + i * 58}px`, width: '473px' }"
        @click="onItemOpen"
      />
      <FxLabel
        :left="0"
        :right="0"
        :top="145"
        :w="81"
        :fx="{ color: 14930449, textAlign: 'center', fontWeight: 'bold', fontSize: 14 }"
        :text="i18n('Achivement_UserAchivement_5')"
      />
      <FxCanvas :x="10" :y="167" :w="473" :h="166" style-name="BoardListDown">
        <AchieveProgress
          v-for="(row, i) in progressRows.slice(0, 4)"
          :key="row.key"
          :info-label="row.name"
          :current="row.current"
          :total="row.total"
          :style="{ right: '262px', width: '220px', top: `${16 + i * 25}px` }"
        />
        <AchieveProgress
          v-for="(row, i) in progressRows.slice(4)"
          :key="row.key"
          :info-label="row.name"
          :current="row.current"
          :total="row.total"
          :style="{ right: '22px', width: '230px', top: `${16 + i * 25}px` }"
        />
        <!-- the total bar (ProfileProgress) -->
        <div class="total-track">
          <div class="total-fill" :style="{ width: `${totalFill}px` }" />
          <span class="total-label">{{ totalLabel }}</span>
        </div>
      </FxCanvas>
    </FxCanvas>

    <!-- groupCanvas: the paged list of one group -->
    <FxCanvas
      v-else-if="view === 'group'"
      :x="162"
      :y="97"
      :w="493"
      :h="339"
      style-name="BoardListUp"
    >
      <FxComboBox
        v-model:selected-index="comboIndex"
        :x="10"
        :y="6"
        :w="100"
        :items="comboItems"
        @change="onComboChange"
      />
      <FxCanvas :x="303" :y="6" :w="55" :h="25" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="55"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="pageLabel"
        />
      </FxCanvas>
      <FxButton
        :x="358"
        :y="2"
        :w="65"
        :label="i18n('Achivement_UserAchivement_13')"
        @click="prevPage"
      />
      <FxButton
        :x="421"
        :y="2"
        :w="65"
        :label="i18n('Achivement_UserAchivement_14')"
        @click="nextPage"
      />
      <AchieveItem
        v-for="(row, i) in groupRows.slice(0, 5)"
        :key="String(row.id ?? i)"
        :row="row"
        :style="{ left: '10px', top: `${41 + 58 * i}px`, width: '473px' }"
        @click="onItemOpen"
      />
    </FxCanvas>

    <!-- achieveGuideCanvas: the detail -->
    <FxCanvas v-else :x="162" :y="97" :w="493" :h="339" style-name="BoardListUp">
      <AchieveGuide :view="guide" :style="{ left: '20px', top: '33px' }" />
    </FxCanvas>

    <FxButton
      :x="591"
      :y="442"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <FxButton
      v-if="view === 'guide'"
      :x="526"
      :y="442"
      :fx="{ fontSize: 16 }"
      :label="i18n('Achivement_UserAchivement_15')"
      @click="onReturn"
    />
    <FxButton
      :x="28"
      :y="442"
      :w="80"
      :h="38"
      :fx="{ fontSize: 14 }"
      :label="i18n('Achivement_UserAchivement_21')"
      @click="openRank"
    />
  </FxCanvas>
</template>

<style scoped>
.total-track {
  position: absolute;
  left: 23px;
  right: 22px;
  top: 140px;
  height: 18px;
  border: 1px solid #555;
  background: #000;
}

.total-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #3090d0;
}

.total-label {
  position: absolute;
  left: 1px;
  right: 1px;
  top: 0;
  color: #e3e3d1;
  text-align: center;
  font-size: 12px;
}
</style>
