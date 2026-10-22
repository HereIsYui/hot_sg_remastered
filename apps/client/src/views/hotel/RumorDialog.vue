<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { ID_BUILDING_HOTEL } from '../../game/hotelLionize';
import {
  parseRumorDetail,
  parseRumorList,
  type Rumor,
  type RumorDetail,
} from '../../game/hotelRumor';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import AskDetailDialog from './AskDetailDialog.vue';

/**
 * Hotel.RumorDialog: the 市井传闻 board. A clicked rumor expands to the right pane; 更多传闻
 * (`moreRumor`) and 搜索 (`searchRumor`) refresh the list, 领取任务 (`recordTask`) and 结交
 * (`tryLionizeHero`) act on a famous-hero rumor. `param` round-trips the 客栈's position.
 */
const props = defineProps<{ param: number }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const rumors = shallowRef<Rumor[]>([]);
const detail = ref<RumorDetail | null>(null);
const description = ref(i18n('RumorDescription'));
const searchText = ref('');
const showAsk = ref(false);

function send(cmd: string, args: CommandArg[], ttype = 0) {
  game.sendDialogCommand(cmd, ID_BUILDING_HOTEL, props.param, args, ttype);
}

const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === ID_BUILDING_HOTEL && p === props.param,
  onData(reply, ttype) {
    if (!Array.isArray(reply)) return;
    if (ttype === 1) {
      // getRumorList / moreRumor / searchRumor: the refreshed list.
      rumors.value = parseRumorList(reply);
      detail.value = null;
      description.value = i18n('RumorDescription');
    } else if (ttype === 2) {
      // getRumor / askDetail: the rumor detail (askDetail re-renders it with the location).
      detail.value = parseRumorDetail(reply);
      description.value = detail.value.description;
    }
  },
});

/** `onShow`: load the board (reply ttype 1). */
function reload() {
  send('getRumorList', [], 1);
}

/** `onShowRumor`: a clicked rumor → `getRumor` (reply ttype 2). */
function onClickRumor(rumor: Rumor) {
  send('getRumor', [rumor.id], 2);
}

/** `onSearch`: confirm, then `searchRumor` spends 1000 黄金 (reply ttype 1). */
async function onSearch() {
  if ((await showAlert(i18n('Hotel_RumorDialogSrc_6'), '', ['yes', 'no'])) !== 'yes') return;
  if (searchText.value === '') {
    void showAlert(i18n('Hotel_RumorDialogSrc_7'));
    return;
  }
  send('searchRumor', [searchText.value], 1);
}

/** `onMoreRumor`: confirm, then `moreRumor` spends 100 黄金 (reply ttype 1). */
async function onMore() {
  if ((await showAlert(i18n('Hotel_RumorDialogSrc_8'), '', ['yes', 'no'])) !== 'yes') return;
  send('moreRumor', [], 1);
}

/** `onRecord`: `recordTask` throws its success / error message (shown by the failure handler). */
function onRecord() {
  if (!detail.value) return;
  send('recordTask', [detail.value.id], 4);
}

/** `onAskDetail`: open the 元宝 / 礼金 pay dialog. */
function onAsk() {
  if (!detail.value) return;
  showAsk.value = true;
}

/** `onLionize`: `tryLionizeHero` resolves the hero and fee (reply ttype 22), then confirms. */
function onLionize() {
  if (!detail.value) return;
  send('tryLionizeHero', [detail.value.id], 22);
}

const columns = [{ header: '', field: 'name' as const, width: 107 }];

onMounted(() => {
  reload();
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, borderStyle: 'none', backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="143" :y="43" :w="367" :h="414" style-name="PopupDialog">
      <FxButton
        :right="20"
        :bottom="20"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :x="119" :y="15" :w="120" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="120"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Hotel_RumorDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="20" :y="53" :w="70" :h="24" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="70"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Hotel_RumorDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="97" :y="53" :w="103" :h="24" style-name="BoardListDown">
        <FxTextInput
          v-model="searchText"
          :x="2"
          :y="3"
          :w="99"
          :h="21"
          style-name="EmptyTextInput"
        />
      </FxCanvas>
      <FxButton
        :x="207"
        :y="50"
        :w="50"
        :h="30"
        style-name="ButtonYellow"
        :label="i18n('Hotel_RumorDialog_3_1')"
        @click="onSearch()"
      />
      <FxButton
        :right="20"
        :y="50"
        :w="71"
        :h="30"
        style-name="ButtonGreen"
        :label="i18n('Hotel_RumorDialog_4_1')"
        @click="onMore()"
      />
      <FxCanvas :left="20" :y="92" :w="113" :h="248" style-name="BoardListUp">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="107"
          :h="242"
          :header-height="0"
          :row-height="24"
          :columns="columns"
          :rows="rumors"
          selectable
          @item-click="onClickRumor($event)"
        />
      </FxCanvas>
      <FxCanvas :right="20" :y="92" :w="197" :h="248" style-name="BoardListDown">
        <FxText :x="5" :y="5" :w="187" :h="238" scroll :html="description" />
      </FxCanvas>
      <FxButton
        v-if="detail?.showRecord"
        :left="20"
        :bottom="20"
        :w="77"
        :h="36"
        style-name="ButtonYellow"
        :label="i18n('Hotel_RumorDialog_5_1')"
        @click="onRecord()"
      />
      <FxButton
        v-if="detail?.showRecord"
        :x="112"
        :bottom="19"
        :w="77"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Hotel_RumorDialog_7_1')"
        @click="onLionize()"
      />
      <FxButton
        v-if="detail?.showDetail"
        :x="197"
        :bottom="19"
        :w="77"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Hotel_RumorDialog_6_1')"
        @click="onAsk()"
      />
    </FxCanvas>

    <AskDetailDialog
      v-if="showAsk && detail"
      :rumor-id="detail.id"
      :price="detail.price"
      :send="send"
      @close="showAsk = false"
    />
  </FxCanvas>
</template>
