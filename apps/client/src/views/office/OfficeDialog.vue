<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { officeHeroRows, parseRestHeroes } from '../../game/office';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import HeroExprDialog from '../government/HeroExprDialog.vue';
import OfficeCallbackDialog from './OfficeCallbackDialog.vue';
import OfficeChiefDialog from './OfficeChiefDialog.vue';
import OfficeRestDialog from './OfficeRestDialog.vue';

defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();
const game = useGame();
const heroes = ref<Record<string, unknown>[]>([]);
const rows = ref<ReturnType<typeof officeHeroRows>>([]);
const exile = ref<Record<string, unknown>[]>([]);
const rest = ref<Record<string, unknown>[]>([]);
const recallNeed = ref('');
const popup = ref<'chief' | 'callback' | 'rest' | 'expr' | null>(null);

const columns = [
  { header: i18n('Office_OfficeHeroPanel_5_1') || '将领', field: 'name' as const, width: 70 },
  { header: i18n('Office_OfficeHeroPanel_6_1') || '等级', field: 'level' as const, width: 45 },
  { header: i18n('Office_OfficeHeroPanel_7_1') || '统率', field: 'command' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_8_1') || '体力', field: 'force' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_9_1') || '精力', field: 'energy' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_10_1') || '内政', field: 'affairs' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_11_1') || '勇武', field: 'bravery' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_12_1') || '智谋', field: 'wisdom' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_13_1') || '忠诚', field: 'loyalty' as const, width: 55 },
  { header: i18n('Office_OfficeHeroPanel_14_1') || '状态', field: 'stateText' as const, width: 60 },
  { header: '', field: 'view' as const, width: 56 },
];

function refreshRows(): void {
  rows.value = officeHeroRows(heroes.value, serverTime());
}

function onReply(data: unknown[], ttype: number): void {
  if (ttype === 0) {
    heroes.value = Array.isArray(data[2]) ? (data[2] as Record<string, unknown>[]) : [];
    refreshRows();
  } else if (ttype === 5) {
    recallNeed.value = String(data[1] ?? '');
  } else if (ttype === 6) {
    heroes.value = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    refreshRows();
    popup.value = null;
  } else if (ttype === 7) {
    rest.value = parseRestHeroes(data).heroes;
    popup.value = 'rest';
  }
}

function openBuilding(bid: number): void {
  const building = game.city.buildings
    .filter((b) => b.bid === bid && b.level > 0)
    .sort((a, b) => b.level - a.level)[0];
  if (building) game.openBuildingSlot({ inner: true, x: building.x, y: building.y }, 1, building);
}

const unregister = game.addGlobalReceiver('office_exile', (_command, data) => {
  const arr = Array.isArray(data) ? data : [];
  exile.value = Array.isArray(arr[0]) ? (arr[0] as Record<string, unknown>[]) : [];
  recallNeed.value = '';
  popup.value = 'callback';
});
onUnmounted(unregister);
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
      <FxCanvas :x="20" :y="125" :w="642" :h="318" style-name="BoardListUp">
        <FxButton
          :x="11"
          :y="3"
          :w="65"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Office_OfficeHeroPanel_1_1') || '计谋'"
          @click="showAlert(i18n('Basic_not_open') || '暂未开放')"
        />
        <FxButton
          :x="89"
          :y="3"
          :w="65"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Office_OfficeHeroPanel_2_1') || '招募'"
          @click="openBuilding(10)"
        />
        <FxButton
          :x="166"
          :y="3"
          :w="65"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Office_OfficeHeroPanel_3_1') || '任命'"
          @click="popup = 'chief'"
        />
        <FxButton
          :x="244"
          :y="3"
          :w="65"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Office_OfficeHeroPanel_16_1') || '历练'"
          @click="popup = 'expr'"
        />
        <FxButton
          :x="322"
          :y="3"
          :w="65"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Office_OfficeHeroPanel_17_1') || '修养'"
          @click="send('getRestHeros', [], 7)"
        />
        <FxButton
          :x="400"
          :y="3"
          :w="100"
          :h="36"
          style-name="ButtonYellow"
          :label="i18n('Office_OfficeHeroPanel_4_1') || '召回旧部'"
          @click="game.sendGlobalCommand('office_exile', 'getExileHeros')"
        />
        <FxDataGrid
          :x="3"
          :y="38"
          :w="636"
          :h="276"
          :columns="columns"
          :rows="rows"
          :row-height="25"
        >
          <template #cell="{ row, column }">
            <FxButton
              v-if="column.field === 'view'"
              :x="3"
              :y="0"
              :w="50"
              :h="25"
              style-name="ButtonRed"
              :label="i18n('Office_OfficeHeroPanel_15_1') || '查看'"
              @click="game.showHeroDetail(Number(row.hid))"
            />
            <span v-else>{{ row[column.field] }}</span>
          </template>
        </FxDataGrid>
      </FxCanvas>
      <OfficeChiefDialog
        v-if="popup === 'chief'"
        :heroes="game.city.heroes"
        :on-save="(args) => (send('setCityChief', args, 0), (popup = null))"
        @close="popup = null"
      />
      <OfficeCallbackDialog
        v-else-if="popup === 'callback'"
        :heroes="exile"
        :need="recallNeed"
        @try="(hid) => send('tryCallbackHero', [game.city.cid, hid], 5)"
        @sure="(hid) => send('sureCallbackHero', [game.city.cid, hid], 6)"
        @close="popup = null"
      />
      <OfficeRestDialog v-else-if="popup === 'rest'" :heroes="rest" @close="popup = null" />
      <HeroExprDialog
        v-else-if="popup === 'expr'"
        :param="100 + building.x * 10 + building.y"
        @close="popup = null"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
