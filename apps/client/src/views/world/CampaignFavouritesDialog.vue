<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { parseFavouritesList, type FavouriteCity, type FavouriteTarget } from '../../game/world';
import { i18n } from '../../i18n';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import CommentsDialog from './CommentsDialog.vue';

/**
 * Ground/CampaignFavouritesDialog: the player's own cities (left) and the saved favourite targets
 * (right). A target can be deleted (`deleteFavourites`), commented (CommentsDialog ->
 * `setFavouritesComments`), or dispatched to — but 出征 opens the 暂未开放 placeholder because the
 * CampaignDialog is not ported yet. Loads via `getFavouritesList`.
 */
const game = useGame();
const g = (n: number) => i18n(`Ground_CampaignFavouritesDialog_${n}_1`);

const cities = ref<FavouriteCity[]>([]);
const targets = ref<FavouriteTarget[]>([]);
/** The selected favourite target id (only a target can be deleted / commented). */
const selectedId = ref<number | null>(null);
const comments = ref<FavouriteTarget | null>(null);

const cityColumns = [
  { header: g(6) || '城池', field: 'name' as const, width: 150 },
  { header: g(7) || '坐标', field: 'location' as const, width: 120 },
];
const targetColumns = [
  { header: g(9) || '名称', field: 'name' as const, width: 110 },
  { header: g(10) || '坐标', field: 'location' as const, width: 90 },
  { header: g(11) || '备注', field: 'comments' as const, width: 100 },
];

function onGetFavouritesList(data: unknown): void {
  const parsed = parseFavouritesList(data);
  cities.value = parsed.cities;
  targets.value = parsed.targets;
  if (!targets.value.some((t) => t.id === selectedId.value)) selectedId.value = null;
}

async function onDelete(): Promise<void> {
  if (selectedId.value === null) return;
  if ((await showAlert(g(1) || '确定删除该收藏？', '', ['yes', 'no'])) === 'yes') {
    game.sendWorldCommand('deleteFavourites', [selectedId.value]);
  }
}

/** 出征: the original hands the cid to the CampaignDialog, not ported yet. */
function onConfirm(): void {
  gameAlert(i18n('_CommonSrc_notOpen') || '暂未开放');
}

function editComment(target: FavouriteTarget): void {
  comments.value = target;
}

const unregister = game.addGlobalReceiver('world', (command, data) => {
  // getFavouritesList and the list returned by deleteFavourites share the same shape
  if (command === 'getFavouritesList' || command === 'deleteFavourites') {
    onGetFavouritesList(data);
  }
});

onMounted(() => game.sendWorldCommand('getFavouritesList', [0]));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxLabel
      :x="264"
      :y="14"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="g(3) || '收藏夹'"
    />

    <!-- own cities -->
    <FxCanvas :x="10" :y="53" :w="326" :h="386" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="320"
        :h="380"
        :row-height="30"
        :columns="cityColumns"
        :rows="cities"
      />
    </FxCanvas>

    <!-- favourite targets -->
    <FxCanvas :x="346" :y="53" :w="326" :h="386" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="320"
        :h="380"
        :row-height="30"
        :columns="targetColumns"
        :rows="targets"
        selectable
        :selected-index="targets.findIndex((t) => t.id === selectedId)"
        @item-click="(t) => (selectedId = t.id)"
      >
        <template #cell="{ row, column }">
          <template v-if="column.field === 'comments'">
            <span class="comment" @click.stop="editComment(row)">{{ row.comments || '✎' }}</span>
          </template>
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>

    <FxButton
      :x="21"
      :y="448"
      :w="90"
      :h="30"
      style-name="ButtonRed"
      :enabled="selectedId !== null"
      :label="g(4) || '删除'"
      @click="onDelete"
    />
    <FxButton :x="548" :y="449" :w="56" :h="30" style-name="Confirm" @click="onConfirm" />
    <FxButton :x="612" :y="449" :w="56" :h="30" style-name="Close" @click="game.closeDialog()" />

    <CommentsDialog
      v-if="comments"
      :id="comments.id"
      :name-of-city="comments.name"
      :location="comments.location"
      :comments="comments.comments"
      @close="comments = null"
    />
  </FxCanvas>
</template>

<style scoped>
.comment {
  cursor: pointer;
  width: 100%;
  text-align: center;
  color: #4fd1c5;
}

.comment:hover {
  text-decoration: underline;
}
</style>
