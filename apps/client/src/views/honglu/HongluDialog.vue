<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { parseHongluBuildingInfo, type HongluInfo } from '../../game/honglu';
import { makeEndTimeString, makeTimeLeftString } from '../../game/troop';
import { makeCid } from '../../game/world';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();
const game = useGame();
const info = ref<HongluInfo>(parseHongluBuildingInfo(null));
const now = ref(serverTime());
let timer: ReturnType<typeof setInterval> | undefined;

const columns = [
  { header: i18n('Honglu_HongluPanel_2_1') || '将领', field: 'hero' as const, width: 100 },
  { header: i18n('Honglu_HongluPanel_3_1') || '君主', field: 'username' as const, width: 100 },
  { header: i18n('Honglu_HongluPanel_4_1') || '出发地', field: 'cid' as const, width: 80 },
  { header: i18n('Honglu_HongluPanel_5_1') || '到达时间', field: 'endtime' as const, width: 130 },
  { header: i18n('Honglu_HongluPanel_6_1') || '停留时间', field: 'staytime' as const, width: 130 },
  { header: i18n('Honglu_HongluPanel_7_1') || '命令', field: 'command' as const, width: 110 },
];

function onReply(data: unknown[], ttype: number): void {
  if (ttype === 0) {
    info.value = parseHongluBuildingInfo(data);
  } else if (ttype === 1) {
    info.value.allowUnionTroop = Number(data[0]) === 1;
  } else if (ttype === 2) {
    info.value.allowAntiPlunder = Number(data[0]) === 1;
  } else if (ttype === 3) {
    info.value.allowAntiInvade = Number(data[0]) === 1;
  }
}

onMounted(() => (timer = setInterval(() => (now.value = serverTime()), 1000)));
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
    @reply-ttype="onReply"
  >
    <template #default="{ send }">
      <FxCanvas :x="18" :y="125" :w="656" :h="322" :fx="{ fontSize: 12, backgroundAlpha: 0 }">
        <FxButton
          :x="209"
          :y="2"
          :w="83"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Honglu_HongluPanel_1_1') || '进入联盟'"
          @click="game.openUnion()"
        />
        <FxCanvas :x="0" :y="75" :w="656" :h="242" style-name="BoardListUp">
          <FxDataGrid
            :x="3"
            :y="3"
            :w="650"
            :h="236"
            :columns="columns"
            :rows="info.troops"
            :row-height="30"
          >
            <template #cell="{ row, column }">
              <FxButton
                v-if="column.field === 'command'"
                :x="20"
                :y="1"
                :w="50"
                :h="27"
                style-name="ButtonRed"
                :label="i18n('Honglu_HongluPanel_8_1') || '查看'"
                @click="game.showTroopDetail(row, 'union')"
              />
              <span v-else-if="column.field === 'cid'">{{ makeCid(row.cid) }}</span>
              <span v-else-if="column.field === 'endtime'">{{
                makeEndTimeString(row.endtime, now)
              }}</span>
              <span v-else-if="column.field === 'staytime'">{{
                makeTimeLeftString(now - row.endtime)
              }}</span>
              <span v-else>{{ row[column.field] }}</span>
            </template>
          </FxDataGrid>
        </FxCanvas>
        <FxCanvas :x="2" :y="6" :w="200" :h="30" style-name="BoardListUp">
          <FxLabel
            :x="5"
            :y="5"
            :w="75"
            style-name="ItemTitle"
            :text="i18n('Honglu_HongluPanel_9_1') || '所属联盟:'"
          />
          <FxLabel :x="76" :y="5" :w="118" :text="info.unionName" />
        </FxCanvas>
        <FxCanvas :x="2" :y="38" :w="200" :h="30" style-name="BoardListUp">
          <FxLabel
            :x="5"
            :y="5"
            :w="122"
            style-name="ItemTitle"
            :text="i18n('Honglu_HongluPanel_10_1') || '盟友进驻本城军队:'"
          />
          <FxLabel :x="123" :y="5" :w="70" :text="`(${info.troops.length}/${building.level})`" />
        </FxCanvas>
        <label
          class="permission"
          style="left: 210px; top: 41px; width: 106px"
          :title="i18n('Honglu_HongluPanel_12_1')"
        >
          <input
            v-model="info.allowUnionTroop"
            type="checkbox"
            @change="send('allowUnionTroop', [info.allowUnionTroop ? 1 : 0], 1)"
          />
          {{ i18n('Honglu_HongluPanel_11_1') || '允许盟友驻军' }}
        </label>
        <label
          class="permission"
          style="left: 324px; top: 41px; width: 106px"
          :title="i18n('Honglu_HongluPanel_14_1')"
        >
          <input
            v-model="info.allowAntiPlunder"
            type="checkbox"
            @change="send('allowAntiPlunder', [info.allowAntiPlunder ? 1 : 0], 2)"
          />
          {{ i18n('Honglu_HongluPanel_13_1') || '盟军反掠城' }}
        </label>
        <label
          class="permission"
          style="left: 420px; top: 41px; width: 106px"
          :title="i18n('Honglu_HongluPanel_16_1')"
        >
          <input
            v-model="info.allowAntiInvade"
            type="checkbox"
            @change="send('allowAntiInvade', [info.allowAntiInvade ? 1 : 0], 3)"
          />
          {{ i18n('Honglu_HongluPanel_15_1') || '盟军反占领' }}
        </label>
      </FxCanvas>
    </template>
  </UpgradeBuildingDialog>
</template>

<style scoped>
.permission {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  cursor: pointer;
}
.permission input {
  margin: 0;
}
</style>
