<script setup lang="ts">
import { computed, ref } from 'vue';
import type { HallBattle } from '../../game/battlefield';
import type { BattleShopGood, BattleShopState } from '../../game/battleShop';
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

/** `doClickBattleItem` (the list click) + `switchPanel` (the tab). */
function switchPanel(group: number): void {
  battleType.value = group;
  lastIndex.value = 0;
  if (group === 2) emit('shop');
  if (group === 3) emit('invites');
}
function onClickBattle(_row: HallBattle, index: number): void {
  lastIndex.value = index;
}

// ---- the 战场商城 view (mBattleShopType: the shop rows of the getUserBattleShopInfo reply) ----
const SHOP_PAGE = 12;
const shopPage = ref(0);
const shopGoods = computed(() => props.shop?.goods ?? []);
const shopPages = computed(() => Math.max(1, Math.ceil(shopGoods.value.length / SHOP_PAGE)));
const shopRows = computed(() =>
  shopGoods.value.slice(shopPage.value * SHOP_PAGE, (shopPage.value + 1) * SHOP_PAGE),
);

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
        :columns="[{ header: i18n('Battle_BattleChoiceDialogSrc_1'), field: 'name', width: 141 }]"
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

    <!-- detail (`switchPanel` hides it when the tab has no battle) -->
    <!-- the 战场商城 view: the goods of the first battleBelong group, 12 per page -->
    <FxCanvas v-if="battleType === 2" :x="21" :y="79" :w="638" :h="366" style-name="BoardListUp">
      <FxLabel
        :x="10"
        :y="8"
        :w="200"
        style-name="ItemTitle"
        :text="`${i18n('Shop_ShopDialog_9_1')} ${props.shop?.honour ?? 0}`"
      />
      <FxButton
        :x="410"
        :y="4"
        :w="100"
        style-name="ButtonYellow"
        :label="i18n('Shop_ShopDialog_11_1')"
        @click="emit('medalChange')"
      />
      <FxButton
        :x="520"
        :y="4"
        :w="100"
        style-name="ButtonYellow"
        :label="i18n('Shop_ShopDialog_10_1')"
        @click="emit('medalRecord')"
      />
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
      <FxCanvas
        v-for="(good, i) in shopRows"
        :key="good.id"
        :x="12 + (i % 4) * 152"
        :y="40 + Math.floor(i / 4) * 100"
        :w="146"
        :h="94"
        style-name="BoardListDown"
        @click="emit('buyGood', good)"
      >
        <FxCanvas :x="4" :y="4" :w="68" :h="68" style-name="FramePicture">
          <FxImage :x="2" :y="2" :w="64" :h="64" :source="`images/${good.imageName}.png`" />
        </FxCanvas>
        <FxLabel
          :x="78"
          :y="6"
          :w="64"
          :h="60"
          :fx="{ textAlign: 'left', fontSize: 12 }"
          :text="good.name"
        />
        <FxLabel
          :x="4"
          :y="74"
          :w="138"
          :fx="{ textAlign: 'center', fontSize: 12 }"
          :text="`${good.medalName} ${good.medalPrice}，${i18n('Shop_ShopDialog_9_1')} ${good.creditPrice}`"
        />
      </FxCanvas>
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
