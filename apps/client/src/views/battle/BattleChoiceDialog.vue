<script setup lang="ts">
import { computed, ref } from 'vue';
import type { HallBattle } from '../../game/battlefield';
import {
  battleShopGoodTip,
  groupBattleShopGoods,
  parseBattleShopGroups,
  type BattleShopGood,
  type BattleShopGroup,
  type BattleShopState,
} from '../../game/battleShop';
import { armBuyAgain } from '../../game/battlefieldBuyAgain';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import type { TipValue } from '../../ui/tooltip';
import CreateBattleDialog from './CreateBattleDialog.vue';

/**
 * Battle.BattleChoiceDialog: the 战场 hall — the 剧情战场 / 据点战场 / 战场商城 / 战场邀请 tabs
 * over the `cfg_battle_field` rows (type 0 / 1 of the getBattleInfo reply), the selected battle's
 * detail panel (`showBattleDetail`), 新建战场 (`onCreateBattle`) and the 请战书 重置参战次数
 * (`onResetTodayWarCount`). 加入战场 is driven from BattlePanel (`getPVPBattleInfo` reply opens
 * the JoinBattleDialog there); the 跨服 / 赤壁 tabs are out of the stage-9 local scope, and the
 * shop rows themselves arrive through the `getUserBattleShopInfo` reply on `shop`.
 */
const props = defineProps<{
  battles: HallBattle[];
  todayWarCount: number;
  shop: BattleShopState | null;
}>();
const emit = defineEmits<{
  join: [bid: number];
  /** the 战场商城 tab: BattlePanel sends `getUserBattleShopInfo` */
  shop: [];
  /** the 战场邀请 tab: BattlePanel sends `getBattleInvite` */
  invites: [];
  medalChange: [];
  medalRecord: [];
  buyGood: [good: BattleShopGood];
}>();

const game = useGame();

/** `mBattleType`: 0 剧情战场 (type-0 rows), 1 据点战场 (type-1 rows), 2 战场商城. */
const battleType = ref(0);
const lastIndex = ref(0);

/** `initBattleGroups`: type 0 → group 0, type 1 → group 1 (the local tabs only). */
const groupBattles = computed(() => props.battles.filter((b) => b.type === battleType.value));
const selected = computed(() => groupBattles.value[lastIndex.value] ?? null);

/** `showBattleDetail`: the right-hand detail panel's lines. */
const detailTop = computed(() => {
  const battle = selected.value;
  if (!battle) return '';
  const people =
    Number(battle.maxpeople) === 1
      ? `${battle.maxpeople}${i18n('Battle_BattleChoiceDialogSrc_13')}`
      : `${battle.minpeople}~${battle.maxpeople}${i18n('Battle_BattleChoiceDialogSrc_13')}`;
  return (
    i18n('Battle_BattleChoiceDialogSrc_8') +
    i18n('Battle_BattleChoiceDialogSrc_9') +
    `1~${battle.maxlevel}${i18n('Battle_BattleChoiceDialogSrc_10')}` +
    i18n('Battle_BattleChoiceDialogSrc_11') +
    i18n('Battle_BattleChoiceDialogSrc_12') +
    people +
    i18n('Battle_BattleChoiceDialogSrc_14')
  );
});

/** `onShowBattleInstruction`: the popup line set from the selected row. */
const instruction = ref(false);
const instructionLevel = computed(() => {
  const battle = selected.value;
  return Number(battle?.maxpeople) === 1
    ? '----------'
    : `${battle?.minpeople ?? 0}~${battle?.maxpeople ?? 0}`;
});
const instructionImage = computed(() => `images/${selected.value?.id ?? 0}_battle_info.jpg`);

/** `mCurrentBattleTypeNameArray`: the left list's header per tab. */
const listHeader = computed(() =>
  battleType.value === 2
    ? i18n('Battle_BattleChoiceDialogSrc_3_1')
    : i18n('Battle_BattleChoiceDialogSrc_1'),
);

/** `doClickBattleItem` (the list click) + `switchPanel` (the tab). */
function switchPanel(group: number): void {
  battleType.value = group;
  lastIndex.value = 0;
  if (group === 2) {
    shopGroupIndex.value = 0; // switchPanel(2) shows mBattleGoodsGroups[0]
    shopPage.value = 0;
    emit('shop');
  }
  if (group === 3) emit('invites');
}
function onClickBattle(_row: HallBattle, index: number): void {
  lastIndex.value = index;
}

// ---- the 战场商城 view (initBattleGroups' shop list over the getUserBattleShopInfo reply) ----
const SHOP_PAGE = 12;
const shopPage = ref(0);
const shopGroupIndex = ref(0);

/** `initBattleGroups`'s mBattleShops: 战场道具, one entry per battle, 赤壁/孟获商城 when open. */
const shopGroups = computed(() => parseBattleShopGroups(props.shop?.battles ?? []));
/** `mBattleGoodsDict`: the goods of each shop-list entry, pushed by `battleBelong`. */
const shopGroupGoods = computed(() =>
  groupBattleShopGoods(props.shop?.goods ?? [], shopGroups.value),
);
const shopGoods = computed(() => shopGroupGoods.value[shopGroupIndex.value] ?? []);
const shopPages = computed(() => Math.max(1, Math.ceil(shopGoods.value.length / SHOP_PAGE)));
const shopRows = computed(() =>
  shopGoods.value.slice(shopPage.value * SHOP_PAGE, (shopPage.value + 1) * SHOP_PAGE),
);

/** `doClickBattleItem`'s mBattleShopType: 1 for net battles (type 3), 2 for type 4, else 0. */
const shopType = computed(() => {
  const type = shopGroups.value[shopGroupIndex.value]?.type ?? 0;
  return type === 3 ? 1 : type === 4 ? 2 : 0;
});

/** The bottom bar's currency: shopType 0 trades in 荣誉, 1 in 功勋. */
const currencyName = computed(() =>
  shopType.value === 0 ? i18n('Shop_ShopDialog_9_1') : i18n('Shop_ShopDialog_9_2'),
);
const currencyAmount = computed(() =>
  shopType.value === 0 ? (props.shop?.honour ?? 0) : (props.shop?.gongxun ?? 0),
);

/** `doClickBattleItem`: switching a shop group resets the page. */
function onClickShopGroup(_row: BattleShopGroup, index: number): void {
  shopGroupIndex.value = index;
  shopPage.value = 0;
}

/** `createGoodsTip`: the cell's BattleShopGoodsTip through ui/tooltip's goods shape. */
function goodTip(good: BattleShopGood): TipValue {
  return props.shop ? { goods: battleShopGoodTip(good, props.shop) } : undefined;
}

function onPrevShopPage(): void {
  if (shopPage.value > 0) shopPage.value--;
}
function onNextShopPage(): void {
  if (shopPage.value < shopPages.value - 1) shopPage.value++;
}

function onTabInstruction(): void {
  instruction.value = true;
}

// ---- 新建战场 (onCreateBattle) ----
const creating = ref(false);

function onCreateBattle(): void {
  if (!selected.value) return;
  creating.value = true;
}

// ---- 加入场 (onJoinPVPBattle): BattlePanel fetches getPVPBattleInfo and opens the dialog ----
function onJoinPVPBattle(): void {
  if (!selected.value) return;
  emit('join', selected.value.id);
}

// ---- 重置参战次数 (onResetTodayWarCount) ----
async function onResetTodayWarCount(): Promise<void> {
  const answer = await showAlert(i18n('Battle_BattleChoiceDialogSrc_5'), '', ['yes', 'no']);
  if (answer !== 'yes') return;
  // a missing 请战书 (gid 138) opens the buy-and-use popup, which re-sends the command
  armBuyAgain([138], () => game.sendGlobalCommand('battle', 'resetTodayWarCount'));
  game.sendGlobalCommand('battle', 'resetTodayWarCount');
}

/** `onClose`: just hides; BattlePanel falls back to the world view. */
function close(): void {
  game.gotoView('world');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="12" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="16"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Battle_BattleChoiceDialog_1_1')"
    />
    <!-- tab row (the 跨服 / 赤壁 tabs are out of scope) -->
    <FxButton
      :x="21"
      :y="42"
      :w="75"
      style-name="ButtonGreen"
      :selected="battleType === 0"
      :label="i18n('Battle_BattleChoiceDialog_2_1')"
      @click="switchPanel(0)"
    />
    <FxButton
      :x="95"
      :y="42"
      :w="75"
      style-name="ButtonGreen"
      :selected="battleType === 1"
      :label="i18n('Battle_BattleChoiceDialog_3_1')"
      @click="switchPanel(1)"
    />
    <FxButton
      :x="169"
      :y="42"
      :w="75"
      style-name="ButtonGreen"
      :selected="battleType === 2"
      :label="i18n('Battle_BattleChoiceDialog_4_1')"
      @click="switchPanel(2)"
    />
    <FxButton
      :x="243"
      :y="42"
      :w="75"
      style-name="ButtonGreen"
      :selected="battleType === 3"
      :label="i18n('Battle_BattleChoiceDialog_11_1')"
      @click="switchPanel(3)"
    />
    <FxCanvas :x="472" :y="47" :w="150" :h="25" style-name="BoardListDown">
      <FxLabel
        :x="0"
        :y="3"
        :w="147"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', fontWeight: 'bold' }"
        :text="`${i18n('Battle_BattleChoiceDialogSrc_4')}${props.todayWarCount}/5)`"
      />
    </FxCanvas>
    <FxButton
      :x="478"
      :y="446"
      :w="85"
      style-name="ButtonGreen"
      :fx="{ fontSize: 16 }"
      :label="i18n('Battle_BattleChoiceDialog_8_1')"
      :tip="i18n('Battle_BattleChoiceDialogSrc_5')"
      @click="onResetTodayWarCount"
    />
    <FxButton :x="593" :y="447" style-name="Close" :fx="{ fontSize: 16 }" @click="close" />

    <!-- battle list -->
    <FxCanvas v-if="battleType < 2" :x="21" :y="79" :w="147" :h="366" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="141"
        :h="360"
        :row-height="20"
        :columns="[{ header: listHeader, field: 'name', width: 141 }]"
        :rows="groupBattles"
        selectable
        :selected-index="lastIndex"
        @item-click="onClickBattle"
      >
        <template #cell="{ row }">
          <span style="position: relative">
            {{ row.name }}
            <FxImage
              v-if="row.hasBattleAct"
              :x="0"
              :y="0"
              :w="20"
              :h="14"
              source="images/flag_battle_act.png"
            />
          </span>
        </template>
      </FxDataGrid>
    </FxCanvas>

    <!-- the shop tab's list (initBattleGroups' mBattleShops): the goods groups -->
    <FxCanvas v-if="battleType === 2" :x="21" :y="79" :w="147" :h="366" style-name="BoardListUp">
      <FxDataGrid
        :x="3"
        :y="3"
        :w="141"
        :h="360"
        :row-height="20"
        :columns="[{ header: listHeader, field: 'name', width: 141 }]"
        :rows="shopGroups"
        selectable
        :selected-index="shopGroupIndex"
        @item-click="onClickShopGroup"
      />
    </FxCanvas>

    <!-- the 战场商城 view (battleShop canvas): the selected group's goods, 12 per page -->
    <FxCanvas v-if="battleType === 2" :x="176" :y="79" :w="483" :h="366" style-name="BoardListUp">
      <FxCanvas v-if="shopPages > 1" :x="10" :y="330" :w="210" :h="36">
        <FxCanvas :x="8" :y="6" :w="70" :h="25" style-name="BoardListDown">
          <FxLabel
            :y="3"
            :w="70"
            style-name="ItemValue"
            :fx="{ textAlign: 'center', fontWeight: 'bold' }"
            :text="`${shopPage + 1}/${shopPages}`"
          />
        </FxCanvas>
        <FxButton :x="78" :y="0" :w="65" label="" @click="onPrevShopPage" />
        <FxButton :x="141" :y="0" :w="65" label="" @click="onNextShopPage" />
      </FxCanvas>
      <!-- the BattleShopItem cells: x 7/165/323, y 25/106/187/268 -->
      <FxCanvas
        v-for="(good, i) in shopRows"
        :key="good.id"
        :x="7 + (i % 3) * 158"
        :y="25 + Math.floor(i / 3) * 81"
        :w="153"
        :h="75"
        hand
        :tip="goodTip(good)"
        @click="emit('buyGood', good)"
      >
        <FxCanvas :x="5" :y="3" :w="68" :h="68" style-name="FramePicture">
          <FxImage :x="2" :y="2" :w="64" :h="64" :source="`images/${good.imageName}.png`" />
          <FxLabel
            :x="0"
            :y="49"
            :w="68"
            :h="19"
            :fx="{ textAlign: 'right', color: 16777215 }"
            :text="String(good.pack)"
          />
        </FxCanvas>
        <FxImage v-if="good.hasLeftImage" :x="0" :y="0" source="images/mall_special.png" />
        <FxCanvas :x="76" :y="4" :w="72" :h="20" style-name="BoardListDown">
          <FxLabel :x="0" :y="0" :w="72" :h="20" style-name="ItemTitle" :text="good.name" />
        </FxCanvas>
        <FxCanvas :x="76" :y="27" :w="72" :h="20" style-name="BoardListDown">
          <FxImage :x="2" :y="2" :w="16" :h="16" source="images/credit_goods.png" />
          <FxLabel
            :x="18"
            :y="0"
            :w="52"
            :h="20"
            style-name="ItemValue"
            :fx="{ textAlign: 'center' }"
            :text="String(good.creditPrice)"
          />
        </FxCanvas>
        <FxCanvas :x="76" :y="50" :w="72" :h="20" style-name="BoardListDown">
          <FxImage
            :x="2"
            :y="2"
            :w="16"
            :h="16"
            :source="`images/medal_${good.medalTypeId}_goods.png`"
          />
          <FxLabel
            :x="18"
            :y="0"
            :w="52"
            :h="20"
            style-name="ItemValue"
            :fx="{ textAlign: 'center' }"
            :text="String(good.medalPrice)"
          />
        </FxCanvas>
      </FxCanvas>
    </FxCanvas>

    <!-- the shop bottom bar (battleCanvas1): the currency and the medal buttons -->
    <FxCanvas v-if="battleType === 2" :x="16" :y="448" :w="651" :h="38">
      <FxCanvas :x="1" :y="4" :w="42" :h="26" style-name="BoardListUp">
        <FxLabel :x="4" :y="4" :w="38" style-name="ItemTitle" :text="currencyName" />
      </FxCanvas>
      <FxCanvas :x="50" :y="4" :w="84" :h="26" style-name="BoardListDown">
        <FxLabel :x="4" :y="4" :w="72" style-name="ItemValue" :text="String(currencyAmount)" />
      </FxCanvas>
      <FxButton
        v-if="shopType === 0"
        :x="180"
        :y="0"
        :w="76"
        style-name="ButtonGreen"
        :label="i18n('Shop_ShopDialog_10_1')"
        @click="emit('medalRecord')"
      />
      <FxButton
        v-if="shopType === 0"
        :x="268"
        :y="0"
        :w="76"
        style-name="ButtonYellow"
        :label="i18n('Shop_ShopDialog_11_1')"
        @click="emit('medalChange')"
      />
    </FxCanvas>

    <!-- detail (`switchPanel` hides it when the tab has no battle) -->
    <FxCanvas
      v-if="battleType < 2 && groupBattles.length > 0"
      :x="176"
      :y="79"
      :w="483"
      :h="366"
      style-name="BoardListUp"
    >
      <FxImage
        :x="9"
        :y="12"
        :w="250"
        :h="150"
        :source="`images/${selected?.id ?? 0}_battle_info.jpg`"
      />
      <FxLabel
        :x="270"
        :y="40"
        :w="205"
        :h="120"
        :fx="{ textAlign: 'center', color: 3289650 }"
        :text="detailTop"
      />
      <FxText
        :x="10"
        :y="170"
        :w="465"
        :h="140"
        :fx="{ color: 16776960 }"
        :html="String(selected?.content ?? '')"
      />
    </FxCanvas>

    <!-- bottom buttons (resetBottomCanvas hides them on the shop / invite tabs) -->
    <template v-if="battleType < 2">
      <FxButton
        :x="21"
        :y="446"
        :w="85"
        style-name="ButtonYellow"
        :fx="{ fontWeight: 'bold', fontSize: 14 }"
        :label="i18n('Battle_BattleChoiceDialog_5_1')"
        :tip="i18n('Battle_BattleChoiceDialog_4')"
        @click="onJoinPVPBattle"
      />
      <FxButton
        :x="114"
        :y="446"
        :w="85"
        style-name="ButtonYellow"
        :fx="{ fontWeight: 'bold', fontSize: 14 }"
        :label="i18n('Battle_BattleChoiceDialog_7_1')"
        :tip="
          selected?.canCreate
            ? i18n('Battle_BattleChoiceDialogSrc_6')
            : i18n('Battle_BattleChoiceDialogSrc_7')
        "
        :enabled="Boolean(selected?.canCreate)"
        @click="onCreateBattle"
      />
      <FxButton
        :x="207"
        :y="446"
        :w="85"
        style-name="ButtonYellow"
        :fx="{ fontWeight: 'bold', fontSize: 14 }"
        :label="i18n('Battle_BattleChoiceDialog_12')"
        @click="onTabInstruction"
      />
    </template>

    <!-- the dialogs over the hall -->
    <CreateBattleDialog
      v-if="creating && selected"
      :battle-id="selected.id"
      :battle-name="String(selected.name ?? '')"
      :max-level="Number(selected.maxlevel ?? 1)"
      @close="creating = false"
    />
    <!-- `onShowBattleInstruction`: the 战场说明 popup of the selected battle -->
    <FxCanvas
      v-if="instruction && selected"
      :w="682"
      :h="492"
      :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }"
      @click="instruction = false"
    >
      <FxCanvas :x="130" :y="60" :w="420" :h="380" style-name="PanelGreyGreen">
        <FxCanvas :x="153" :y="10" :w="114" :h="26" style-name="PopupTitle">
          <FxLabel
            :x="0"
            :y="3"
            :w="114"
            style-name="PopupDialogTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('Battle_BattleInfor_2_1')"
          />
        </FxCanvas>
        <FxImage :x="12" :y="44" :w="240" :h="140" :source="instructionImage" />
        <FxLabel
          :x="260"
          :y="48"
          :w="150"
          :h="20"
          :text="`${i18n('Battle_BattleInfor_7_1')}${selected?.name ?? ''}`"
        />
        <FxLabel
          :x="260"
          :y="72"
          :w="150"
          :h="20"
          :text="`${i18n('Battle_BattleInfor_8_1')}${instructionLevel}`"
        />
        <FxText
          :x="12"
          :y="192"
          :w="396"
          :h="120"
          :fx="{ color: 16776960 }"
          :html="String(selected?.content ?? '')"
        />
        <FxLabel :x="12" :y="312" :w="396" :h="20" :text="String(selected?.winCondition ?? '')" />
        <FxLabel :x="12" :y="336" :w="396" :h="20" :text="String(selected?.loseCondition ?? '')" />
        <FxButton
          :x="335"
          :y="330"
          :w="65"
          :h="30"
          :label="i18n('Battle_BattleInfor_1_1')"
          @click="instruction = false"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
