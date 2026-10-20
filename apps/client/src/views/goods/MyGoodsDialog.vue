<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { endTimeText } from '../../core/clock';
import { useGame } from '../../game/game';
import {
  GOODS_TAB_COUNT,
  PAGE_ITEM_COUNT,
  itemPosition,
  pageCount,
  parseUserGoods,
  treasureItems,
  type GoodsItem,
  type TreasureItem,
} from '../../game/goods';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useUserStore } from '../../stores/user';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import SellGoodsPanel from './SellGoodsPanel.vue';
import TreasureGetDialog from './TreasureGetDialog.vue';
import UserGoodsItem from './UserGoodsItem.vue';

/**
 * Goods.MyGoodsDialog: the player's items by kind, 21 to a page, to use or sell. The items
 * with a dialog of their own (迁城令, 免战牌, 旌旗, 名帖, 武魂, 离间符 ...), the skill books, card
 * mixing, recharging and the shop are not ported.
 */
const game = useGame();
const user = useUserStore();
const city = useCityStore();
const t = (n: number) => i18n(`Goods_MyGoodsDialog_${n}_1`);
const src = (n: number) => i18n(`Goods_MyGoodsDialogSrc_${n}`);

/** Tab buttons: x, tab and label. */
const TABS: { x: number; type: number; label: string }[] = [
  { x: 19, type: 0, label: t(2) },
  { x: 83, type: 1, label: t(3) },
  { x: 147, type: 2, label: t(4) },
  { x: 212, type: 3, label: t(5) },
  { x: 277, type: 4, label: t(6) },
  { x: 342, type: 5, label: t(7) },
  { x: 406, type: 7, label: i18n('SkillBook') },
];
const SKILL_TAB = 7;
const MARKET_BID = 13;
/** Items whose use changes the city's resources or people at once. */
const REFRESH_CITY_GIDS = new Set([54, 55, 57, 58, 139]);
/** 聚魂珠 and 马鞭: the only items 合成 takes. */
const COMPOSABLE = (gid: number) =>
  (gid >= 10830 && gid <= 10839) || gid === 19081 || gid === 19082;

const tabs = ref<GoodsItem[][]>(Array.from({ length: GOODS_TAB_COUNT }, () => []));
const goods = ref<GoodsItem[]>([]);
const curType = ref(remembered.type);
const curPage = ref(remembered.page);
const pages = computed(() => pageCount(tabs.value[curType.value]?.length ?? 0));
const shown = computed(() =>
  (tabs.value[curType.value] ?? []).slice(
    curPage.value * PAGE_ITEM_COUNT,
    (curPage.value + 1) * PAGE_ITEM_COUNT,
  ),
);
const treasure = shallowRef<TreasureItem[] | null>(null);
const selling = shallowRef<GoodsItem | null>(null);

function loadUserGoods() {
  game.sendGlobalCommand('goods', 'loadUserGoods');
}

function showTab(type: number) {
  if (type === SKILL_TAB) return;
  if (type !== curType.value) {
    curPage.value = 0;
    curType.value = type;
  }
  remembered.type = curType.value;
  remembered.page = curPage.value;
}

function onPrevPage() {
  if (curPage.value > 0) curPage.value--;
  showTab(curType.value);
}

function onNextPage() {
  if (curPage.value < pages.value - 1) curPage.value++;
  showTab(curType.value);
}

function onLoadUserGoods(data: unknown) {
  const parsed = parseUserGoods(data);
  goods.value = parsed.goods;
  tabs.value = parsed.tabs;
  if (game.guide.justCreatedRole) showTab(3);
  else if (!tabs.value[curType.value]?.length && parsed.firstGroup < GOODS_TAB_COUNT) {
    showTab(parsed.firstGroup);
  } else showTab(curType.value);
}

async function useGoods(item: GoodsItem) {
  if (item.isThing) {
    void showAlert(src(7));
    return;
  }
  if (user.honour >= 0 && item.gid === 134) {
    void showAlert(src(8));
    return;
  }
  if (item.autouse === 0) {
    void showAlert(item.useguide);
    return;
  }
  const box = (item.gid >= 16 && item.gid <= 18) || item.gid === 119;
  const prompt = box
    ? `${item.description}${src(9)}${item.name}?`
    : `${item.description}${src(11)} ${item.name}?`;
  const onlyYes = !box && game.guide.justCreatedRole;
  if ((await showAlert(prompt, '', onlyYes ? ['yes'] : ['yes', 'no'])) === 'yes') {
    game.sendGlobalCommand('goods', 'useGoods', [item.gid]);
  }
}

function sellGoods(item: GoodsItem) {
  const market = city.buildings.find((b) => b.bid === MARKET_BID);
  if (!market || market.level < 5) {
    void showAlert(src(32));
  } else if (item.gid === 161501) {
    void showAlert(src(34));
  } else if (item.sellvalue < 0) {
    void showAlert(src(35));
  } else {
    selling.value = item;
  }
}

async function goodCompose(item: GoodsItem) {
  if (!COMPOSABLE(item.gid)) {
    void showAlert(i18n('Goods_can_not_compose'));
    return;
  }
  if (item.gid === 10839) {
    void showAlert(i18n('Goods_Compose_maxLevel'));
    return;
  }
  const prompt =
    item.gid === 19081
      ? i18n('Goods_UseGoodsDialogSrc_UseHorsewhip_1')
      : item.gid === 19082
        ? i18n('Goods_UseGoodsDialogSrc_UseHorsewhip_2')
        : i18n('Goods_UserGoodsItem_bead_compose_intro');
  if ((await showAlert(prompt, '', ['yes', 'no'])) === 'yes') {
    game.sendGlobalCommand('goods', 'goodsCompose', [item.gid]);
  }
}

function onAction(action: string, item: GoodsItem) {
  if (action === 'use') void useGoods(item);
  else if (action === 'sell') sellGoods(item);
  else if (action === 'compose') void goodCompose(item);
}

function doSellGoods(count: number) {
  const item = selling.value;
  if (item) game.sendGlobalCommand('goods', 'sellGoods', [city.cid, item.gid, count]);
}

/** `[goods row, cid, gold]`: the sold item's new count and the city's gold. */
function onSellGoodsSucc(d: unknown[]) {
  const row = (d[0] ?? {}) as Record<string, unknown>;
  const gid = parseInt(String(row.gid), 10);
  const count = parseInt(String(row.count), 10) || 0;
  const item = goods.value.find((g) => g.gid === gid);
  if (item) {
    if (count > 0) item.count = count;
    else {
      const tab = tabs.value[item.group];
      tab?.splice(tab.indexOf(item), 1);
      goods.value.splice(goods.value.indexOf(item), 1);
    }
  }
  showTab(curType.value);
  if (parseInt(String(d[1]), 10) === city.cid) city.gold = parseInt(String(d[2]), 10) || 0;
  gameAlert(src(33));
}

/** `[gid, kind, ...]`: a message, opened items or an end time; then the list reloads. */
function onUseGoods(d: unknown[]) {
  const gid = parseInt(String(d.shift()), 10);
  const kind = parseInt(String(d.shift()), 10);
  if (kind === 0) gameAlert(String(d.shift() ?? ''));
  else if (kind === 1 || kind === 3) treasure.value = treasureItems(d.shift());
  else if (kind === 2) {
    const text = String(d.shift() ?? '');
    void showAlert(text + endTimeText(parseInt(String(d.shift()), 10)));
  }
  if (REFRESH_CITY_GIDS.has(gid)) game.refreshResource();
  game.guide.triggerByGoods(gid);
  loadUserGoods();
}

const unregister = game.addGlobalReceiver('goods', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadUserGoods') onLoadUserGoods(d);
  else if (command === 'useGoods') onUseGoods(d);
  else if (command === 'sellGoods') onSellGoodsSucc(d);
  else if (command === 'goodsCompose') {
    if (!d.shift()) gameAlert(i18n('Goods_UseGoodsDialogSrc_UseHorsewhip_fail'));
    else treasure.value = treasureItems([d.shift()]);
    loadUserGoods();
  }
});
onMounted(loadUserGoods);
onUnmounted(unregister);
</script>

<script lang="ts">
/** The dialog object outlived its closing: it reopens on the last tab and page shown. */
const remembered = { type: 0, page: 0 };
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="15" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="19"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="t(1)"
    />
    <FxButton :x="587" :y="434" style-name="Close" @click="game.closeDialog()" />
    <FxButton
      v-for="tab in TABS"
      :key="tab.type"
      :x="tab.x"
      :y="65"
      :w="65"
      style-name="ButtonRed"
      :label="tab.label"
      :selected="curType === tab.type"
      @click="showTab(tab.type)"
    />
    <FxCanvas v-if="pages > 1" :x="532" :y="30" :w="135" :h="74">
      <FxCanvas :x="59" :y="7" :w="70" :h="25" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="70"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="`${curPage + 1}/${pages}`"
        />
      </FxCanvas>
      <FxButton :x="1" :y="35" :w="65" :label="t(8)" @click="onPrevPage" />
      <FxButton :x="67" :y="35" :w="65" :label="t(9)" @click="onNextPage" />
    </FxCanvas>
    <FxCanvas :y="109" :h="303" :left="20" :right="20" style-name="BoardListDown">
      <FxCanvas :left="15" :top="10" :right="15" :bottom="10">
        <UserGoodsItem
          v-for="(item, i) in shown"
          :key="i"
          v-bind="itemPosition(i)"
          :item="item"
          @action="onAction"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton :x="322" :y="433" :w="76" style-name="ButtonGreen" :label="t(10)" />
    <FxButton :x="416" :y="433" :w="76" style-name="ButtonYellow" :label="t(11)" />
    <FxCanvas :x="23" :y="439" :w="38" :h="26" style-name="BoardListUp">
      <FxLabel
        :x="4"
        :y="3"
        :w="31"
        style-name="ItemTitle"
        :text="t(13)"
        :tip="i18n('Goods_MyGoodsDialog_13_2')"
      />
    </FxCanvas>
    <FxCanvas :x="74" :y="439" :w="84" :h="26" style-name="BoardListDown">
      <FxLabel :x="6" :y="3" :w="72" style-name="ItemValue" :text="user.money" />
    </FxCanvas>
    <FxCanvas :x="169" :y="439" :w="38" :h="26" style-name="BoardListUp">
      <FxLabel
        :x="4"
        :y="3"
        :w="31"
        style-name="ItemTitle"
        :text="t(14)"
        :tip="i18n('Goods_MyGoodsDialog_14_2')"
      />
    </FxCanvas>
    <FxCanvas :x="220" :y="439" :w="84" :h="26" style-name="BoardListDown">
      <FxLabel :x="6" :y="3" :w="72" style-name="ItemValue" :text="user.gift" />
    </FxCanvas>
    <TreasureGetDialog v-if="treasure" :items="treasure" @close="treasure = null" />
    <SellGoodsPanel v-if="selling" :goods="selling" @sell="doSellGoods" @close="selling = null" />
  </FxCanvas>
</template>
