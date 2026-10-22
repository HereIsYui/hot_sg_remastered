<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import { endTimeText } from '../../core/clock';
import { BUILDING_COLLEGE } from '../../game/cityGrid';
import { useGame } from '../../game/game';
import {
  UseGoodsType,
  parseTypeGoods,
  typeGoodsDialogWidth,
  type TypeGoodsItem,
} from '../../game/goods';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import type { UseGoodsRequest } from '../../stores/session';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import type { TipValue } from '../../ui/tooltip';
import UseLubanMojiaDialog from './UseLubanMojiaDialog.vue';

/**
 * Goods.UseGoodsDialog: the items of one kind with the counts owned, to pick one to use; the
 * 鲁班传人 / 墨家弟子 finish at once for 元宝 or 礼金. 购买 needs the shop, which is not ported,
 * and so do the items for heroes, gear and the army that pass through here.
 */
const props = defineProps<{ request: UseGoodsRequest }>();

const game = useGame();
const city = useCityStore();

const ITEM_GAP = 13;
const POPUP_H = 203;
/** Speed-up masters: finish at once for 元宝 / 礼金. */
const MASTERS = new Set([53, 73]);
/** Items whose use changes the city's resources or people at once. */
const REFRESH_CITY_GIDS = new Set([54, 55, 57, 58]);
/** onUseGoodsSucc: types answered as useGoods answers (`[gid, kind, ...]`). */
const PLAIN_TYPES = new Set([
  4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 166, 165, 17, 18, 19, 23, 140, 142, 143, 21, 10083,
  10084, 10085, 161501, 10333, -16656, 27,
]);
/** Types answered `[gid, kind, message]` / `[gid, kind, message, end time]`. */
const MESSAGE_TYPES = new Set([47, 54]);
const MESSAGE_END_TYPE = 50;
/** 体力药 / 精力药 / 经验书 / 护命金丹: the reply is the city's hero list. */
const HERO_LIST_TYPES = new Set([2, 3, 11, 49]);

const items = shallowRef<TypeGoodsItem[]>([]);
const cost = ref(0);
const visible = ref(false);
const lubanMojia = ref(false);
let lastUsed: TypeGoodsItem | null = null;

const width = computed(() => typeGoodsDialogWidth(items.value.length));
const tip = (item: TypeGoodsItem): TipValue => ({
  goods: { title: item.name, text: item.description },
});

const isSpeedUp = (type: number) => type === UseGoodsType.Building || type === UseGoodsType.Technic;

function loadData() {
  const { type, time } = props.request;
  visible.value = false;
  lubanMojia.value = false;
  game.sendGlobalCommand('user', 'getUserTypeGoods', isSpeedUp(type) ? [type, time] : [type]);
}
watch(() => props.request, loadData, { immediate: true });

function close() {
  game.session.useGoods = null;
}

function onGetGoods(d: unknown[]) {
  if (isSpeedUp(props.request.type)) cost.value = parseInt(String(d.shift()), 10) || 0;
  items.value = parseTypeGoods(d.shift());
  visible.value = true;
}

function send(item: TypeGoodsItem, extra: CommandArg[] = []) {
  const { type, param } = props.request;
  game.sendGlobalCommand('user', 'useTypeGoods', [type, item.gid, city.cid, ...param, ...extra]);
}

async function onClickGoods(item: TypeGoodsItem) {
  lastUsed = item;
  if (MASTERS.has(item.gid)) {
    lubanMojia.value = true;
    return;
  }
  const prompt = `${i18n('Goods_UseGoodsDialogSrc_10')}${item.name}?`;
  const onlyYes = game.guide.justCreatedRole && !remembered.guideClicked;
  if (onlyYes) remembered.guideClicked = true;
  if ((await showAlert(prompt, '', onlyYes ? ['yes'] : ['yes', 'no'])) === 'yes') send(item);
}

/** `useLubanMojiaImmediately`: 0 pays 元宝, 1 礼金. */
function useMasterNow(payType: number) {
  if (lastUsed) send(lastUsed, [payType]);
}

function onUseGoodsSucc(d: unknown[]) {
  const { type, param } = props.request;
  if (type === UseGoodsType.Building) {
    game.onGetCityBuilding(d);
  } else if (type === UseGoodsType.Technic) {
    const [, , x = 0, y = 0] = param.map((v) => parseInt(String(v), 10) || 0);
    game.deliverToDialog(BUILDING_COLLEGE, y * 10 + x, d);
  } else if (PLAIN_TYPES.has(type)) {
    const gid = parseInt(String(d.shift()), 10);
    const kind = parseInt(String(d.shift()), 10);
    if (kind === 0) void showAlert(String(d.shift() ?? ''));
    else if (kind === 2) {
      const text = String(d.shift() ?? '');
      void showAlert(text + endTimeText(parseInt(String(d.shift()), 10)));
    }
    if (REFRESH_CITY_GIDS.has(gid)) game.refreshResource();
  } else if (MESSAGE_TYPES.has(type)) {
    gameAlert(String(d[2] ?? ''));
  } else if (type === MESSAGE_END_TYPE) {
    void showAlert(String(d[2] ?? '') + endTimeText(parseInt(String(d[3]), 10)));
  } else if (HERO_LIST_TYPES.has(type)) {
    game.onLoadHeroList(d);
    gameAlert(i18n('Goods_UseGoodsDialogSrc_7'));
  }
  close();
}

const unregister = game.addGlobalReceiver('user', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'getUserTypeGoods') onGetGoods(d);
  else if (command === 'useTypeGoods') onUseGoodsSucc(d);
});
onUnmounted(unregister);
</script>

<script lang="ts">
/** `mGuideClick`: only the guide's first use offers no way back. */
const remembered = { guideClicked: false };
</script>

<template>
  <FxCanvas :w="682" :h="492" class="use-goods" :fx="{ fontSize: 12 }">
    <FxCanvas
      v-if="visible"
      class="popup"
      :x="(682 - width) / 2"
      :y="(492 - POPUP_H) / 2 - 24"
      :w="width"
      :h="POPUP_H"
      style-name="PopupDialog"
    >
      <FxCanvas :y="43" :h="110" :left="10" :right="10" style-name="BoardListUp">
        <div class="hbox" :style="{ gap: `${ITEM_GAP}px` }">
          <FxCanvas
            v-for="item in items"
            :key="item.gid"
            class="item"
            :w="80"
            :h="90"
            style-name="BoardListDown"
          >
            <FxCanvas :x="6" :y="4" :w="68" :h="68" style-name="FramePicture">
              <FxImage
                :x="3"
                :y="2"
                :w="64"
                :h="64"
                :source="item.imageName"
                :tip="tip(item)"
                hand
                @click="onClickGoods(item)"
              />
              <FxLabel
                :x="0"
                :y="49"
                :w="68"
                :h="19"
                class="count"
                :fx="{ color: 16777215, textAlign: 'right' }"
                :text="item.count"
                :tip="tip(item)"
                @click="onClickGoods(item)"
              />
            </FxCanvas>
            <FxLabel
              :x="3"
              :y="70"
              :w="75"
              :h="20"
              :fx="{ color: 16777215, textAlign: 'center' }"
              :text="item.name"
            />
          </FxCanvas>
        </div>
      </FxCanvas>
      <FxCanvas :x="(width - 114) / 2" :y="12" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Goods_UseGoodsDialog_1_1')"
        />
      </FxCanvas>
      <FxButton :right="10" :y="157" style-name="Close" @click="close" />
      <FxButton
        :x="10"
        :y="157"
        style-name="ButtonGreen"
        :label="i18n('Goods_UseGoodsDialog_2_1')"
      />
    </FxCanvas>
    <UseLubanMojiaDialog
      v-if="lubanMojia"
      :cost="cost"
      @submit="useMasterNow"
      @close="lubanMojia = false"
    />
  </FxCanvas>
</template>

<style scoped>
.use-goods {
  pointer-events: none !important;
}

.use-goods > :deep(*) {
  pointer-events: auto;
}

.hbox {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  height: 90px;
  display: flex;
  justify-content: safe center;
  overflow-x: auto;
  overflow-y: hidden;
}

.hbox > .item {
  position: relative !important;
  flex: none;
}

.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
