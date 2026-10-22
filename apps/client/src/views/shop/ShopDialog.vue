<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { treasureItems, type TreasureItem } from '../../game/goods';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { gameAlert } from '../../ui/alert';
import type { TipValue } from '../../ui/tooltip';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import TreasureGetDialog from '../goods/TreasureGetDialog.vue';
import BuyGoodsDialog from './BuyGoodsDialog.vue';
import ExchangeLiquanDialog from './ExchangeLiquanDialog.vue';

/**
 * Shop.ShopDialog: the 元宝 / 礼金 shop reached from 购买装备 / 购买技能书 / the shop button.
 * `getShopInfo` returns `[五铢, 积分, normal, recommended, 五铢goods, copperGoods]`; the normal
 * and recommended cfg_shop rows are merged and bucketed onto the tabs (特价 / 热卖 / group+2).
 */
const props = defineProps<{ targetTab?: number }>();

const game = useGame();
const user = useUserStore();
const int = (v: unknown) => parseInt(String(v), 10) || 0;

type Item = Record<string, unknown> & { imageName: string };

const PER_PAGE = 16;
/** 特价 (rebate), 热卖 (hot), then group+2: 宝物 2, 加速 3, 生产 4, 古匣 5, 战场 7. */
const TABS = [
  { type: 0, label: i18n('Shop_ShopDialog_16_1'), style: 'ButtonGreen' },
  { type: 1, label: i18n('Shop_ShopDialog_17_1'), style: 'ButtonRed' },
  { type: 2, label: i18n('Shop_ShopDialog_18_1'), style: 'ButtonYellow' },
  { type: 3, label: i18n('Shop_ShopDialog_19_1'), style: 'ButtonYellow' },
  { type: 4, label: i18n('Shop_ShopDialog_20_1'), style: 'ButtonYellow' },
  { type: 5, label: i18n('Shop_ShopDialog_21_1'), style: 'ButtonYellow' },
];

const buckets = ref<Record<number, Item[]>>({});
const curType = ref(props.targetTab ?? 2);
const curPage = ref(0);
const buying = shallowRef<Item | null>(null);
const exchanging = ref(false);
const treasure = shallowRef<TreasureItem[] | null>(null);

const tabItems = computed(() => buckets.value[curType.value] ?? []);
const pageCount = computed(() => Math.max(1, Math.ceil(tabItems.value.length / PER_PAGE)));
const pageItems = computed(() =>
  tabItems.value.slice(curPage.value * PER_PAGE, curPage.value * PER_PAGE + PER_PAGE),
);

const tip = (item: Item): TipValue => ({
  goods: { title: String(item.name ?? ''), text: String(item.description ?? '') },
});

function imageName(item: Item): string {
  return int(item.image) === 0
    ? `images/item_${int(item.gid)}.png`
    : `images/pack_${int(item.image)}.png`;
}

function itemPos(i: number): { x: number; y: number } {
  return { x: 10 + (i % 4) * 160, y: 10 + Math.floor(i / 4) * 80 };
}

/** `onLoadShopGoods`: bucket the merged list; default to the first non-empty of 特价 / 热卖. */
function onLoadShopGoods(data: unknown[]) {
  const d = [...data];
  d.shift(); // 五铢钱
  d.shift(); // 积分
  const normal = (d.shift() as unknown[]) ?? [];
  const recommended = (d.shift() as unknown[]) ?? [];
  const next: Record<number, Item[]> = {};
  const push = (type: number, item: Item) => (next[type] ??= []).push(item);

  let firstFilled = 2;
  for (const raw of [...normal, ...recommended]) {
    if (!raw || typeof raw !== 'object') continue;
    const item = { ...(raw as Record<string, unknown>) } as Item;
    item.imageName = imageName(item);
    push(int(item.group) + 2, item);
    if (int(item.rebate) > 0) {
      push(0, item);
      firstFilled = 0;
    } else if (int(item.hot) > 0) {
      push(1, item);
      if (firstFilled > 1) firstFilled = 1;
    }
  }
  // 特价 by rebate rank, 热卖 by hot rank (the original keeps them sorted as it inserts).
  next[0]?.sort((a, b) => int(a.rebate) - int(b.rebate));
  next[1]?.sort((a, b) => int(a.hot) - int(b.hot));
  buckets.value = next;
  curType.value = props.targetTab ?? firstFilled;
  curPage.value = 0;
}

function showTab(type: number) {
  curType.value = type;
  curPage.value = 0;
}

function onPrevPage() {
  if (curPage.value > 0) curPage.value--;
}

function onNextPage() {
  if (curPage.value < pageCount.value - 1) curPage.value++;
}

const unregister = game.addGlobalReceiver('shop', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'getShopInfo') onLoadShopGoods(d);
  else if (command === 'buyGoods') {
    const payType = int(d.shift());
    if (payType === 0) user.money = int(d.shift());
    else if (payType === 1) user.gift = int(d.shift());
    const extra = d.length > 0 ? ` ${String(d.shift())}` : '';
    gameAlert(i18n('Shop_ShopDialogSrc_1') + extra);
  } else if (command === 'exchangeLiquan') {
    treasure.value = treasureItems(d.shift());
  }
});
onUnmounted(unregister);
onMounted(() => game.sendGlobalCommand('shop', 'getShopInfo'));

const TITLE = { textAlign: 'center' } as const;
</script>

<template>
  <FxCanvas
    class="shop"
    :w="682"
    :h="492"
    style-name="PanelGreyGreen"
    :fx="{ fontSize: 12, borderStyle: 'none', backgroundColor: 8026746 }"
  >
    <FxImage :x="215" :y="14" source="images/title.png" />
    <FxLabel
      :x="0"
      :y="20"
      :w="682"
      style-name="PopupDialogTitle"
      :fx="TITLE"
      :text="i18n('Shop_ShopDialog_1_1')"
    />

    <!-- tabs -->
    <template v-for="(tab, i) in TABS" :key="tab.type">
      <FxButton
        :x="16 + i * 62"
        :y="59"
        :w="60"
        :h="30"
        :style-name="tab.style"
        :label="tab.label"
        :selected="curType === tab.type"
        @click="showTab(tab.type)"
      />
    </template>

    <!-- paging -->
    <FxCanvas v-if="pageCount > 1" :x="462" :y="59" :w="210" :h="36">
      <FxCanvas :x="8" :y="6" :w="70" :h="25" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="70"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="`${curPage + 1}/${pageCount}`"
        />
      </FxCanvas>
      <FxButton :x="78" :y="0" :w="65" :label="i18n('Shop_ShopDialog_2_1')" @click="onPrevPage" />
      <FxButton :x="141" :y="0" :w="65" :label="i18n('Shop_ShopDialog_3_1')" @click="onNextPage" />
    </FxCanvas>

    <!-- item grid -->
    <FxCanvas :x="15" :y="100" :w="652" :h="336" style-name="BoardListUp">
      <FxCanvas
        v-for="(item, i) in pageItems"
        :key="`${item.id}`"
        :x="itemPos(i).x"
        :y="itemPos(i).y"
        :w="150"
        :h="72"
        style-name="BoardListDown"
      >
        <FxCanvas :x="4" :y="4" :w="64" :h="64" style-name="FramePicture">
          <FxImage
            :x="2"
            :y="2"
            :w="60"
            :h="60"
            :source="item.imageName"
            :tip="tip(item)"
            hand
            @click="buying = item"
          />
        </FxCanvas>
        <FxLabel
          :x="72"
          :y="8"
          :w="74"
          :fx="{ color: 16777215 }"
          :text="String(item.name ?? '')"
          :tip="tip(item)"
        />
        <FxLabel
          :x="72"
          :y="32"
          :w="74"
          :fx="{ color: 16772608 }"
          :text="`${int(item.price)}${int(item.rebate) > 0 || int(item.hot) > 0 ? '' : ''}`"
        />
        <FxButton
          :x="72"
          :y="44"
          :w="70"
          :h="24"
          style-name="ButtonYellow"
          :label="i18n('Shop_ShopDialog_18_1')"
          @click="buying = item"
        />
      </FxCanvas>
    </FxCanvas>

    <!-- bottom bar: balances, 礼券兑换, close -->
    <FxCanvas :x="16" :y="444" :w="651" :h="38">
      <FxCanvas :x="0" :y="4" :w="42" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="4"
          :y="4"
          :w="38"
          style-name="ItemTitle"
          :text="i18n('Shop_ShopDialog_4_1')"
          :tip="i18n('Shop_ShopDialog_4_2')"
        />
      </FxCanvas>
      <FxCanvas :x="44" :y="4" :w="84" :h="26" style-name="BoardListDown">
        <FxLabel :x="4" :y="4" :w="72" style-name="ItemValue" :text="user.money" />
      </FxCanvas>
      <FxCanvas :x="136" :y="4" :w="42" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="4"
          :y="4"
          :w="38"
          style-name="ItemTitle"
          :text="i18n('Shop_ShopDialog_5_1')"
          :tip="i18n('Shop_ShopDialog_5_2')"
        />
      </FxCanvas>
      <FxCanvas :x="182" :y="4" :w="84" :h="26" style-name="BoardListDown">
        <FxLabel :x="4" :y="4" :w="72" style-name="ItemValue" :text="user.gift" />
      </FxCanvas>
      <FxButton
        :x="360"
        :y="0"
        :w="76"
        style-name="ButtonYellow"
        :label="i18n('Shop_ShopDialog_8_1')"
        @click="exchanging = true"
      />
      <FxButton
        :y="0"
        :w="65"
        :h="36"
        style-name="Close"
        :fx="{ fontSize: 16, right: '0' }"
        @click="game.closeShop()"
      />
    </FxCanvas>

    <BuyGoodsDialog v-if="buying" :goods="buying" @close="buying = null" />
    <ExchangeLiquanDialog v-if="exchanging" @close="exchanging = false" />
    <TreasureGetDialog v-if="treasure" :items="treasure" @close="treasure = null" />
  </FxCanvas>
</template>

<style scoped>
.shop {
  pointer-events: none !important;
}

.shop > :deep(*) {
  pointer-events: auto;
}
</style>
