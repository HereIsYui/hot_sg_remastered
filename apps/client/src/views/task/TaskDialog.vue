<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { flexHtml } from '../../core/flexHtml';
import { useGame } from '../../game/game';
import {
  DROPPABLE_TYPES,
  groupDetailHtml,
  groupLabel,
  parseGroups,
  parseTasks,
  pickGroup,
  pickTask,
  taskDetail,
  taskLabel,
  type TaskGroup,
  type TaskNames,
  type TaskRow,
} from '../../game/task';
import { i18n } from '../../i18n';
import { useGlobalStore } from '../../stores/global';
import { useUserStore } from '../../stores/user';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import MultiRewardCanvas from './MultiRewardCanvas.vue';

/**
 * Task.TaskDialog: task kinds as tabs, the kind's groups and their tasks, and the selected
 * one's description. The 任务进度 dialog, commission tasks, and picking a hero or gear for a
 * reward are not ported.
 */
const game = useGame();
const global = useGlobalStore();
const user = useUserStore();
const t = (n: number) => i18n(`Task_TaskDialog_${n}_1`);
const src = (n: number | string) => i18n(`Task_TaskDialogSrc_${n}`);

/** Tab buttons: x and task kind. */
const TABS: { x: number; type: number; label: number }[] = [
  { x: 21, type: 0, label: 2 },
  { x: 101, type: 1, label: 3 },
  { x: 179, type: 3, label: 6 },
  { x: 257, type: 2, label: 5 },
  { x: 335, type: 5, label: 14 },
  { x: 413, type: 7, label: 15 },
  { x: 491, type: 6, label: 7 },
];
const BOTTOM_BUTTON = { fontWeight: 'bold', fontSize: 14 } as const;

const names = computed<TaskNames>(() => ({
  soldiers: global.soldierNames,
  defences: global.defenceNames,
  things: global.thingsNames,
  officepos: global.officeposNames,
  nobility: global.nobilityNames,
}));

const taskType = ref(remembered.type);
let lastTaskType = 0;
const groups = ref<TaskGroup[]>([]);
const groupIndex = ref(-1);
let lastGroupId = 0;
/** `mTaskGroupSelected`: the group (not one of its tasks) was picked last. */
const groupSelected = ref(false);
const tasks = ref<TaskRow[]>([]);
const taskIndex = ref(-1);
let lastTaskIndex = -1;
const content = ref<string | null>(null);
const contentText = ref('');
const taskId = ref(0);
const canGetReward = ref(false);
const showMulti = ref(false);
const multiOpen = ref(false);
/** `randomTaskRefreshTime`: lord task refreshes today. */
let refreshCount = 0;

const droppable = computed(() => DROPPABLE_TYPES.includes(taskType.value));
/** `checkDropEnable`: lord tasks drop a task, the others a group. */
const dropEnabled = computed(() =>
  taskType.value === 7 ? groups.value.length > 0 && !groupSelected.value : groupSelected.value,
);

function setHtml(html: string) {
  content.value = html;
}

function setText(text: string) {
  content.value = null;
  contentText.value = text;
}

function getTaskGroupList() {
  game.sendGlobalCommand('task', 'getTaskTypeGroupList', [taskType.value]);
}

function onGetTaskGroupList(data: unknown) {
  const d = Array.isArray(data) ? (data as unknown[]) : [];
  canGetReward.value = false;
  groups.value = parseGroups(d[0]);
  if (taskType.value === 7) refreshCount = Number(d.at(-1) ?? 0) || 0;
  if (taskType.value !== lastTaskType && groups.value.length > 0) lastGroupId = -1;
  const pick = pickGroup(groups.value, lastGroupId);
  if (pick.id !== lastGroupId) lastTaskIndex = -1;
  lastGroupId = pick.id;
  if (groups.value.length > 0) {
    showTaskGroup(lastGroupId);
    groupSelected.value = true;
  } else {
    groupSelected.value = false;
    tasks.value = [];
    setText(src(taskType.value === 7 ? '31_5' : 31));
  }
  groupIndex.value = pick.index;
  lastTaskType = taskType.value;
}

function showTaskGroup(id: number) {
  const group = groups.value.find((g) => g.id === id);
  if (!group) return;
  setHtml(groupDetailHtml(group));
  game.sendGlobalCommand('task', 'getTaskList', [id]);
}

function onGetTaskList(data: unknown) {
  const d = Array.isArray(data) ? (data as unknown[]) : [];
  tasks.value = parseTasks(d[0]);
  if (tasks.value.length === 0) {
    setText(src(33));
    taskIndex.value = -1;
    return;
  }
  lastTaskIndex = pickTask(tasks.value, lastTaskIndex);
  taskIndex.value = lastTaskIndex;
  showTaskDetail(lastTaskIndex);
}

function showTaskDetail(index: number) {
  const task = tasks.value[Math.min(index, tasks.value.length - 1)];
  if (task) game.sendGlobalCommand('task', 'getTaskDetail', [task.id]);
}

function onGetTaskDetail(data: unknown) {
  const detail = taskDetail(data, taskType.value, names.value);
  if (!detail) return;
  setHtml(detail.html);
  taskId.value = detail.id;
  canGetReward.value = detail.finished;
  showMulti.value = detail.multi;
}

function onGetReward(data: unknown) {
  const d = Array.isArray(data) ? (data as unknown[]) : [];
  canGetReward.value = false;
  if (parseInt(String(d[0]), 10) === 1) gameAlert(src(55));
  else void showAlert(String(d[1] ?? ''));
  tasks.value = [];
  setHtml('');
  getTaskGroupList();
}

function onClickTaskGroup(group: TaskGroup, index: number) {
  lastGroupId = group.id;
  canGetReward.value = false;
  groupSelected.value = true;
  groupIndex.value = index;
  showTaskGroup(group.id);
}

function onClickTask(_task: TaskRow, index: number) {
  showTaskDetail(index);
  groupSelected.value = false;
  lastTaskIndex = index;
  taskIndex.value = index;
}

function switchPanel(type: number) {
  if (type === taskType.value) return;
  lastGroupId = 0;
  taskType.value = type;
  remembered.type = type;
  showMulti.value = false;
  getTaskGroupList();
}

function onClickGetReward() {
  if (taskId.value > 0) {
    game.sendGlobalCommand('task', 'getReward', [taskId.value, lastGroupId]);
  } else {
    void showAlert(src(54));
  }
}

function onClickGetMultiReward() {
  if (taskId.value > 0) multiOpen.value = true;
  else void showAlert(src(53));
}

function getMultiReward(count: number) {
  multiOpen.value = false;
  if (Number.isNaN(count) || count <= 0) {
    void showAlert(src(50));
    return;
  }
  game.sendGlobalCommand('task', 'getMultiReward', [taskId.value, count]);
}

/** `onClickMoreRewardTask`: only the lord tasks can be refreshed here. */
async function onClickMoreRewardTask() {
  if (taskType.value !== 7) return;
  const question = i18n('Hotel_HotelRecruitPanelSrc_8')
    .replace('x', String(refreshCount + 1))
    .replace('X*20', String(refreshCount > 0 ? 20 : 0));
  if ((await showAlert(question, '', ['yes', 'no'])) !== 'yes') return;
  if (refreshCount * 20 > user.money) {
    void showAlert(i18n('Hotel_HotelRecruitPanelSrc_7'));
    return;
  }
  game.sendGlobalCommand('task', 'refreshSysTask', [taskType.value]);
}

async function onClickDropTask() {
  const type = taskType.value;
  const question =
    type === 2 ? src(lastGroupId % 10 === 1 ? 57 : 51) : type === 4 ? src(52) : src('52_2');
  if ((await showAlert(question, '', ['yes', 'no'])) !== 'yes') return;
  if (type === 7) game.sendGlobalCommand('task', 'dropSysTask', [taskId.value]);
  else game.sendGlobalCommand('task', 'dropTask', [lastGroupId, type]);
}

const unregister = game.addGlobalReceiver('task', (command, data) => {
  if (
    command === 'getTaskTypeGroupList' ||
    command === 'refreshSysTask' ||
    command === 'dropTask' ||
    command === 'dropSysTask'
  ) {
    onGetTaskGroupList(data);
  } else if (command === 'getTaskList') onGetTaskList(data);
  else if (command === 'getTaskDetail') onGetTaskDetail(data);
  else if (command === 'getReward' || command === 'getMultiReward') onGetReward(data);
});
onMounted(getTaskGroupList);
onUnmounted(unregister);
</script>

<script lang="ts">
/** The dialog object outlived its closing: it reopens on the last kind shown. */
const remembered = { type: 0 };
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="12" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="16"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="t(1)"
    />
    <FxButton
      v-for="tab in TABS"
      :key="tab.type"
      :x="tab.x"
      :y="41"
      :w="75"
      style-name="ButtonGreen"
      :label="t(tab.label)"
      :selected="taskType === tab.type"
      @click="switchPanel(tab.type)"
    />
    <FxButton
      v-if="taskType === 3"
      :x="314"
      :bottom="10"
      :w="85"
      style-name="ButtonYellow"
      :fx="BOTTOM_BUTTON"
      :label="t(8)"
      :enabled="false"
    />
    <FxButton
      v-if="showMulti"
      :x="407"
      :bottom="10"
      :w="85"
      style-name="ButtonGreen"
      :fx="BOTTOM_BUTTON"
      :label="t(9)"
      :enabled="canGetReward"
      @click="onClickGetMultiReward"
    />
    <FxButton
      :x="500"
      :bottom="10"
      :w="85"
      style-name="ButtonGreen"
      :fx="BOTTOM_BUTTON"
      :label="t(10)"
      :enabled="canGetReward"
      @click="onClickGetReward"
    />
    <template v-if="droppable">
      <FxButton
        :x="21"
        :bottom="10"
        :w="85"
        style-name="ButtonRed"
        :fx="BOTTOM_BUTTON"
        :label="t(11)"
        :enabled="dropEnabled"
        @click="onClickDropTask"
      />
      <FxButton
        :x="106"
        :bottom="10"
        :w="85"
        style-name="ButtonRed"
        :fx="BOTTOM_BUTTON"
        :label="t(12)"
        @click="onClickMoreRewardTask"
      />
    </template>
    <FxButton
      :x="593"
      :bottom="9"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <FxCanvas :x="21" :y="79" :w="147" :h="226" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="141"
        :h="220"
        :row-height="20"
        :columns="[{ header: 'groupname', field: 'name', width: 141 }]"
        :rows="groups"
        selectable
        :selected-index="groupIndex"
        @item-click="onClickTaskGroup"
      >
        <template #cell="{ row }">
          <span class="group" v-html="flexHtml(groupLabel(row))" />
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxCanvas :x="176" :y="79" :w="483" :h="366" style-name="BoardListUp">
      <FxText
        :left="10"
        :right="8"
        :top="4"
        :bottom="4"
        scroll
        :html="content"
        :text="contentText"
      />
    </FxCanvas>
    <FxCanvas :x="21" :y="312" :w="147" :h="133" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="141"
        :h="127"
        :row-height="20"
        :columns="[{ header: '', field: 'name', width: 141 }]"
        :rows="tasks"
        selectable
        :selected-index="taskIndex"
        @item-click="onClickTask"
      >
        <template #cell="{ row }">{{ taskLabel(row) }}</template>
      </FxDataGrid>
    </FxCanvas>
    <MultiRewardCanvas
      v-if="multiOpen"
      :x="130"
      :y="110"
      @get="getMultiReward"
      @close="multiOpen = false"
    />
  </FxCanvas>
</template>

<style scoped>
.group {
  color: #ffff00;
  font-weight: bold;
}
</style>
