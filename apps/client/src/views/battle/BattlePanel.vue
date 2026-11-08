<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { PushProc } from '@hot/shared';
import {
  parseBattleInforReply,
  parseBattleNewsReply,
  parseBattleTaskRows,
  type BattleInforState,
  type BattleNewsItem,
  type BattleTaskRow,
} from '../../game/battleInfor';
import {
  battleInviteChatMessage,
  memberCountStr,
  parseBattleFieldUsers,
  parseBattleInviteRows,
  parseCancelBattleInviteReply,
  parseInviteBattleUserReply,
  type BattleInviteRow,
  type BattleMemberRow,
} from '../../game/battleInvite';
import {
  parseBattleShopInfo,
  parseMedalExchangeInfo,
  parseMedalRecord,
  type BattleShopState,
  type MedalExchangeRow,
  type MedalRecordRow,
} from '../../game/battleShop';
import { parseBattleHonourStat, type HonourStatList } from '../../game/battleHonour';
import {
  battleGridPos,
  BUILDING_IMAGES,
  buildFiledViewRows,
  type BattleCity,
  type BattleTroop,
  FLAG_FONT_COLORS,
  FLAG_IMAGES,
  parseBattleFieldState,
  parseCallArmyReply,
  parseEnterBattle,
  parseHallReply,
  parsePVPBattleInfo,
  parseRefreshUserBattleState,
  parseUserBattleState,
  quitResultText,
  type FieldSnapshot,
  type HallBattle,
} from '../../game/battlefield';
import { armBuyAgain, consumeBuyAgain } from '../../game/battlefieldBuyAgain';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import BattleActionDialog from './BattleActionDialog.vue';
import BattleAttackDialog from './BattleAttackDialog.vue';
import BattleBuyGoodsDialog from './BattleBuyGoodsDialog.vue';
import BattleCampaignDialog from './BattleCampaignDialog.vue';
import BattleChoiceDialog from './BattleChoiceDialog.vue';
import BattleFiledViewDialog from './BattleFiledViewDialog.vue';
import BattleHonourStatDialog from './BattleHonourStatDialog.vue';
import BattleInforDialog from './BattleInforDialog.vue';
import BattleMedalChangeDialog from './BattleMedalChangeDialog.vue';
import BattleMedalRecordDialog from './BattleMedalRecordDialog.vue';
import BattleMenu from './BattleMenu.vue';
import BattleInviteDialog from './BattleInviteDialog.vue';
import BattleTaskDialog from './BattleTaskDialog.vue';
import BattleTroopDetailDialog from './BattleTroopDetailDialog.vue';
import BattleTroopEmptyItem from './BattleTroopEmptyItem.vue';
import BattleTroopItem from './BattleTroopItem.vue';
import BattleTroopViewDialog from './BattleTroopViewDialog.vue';
import CallArmyDialog from './CallArmyDialog.vue';
import InviteUserDialog from './InviteUserDialog.vue';
import JoinBattleDialog from './JoinBattleDialog.vue';

/**
 * Battle.BattlePanel: the 战场 view (map + side panel + the battle dialogs). One
 * `addGlobalReceiver('battle')` routes every `battle` reply like `BattlePanel.onCommand` did;
 * the map lays the `sys_battle_city` rows on the isometric grid and the heroPanel holds up to
 * two own troops (one in 千里走单骑). A 30s `onBattleRefresh` polls `refreshUserBattleState`
 * while the field runs; the 跨服 (BattleNet*) and the 9001 task side (RightButtonBar) are out of
 * the stage-9 local scope.
 */
const game = useGame();

// ---- hall / field state ----
const hallBattles = ref<HallBattle[]>([]);
const hallTodayWarCount = ref(0);
const showHall = ref(false);
const field = ref<FieldSnapshot | null>(null);
const showJoin = ref(false);
const joinBid = ref(0);
const joinBattles = ref<Record<string, unknown>[]>([]);
const joinUnions = ref<Record<string, unknown>[]>([]);

// ---- side panel / selection (currentBattleTroop, currentBattleTroopId) ----
const selectedTroopId = ref(-1);

// ---- filed view + its dialogs ----
const filedRows = ref<ReturnType<typeof buildFiledViewRows> | null>(null);
const filedState = ref<ReturnType<typeof parseBattleFieldState> | null>(null);
const showFiled = ref(false);
const showAction = ref(false);
const actionTroop = ref<Record<string, unknown> | null>(null);
const showAttack = ref(false);
const attackData = ref<{
  mine: Record<string, unknown>;
  target: Record<string, unknown>;
  city: string;
} | null>(null);
const showAddArmy = ref(false);
const addArmyData = ref<{ troops: Record<string, unknown>[]; reinforce: unknown } | null>(null);
const showTroopDetail = ref(false);
const troopDetail = ref<Record<string, unknown> | null>(null);
const showTroopView = ref(false);
const troopView = ref<Record<string, unknown> | null>(null);
const showChat = ref(false);
const chatQueue = ref<unknown[]>([]);

// ---- campaign (getCurrentCityGroundLevel1/2) ----
const showCampaign = ref(false);
const campaignGroundLevel = ref(0);

// ---- 战场说明 (Battle.BattleInfor: getBattleInfor / getBattleNews) ----
const showInfor = ref(false);
const inforState = ref<BattleInforState | null>(null);
const newsItems = ref<BattleNewsItem[]>([]);
const newsPage = ref(0);
const newsPageCount = ref(0);
const newsUnionid = ref(0);

// ---- 战场任务 (TaskStatusPanel over getLastMainTask) ----
const showTask = ref(false);
const taskRows = ref<BattleTaskRow[]>([]);

// ---- 战场成员 + 邀请 (InviteUserDialog / BattleInviteDialog) ----
const showMember = ref(false);
const memberRows = ref<BattleMemberRow[]>([]);
const memberCount = ref(0);
const memberIsCreator = ref(false);
const showInviteList = ref(false);
const inviteRows = ref<BattleInviteRow[]>([]);

// ---- 贡献排行 (BattleHonourStatDialog over getBattleHonourStat) ----
const showHonour = ref(false);
const honourLists = ref<HonourStatList[]>([]);

// ---- 战场商城 (BattleChoiceDialog 商店 tab over getUserBattleShopInfo / buyBattleGoods) ----
const shopState = ref<BattleShopState | null>(null);
const showBuy = ref(false);
const buyGood = ref<BattleShopState['goods'][number] | null>(null);
const showMedalChange = ref(false);
const medalRows = ref<MedalExchangeRow[]>([]);
const showMedalRecord = ref(false);
const medalRecordRows = ref<MedalRecordRow[]>([]);

// ---- callArmy dialog ----
const showCallArmy = ref(false);
const callArmyTroopId = ref(0);

// ---- menu ----
const showMenu = ref(false);

/** `leftTime = currentBattleInfo.endtime - Global.getServerTime()` (onTimer ticks it down). */
const leftTime = ref(0);
const timeLeftStr = ref('');
let secondTimer: ReturnType<typeof setInterval> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

const battle = computed(() => field.value?.battle ?? null);
const cities = computed(() => field.value?.cities ?? []);
const troops = computed(() => field.value?.troops ?? []);
const startCityInfo = computed(() => field.value?.startCityInfo ?? []);
const winpoints = computed(() => field.value?.winpoints ?? null);
const maxTroops = computed(() =>
  battle.value && (battle.value.bid === 5001 || battle.value.bid === 9001) ? 1 : 2,
);
const selectedTroop = computed(
  () => troops.value.find((t) => t.id === selectedTroopId.value) ?? null,
);

/** `resetWinpoint`: the 官渡 / 三让徐州 军粮 bars (only those bids carry the tail). */
const winpoint = computed(() => {
  const list = winpoints.value;
  if (!list || list.length < 2) return null;
  return {
    len1: Number(list[0]?.point ?? 0),
    len2: Number(list[1]?.point ?? 0),
    pointName: String(list[0]?.pointname ?? ''),
    totalPoint: Math.max(1, Number(list[0]?.totalpoint ?? 1)),
  };
});

function barWidth(len: number, total: number): number {
  return Math.round((174 * len) / total);
}

/** `Utils.MakeTimeLeftString`. */
function timeLeftText(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? h : '00'}${i18n('_Utils_5')}${pad(m)}${i18n('_Utils_6')}${pad(s % 60)}${i18n('_Utils_7')}`;
}

/** `onTimer`: the top countdown; the state texts follow `Battle_BattlePanelSrc_1/2`. */
function onSecond(): void {
  if (!battle.value) {
    timeLeftStr.value = '';
    return;
  }
  if (leftTime.value > 0) {
    leftTime.value -= 1;
    timeLeftStr.value = timeLeftText(leftTime.value);
  } else if (battle.value.state === 2) {
    timeLeftStr.value = i18n('Battle_BattlePanelSrc_1');
  } else if (battle.value.state === 3 || leftTime.value === 0) {
    timeLeftStr.value = i18n('Battle_BattlePanelSrc_2');
  }
}

/** `resetTroops`: refill the side panel; empty slots keep the frame image. */
const troopSlots = computed(() => {
  const list: (BattleTroop | null)[] = [];
  for (let i = 0; i < maxTroops.value; i++) list.push(troops.value[i] ?? null);
  return list;
});

/** `makeCurrentBlink`: the flag of the selected troop's position (state 4) or target (state 3). */
function isBlinking(city: BattleCity): boolean {
  const troop = selectedTroop.value;
  if (!troop) return false;
  return (
    (city.xy === troop.cid && troop.state === 4) ||
    (city.xy === troop.targetcid && troop.state === 3)
  );
}

/** `onSelectTroop`: mark the troop selected and blink its 据点. */
function selectTroopById(id: number): void {
  if (troops.value.some((t) => t.id === id)) selectedTroopId.value = id;
}

/** `onSelectTroop` after `selectOneTroop`: the reply refreshes the troop's position. */
function onSelectTroopReply(troop: unknown): void {
  const row = troop as Record<string, unknown> | null;
  if (!row) return;
  const local = troops.value.find((t) => t.id === Number(row.id));
  if (local) local.cid = Number(row.cid);
  selectTroopById(Number(row.id));
}

// ---- map click (`showBattleFieldViewDialog`) ----
function onCityClick(city: BattleCity): void {
  const b = battle.value;
  if (!b) return;
  game.sendGlobalCommand('battle', 'getBattleFieldState', [
    b.battlefieldid,
    b.unionid,
    city.cid,
    String(city.name ?? ''),
    selectedTroop.value ? selectedTroop.value.cid : -1,
  ]);
}

/** `showCityTroopDetailDialog`: one row's 军队详情 (`getCityBattleTroopDetail [troopid]`). */
function showCityTroopDetail(troopid: number): void {
  game.sendGlobalCommand('battle', 'getCityBattleTroopDetail', [troopid]);
}

// ---- BattleTroopItem menu results ----
function onTroopDetail(troop: BattleTroop): void {
  game.sendGlobalCommand('battle', 'getBattleTroopDetail', [troop.id]);
}

function onTroopCallArmy(troop: BattleTroop): void {
  openCallArmy(troop.id);
}

/** `troopQuitBattleField`: confirm then `callBackArmy [troopid]`. */
async function onTroopQuit(troop: BattleTroop): Promise<void> {
  const text =
    battle.value?.bid === 5001
      ? i18n('Battle_BattlePanelSrc_24')
      : i18n('Battle_BattlePanelSrc_21');
  const answer = await showAlert(text, '', ['yes', 'no']);
  if (answer !== 'yes') return;
  game.sendGlobalCommand('battle', 'callBackArmy', [troop.id]);
}

/** `showCallArmyDialog`: opens the 调遣援军 dialog for one troop. */
function openCallArmy(troopid: number): void {
  callArmyTroopId.value = troopid;
  showCallArmy.value = true;
}

/** `troopBackToBattleField` → confirm `Battle_BattlePanelSrc_22` → `callBackToField [id, bid]`. */
async function onTroopBack(troopid: number): Promise<void> {
  const answer = await showAlert(i18n('Battle_BattlePanelSrc_22'), '', ['yes', 'no']);
  if (answer !== 'yes') return;
  game.sendGlobalCommand('battle', 'callBackToField', [troopid, battle.value?.battlefieldid ?? -1]);
}

// ---- quit flow ----
/** `getQuitResult` → confirm → `quitBattle [User.username]`. */
async function onQuitResult(result: number): Promise<void> {
  const text = quitResultText(result, battle.value?.level ?? 1, i18n);
  const answer = await showAlert(text, '', ['yes', 'no']);
  if (answer !== 'yes') return;
  game.sendGlobalCommand('battle', 'quitBattle', [game.user.username]);
}

// ---- BattleFiledViewDialog ops ----
/** `BattleFiledViewDialog.onSendArmy` → `getInfoForBattleArmySend [troopid, cid, name]`. */
function onSendArmy(): void {
  const state = filedState.value;
  if (!state) return;
  if (selectedTroopId.value === -1) {
    void showAlert(i18n('Battle_BattleFieldViewDialogSrc_1'));
    return;
  }
  game.sendGlobalCommand('battle', 'getInfoForBattleArmySend', [
    selectedTroopId.value,
    state.cid,
    state.cityname,
  ]);
}

/** `BattleFiledViewDialog.onAttackArmy` → `getInfoForBattleArmyAttack [troopid, target, name]`. */
function onAttackArmy(targetTroopId: number): void {
  const state = filedState.value;
  if (!state) return;
  if (selectedTroopId.value === -1) {
    void showAlert(i18n('Battle_BattleFieldViewDialogSrc_2'));
    return;
  }
  game.sendGlobalCommand('battle', 'getInfoForBattleArmyAttack', [
    selectedTroopId.value,
    targetTroopId,
    state.cityname,
  ]);
}

/** `onPatrolItem`: confirm `Src_4` then `battlePatrol [troopid, target]` (信鸽 gid 140). */
async function onPatrolItem(targetTroopId: number): Promise<void> {
  const state = filedState.value;
  if (!state) return;
  if (selectedTroopId.value === -1) {
    void showAlert(i18n('Battle_BattleFieldViewDialogSrc_3'));
    return;
  }
  const answer = await showAlert(i18n('Battle_BattleFieldViewDialogSrc_4'), '', ['yes', 'no']);
  if (answer !== 'yes') return;
  armBuyAgain([140], () =>
    game.sendGlobalCommand('battle', 'battlePatrol', [
      selectedTroopId.value,
      targetTroopId,
      state.cityname,
    ]),
  );
  game.sendGlobalCommand('battle', 'battlePatrol', [
    selectedTroopId.value,
    targetTroopId,
    state.cityname,
  ]);
}

/** `onChatItem` → `chatWithHero [troopid, target]`. */
function onChatItem(targetTroopId: number): void {
  if (selectedTroopId.value === -1) {
    void showAlert(i18n('Battle_BattleFieldViewDialogSrc_5'));
    return;
  }
  game.sendGlobalCommand('battle', 'chatWithHero', [selectedTroopId.value, targetTroopId]);
}

/** `onAddArmy` → `getInfoForBattleArmyReinforce [cid]`. */
function onAddArmy(): void {
  const state = filedState.value;
  if (!state) return;
  game.sendGlobalCommand('battle', 'getInfoForBattleArmyReinforce', [state.cid]);
}

/** `onQuest` → `questInCity [currentTroopHid, cid]`. */
function onQuest(): void {
  const state = filedState.value;
  if (!state) return;
  game.sendGlobalCommand('battle', 'questInCity', [selectedTroop.value?.hid ?? 0, state.cid]);
}

// ---- the single `battle` receiver (BattlePanel.onCommand) ----
const unregister = game.addGlobalReceiver('battle', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  switch (command) {
    case 'getBattleInfo': {
      const hasBattle = Number(d.shift());
      if (hasBattle === 0 || hasBattle === 2) {
        const hall = parseHallReply(d);
        hallBattles.value = hall.battles;
        hallTodayWarCount.value = hall.todayWarCount;
        showHall.value = true;
        field.value = null;
      }
      break;
    }
    case 'getUserBattleState': {
      const parsed = parseUserBattleState(d);
      if (parsed.kind === 'hall') {
        hallBattles.value = parsed.state.battles;
        hallTodayWarCount.value = parsed.state.todayWarCount;
        showHall.value = true;
        field.value = null;
      } else {
        enterField(parsed.state);
      }
      break;
    }
    case 'createBattle':
    case 'joinToBattle':
    case 'joinToPVPBattle': {
      // the local reply is the entered field (the 9001 room branch is out of scope)
      const snapshot = parseEnterBattle(d);
      enterField(snapshot);
      showHall.value = false;
      showJoin.value = false;
      break;
    }
    case 'refreshUserBattleState': {
      const parsed = parseRefreshUserBattleState(d);
      if (parsed.kind === 'field') applyField(parsed.state);
      else {
        field.value = null;
        showFiled.value = false;
      }
      break;
    }
    case 'getPVPBattleInfo': {
      const parsed = parsePVPBattleInfo(d);
      joinBattles.value = parsed.battles;
      joinUnions.value = parsed.unions;
      showJoin.value = true;
      break;
    }
    case 'getBattleFieldState': {
      const state = parseBattleFieldState(d);
      filedState.value = state;
      const currentTroopCid = selectedTroop.value ? selectedTroop.value.cid : -1;
      filedRows.value = buildFiledViewRows(
        state.troops,
        battle.value ? battle.value.unionid : 0,
        state.cid,
        currentTroopCid,
      );
      showAction.value = false;
      showAttack.value = false;
      showAddArmy.value = false;
      showFiled.value = true;
      break;
    }
    case 'startBattleTroop': {
      const msg = String(d.shift() ?? '');
      if (msg) gameAlert(msg);
      game.sendGlobalCommand('battle', 'refreshUserBattleState');
      break;
    }
    case 'addArmyFromReinforce': {
      const msg = String(d.shift() ?? '');
      if (msg) void showAlert(msg);
      showAddArmy.value = false;
      game.sendGlobalCommand('battle', 'refreshUserBattleState');
      break;
    }
    case 'getBattleTroopDetail': {
      troopDetail.value = d[0] as Record<string, unknown>;
      showTroopDetail.value = true;
      break;
    }
    case 'getCityBattleTroopDetail': {
      troopView.value = d[0] as Record<string, unknown>;
      showTroopView.value = true;
      break;
    }
    case 'callBackArmy': {
      const msg = String(d.shift() ?? '');
      if (msg) void showAlert(msg);
      game.sendGlobalCommand('battle', 'refreshUserBattleState');
      break;
    }
    case 'selectOneTroop': {
      d.shift();
      onSelectTroopReply(d.shift());
      break;
    }
    case 'getInfoForBattleArmySend': {
      actionTroop.value = d.shift() as Record<string, unknown>;
      showAction.value = true;
      break;
    }
    case 'getInfoForBattleArmyReinforce': {
      addArmyData.value = {
        troops: (d.shift() as Record<string, unknown>[]) ?? [],
        reinforce: d.shift(),
      };
      showAddArmy.value = true;
      break;
    }
    case 'battleTroopDispatch': {
      const msg = String(d.shift() ?? '');
      if (msg) void showAlert(msg);
      showAction.value = false;
      showAttack.value = false;
      showFiled.value = false;
      game.sendGlobalCommand('battle', 'refreshUserBattleState');
      break;
    }
    case 'fasterArmy': {
      const info = d.shift() as Record<string, unknown> | null;
      if (troopDetail.value && info) troopDetail.value = { ...troopDetail.value, ...info };
      const msg = String(d.shift() ?? '');
      if (msg) void showAlert(msg);
      break;
    }
    case 'getInfoForBattleArmyAttack': {
      attackData.value = {
        mine: (d.shift() ?? {}) as Record<string, unknown>,
        target: (d.shift() ?? {}) as Record<string, unknown>,
        city: String(d.shift() ?? ''),
      };
      showAttack.value = true;
      break;
    }
    case 'chatWithHero':
    case 'questInCity': {
      if (d.length > 0) {
        chatQueue.value = d;
        showChat.value = true;
      }
      break;
    }
    case 'battleAttack': {
      const msg = String(d.shift() ?? '');
      if (msg) void showAlert(msg);
      showAttack.value = false;
      showFiled.value = false;
      game.sendGlobalCommand('battle', 'refreshUserBattleState');
      break;
    }
    case 'quitBattle': {
      const msg = String(d.shift() ?? '');
      if (msg) {
        void showAlert(msg);
        game.gotoView('world');
      }
      break;
    }
    case 'callBackToField': {
      const msg = String(d.shift() ?? '');
      if (msg) void showAlert(msg);
      showTroopDetail.value = false;
      game.sendGlobalCommand('battle', 'refreshUserBattleState');
      break;
    }
    case 'callArmy': {
      const parsed = parseCallArmyReply(d);
      if (parsed.ok) {
        const local = troops.value.find((t) => t.id === parsed.troopid);
        if (local) local.soldiers = parsed.soldiers;
        if (battle.value) battle.value.honour = parsed.honour;
      }
      if (parsed.message) gameAlert(parsed.message);
      break;
    }
    case 'getQuitResult': {
      void onQuitResult(Number(d.shift()));
      break;
    }
    case 'getCurrentCityGroundLevel1':
    case 'getCurrentCityGroundLevel2': {
      campaignGroundLevel.value = Number(d.shift());
      showCampaign.value = true;
      break;
    }
    case 'resetTodayWarCount': {
      const msg = String(d[2] ?? '');
      if (msg) void showAlert(msg);
      break;
    }
    case 'getBattleInfor': {
      inforState.value = parseBattleInforReply(d, battle.value?.bid ?? 0);
      newsItems.value = [];
      newsPage.value = 0;
      showInfor.value = true;
      break;
    }
    case 'getBattleNews': {
      const parsed = parseBattleNewsReply(d, newsUnionid.value);
      newsItems.value = parsed.items;
      newsPageCount.value = parsed.pageCount;
      showInfor.value = true;
      break;
    }
    case 'getLastMainTask': {
      taskRows.value = parseBattleTaskRows(d);
      showTask.value = true;
      break;
    }
    case 'getBattleFieldUsers': {
      const parsed = parseBattleFieldUsers(d);
      memberRows.value = parsed.rows;
      memberCount.value = parsed.count;
      memberIsCreator.value = parsed.isCreator;
      showMember.value = true;
      break;
    }
    case 'inviteBattleUser': {
      const parsed = parseInviteBattleUserReply(d);
      if (parsed.message) void showAlert(parsed.message);
      memberCount.value = parsed.count;
      if (parsed.row) {
        memberRows.value = [...memberRows.value, parsed.row];
        // sendBattleInvite: the invited player gets a private-chat line
        game.push?.request(PushProc.CHAT_PRIVATE_CHAT, {
          msg: battleInviteChatMessage(
            String(battle.value?.name ?? ''),
            Number(battle.value?.battlefieldid ?? 0),
          ),
          touser: parsed.row.name,
        });
      }
      showMember.value = true;
      break;
    }
    case 'cancelBattleInvite': {
      const parsed = parseCancelBattleInviteReply(d);
      if (parsed.message) void showAlert(parsed.message);
      if (parsed.id > 0) {
        memberRows.value = memberRows.value.filter((r) => r.id !== parsed.id);
      }
      showMember.value = true;
      break;
    }
    case 'getBattleInvite':
    case 'ignoreBattle': {
      inviteRows.value = parseBattleInviteRows(d);
      showInviteList.value = true;
      break;
    }
    case 'getBattleHonourStat': {
      const lists = parseBattleHonourStat(d);
      if (lists.length > 0) {
        honourLists.value = lists;
        showHonour.value = true;
      }
      break;
    }
    case 'getUserBattleShopInfo': {
      shopState.value = parseBattleShopInfo(d, true);
      showHall.value = true;
      break;
    }
    case 'buyBattleGoods': {
      d.shift();
      void showAlert(i18n('Shop_ShopDialogSrc_2'));
      showBuy.value = false;
      game.sendGlobalCommand('battle', 'getUserBattleShopInfo');
      break;
    }
    case 'medalChange': {
      void showAlert(i18n('Shop_ShopDialogSrc_3'));
      showMedalChange.value = false;
      break;
    }
    case 'getMedalExchangeInfo': {
      medalRows.value = parseMedalExchangeInfo(d);
      showMedalChange.value = true;
      break;
    }
    case 'getMedalRecord': {
      medalRecordRows.value = parseMedalRecord(d);
      showMedalRecord.value = true;
      break;
    }
    default:
      break;
  }
});
onUnmounted(unregister);

// the buy-and-use popup re-runs the armed command after the item was bought
const unregisterBuy = game.addGlobalReceiver('buybeforeuse', (_command, data) => {
  const gid = parseInt(String((data as unknown[] | null)?.[0]), 10) || 0;
  consumeBuyAgain(gid);
});
onUnmounted(unregisterBuy);

function applyField(snapshot: FieldSnapshot): void {
  field.value = snapshot;
  leftTime.value = Math.max(0, snapshot.battle.endtime - serverTime());
  onSecond();
  // keep the selection on the same troop, or select the first one
  if (
    selectedTroopId.value === -1 ||
    !snapshot.troops.some((t) => t.id === selectedTroopId.value)
  ) {
    if (snapshot.troops.length > 0) selectTroopById(snapshot.troops[0]!.id);
    else selectedTroopId.value = -1;
  }
}

function enterField(snapshot: FieldSnapshot): void {
  selectedTroopId.value = -1;
  applyField(snapshot);
}

/** `onBattleRefresh` (the 30s mCommandTimer; the poll hides the busy cursor like the AS3). */
function onPoll(): void {
  if (!battle.value) return;
  if (battle.value.state !== 3 && battle.value.state !== 1) {
    void game.cmd.sendGlobalCommand('battle', 'refreshUserBattleState', [], false);
  }
}

// ---- the 战场菜单 entries (BattleMenu's 说明 / 任务 / 成员 / 贡献排行 buttons) ----

/** `BattleInfor.getBattleInfor` over `currentBattleInfo`. */
function openInfor(): void {
  if (!battle.value) return;
  newsUnionid.value = battle.value.unionid;
  newsItems.value = [];
  newsPage.value = 0;
  game.sendGlobalCommand('battle', 'getBattleInfor', [
    battle.value.bid,
    battle.value.battlefieldid,
    battle.value.unionid,
  ]);
}

/** `BattleInfor.getBattleNews [battlefieldid, unionid, page, PAGE_COUNT]`. */
function openNews(page: number): void {
  if (!battle.value) return;
  newsUnionid.value = battle.value.unionid;
  newsPage.value = page;
  game.sendGlobalCommand('battle', 'getBattleNews', [
    battle.value.battlefieldid,
    battle.value.unionid,
    page,
    10,
  ]);
}

/** `TaskStatusPanel.onShow` — `getLastMainTask [9001]`. */
function openTask(): void {
  game.sendGlobalCommand('battle', 'getLastMainTask', [9001]);
}

/** `BattleMenu.showInviteUseDialog` → `getBattleFieldUsers [battlefieldid]`. */
function openMembers(): void {
  if (!battle.value) return;
  game.sendGlobalCommand('battle', 'getBattleFieldUsers', [battle.value.battlefieldid]);
}

/** `BattleMenu.displayHonourStat` → `getBattleHonourStat`. */
function openHonour(): void {
  game.sendGlobalCommand('battle', 'getBattleHonourStat');
}

/** `InviteUserDialog.inviteUser` → `inviteBattleUser [battlefieldid, name, username]`. */
function inviteMember(name: string): void {
  if (!battle.value) return;
  game.sendGlobalCommand('battle', 'inviteBattleUser', [
    battle.value.battlefieldid,
    name,
    game.user.username,
  ]);
}

/** The hall's 战场邀请 tab opener (`onShowBattleInvite`). */
function openBattleInvites(): void {
  game.sendGlobalCommand('battle', 'getBattleInvite');
}

onMounted(() => {
  // the entry the 战况 button fires (`TopPanel.gotoBattle` → getUserBattleState)
  game.sendGlobalCommand('battle', 'getUserBattleState');
  secondTimer = setInterval(onSecond, 1000);
  pollTimer = setInterval(onPoll, 30_000);
});
onUnmounted(() => {
  clearInterval(secondTimer);
  clearInterval(pollTimer);
});

const bid = computed(() => battle.value?.bid ?? 0);
const bgSource = computed(() => `images/battle_map_${bid.value}.png`);
</script>

<template>
  <FxCanvas :w="736" :h="556">
    <!-- hall -->
    <BattleChoiceDialog
      v-if="showHall && !field"
      :battles="hallBattles"
      :today-war-count="hallTodayWarCount"
      :shop="shopState"
      @join="
        ((showHall = false),
        (joinBid = $event),
        game.sendGlobalCommand('battle', 'getPVPBattleInfo', [$event]))
      "
      @shop="game.sendGlobalCommand('battle', 'getUserBattleShopInfo')"
      @invites="openBattleInvites"
      @medal-change="game.sendGlobalCommand('battle', 'getMedalExchangeInfo')"
      @medal-record="game.sendGlobalCommand('battle', 'getMedalRecord')"
      @buy-good="((showBuy = true), (buyGood = $event))"
    />
    <JoinBattleDialog
      v-if="showJoin"
      :key="`join ${joinBid}`"
      :bid="joinBid"
      :battles="joinBattles"
      :unions="joinUnions"
      @close="showJoin = false"
    />

    <!-- field -->
    <template v-if="field">
      <FxImage :x="0" :y="33" :source="bgSource" />
      <!-- 军粮 bars of 官渡 / 三让徐州 (`_BattlePanel_Canvas2/3`) -->
      <template v-if="winpoint">
        <FxCanvas
          :x="115"
          :y="42"
          :w="barWidth(winpoint.len1, winpoint.totalPoint)"
          :h="6"
          style-name="blooditem"
          :tip="`${i18n('Battle_BattlePanel_1_1')}${winpoint.pointName}${winpoint.len1}`"
        />
        <FxCanvas
          :x="443"
          :y="42"
          :w="barWidth(winpoint.len2, winpoint.totalPoint)"
          :h="6"
          style-name="blooditem"
          :tip="`${i18n('Battle_BattlePanel_2_1')}${winpoint.pointName}${winpoint.len2}`"
        />
      </template>
      <FxLabel
        :x="313"
        :y="35"
        :w="105"
        :h="20"
        :fx="{ textAlign: 'center', color: 16777215, fontSize: 12 }"
        :text="timeLeftStr"
      />
      <!-- the iso 据点 grid (battleCanvas + flagCanvas both at 3,3) -->
      <FxCanvas :x="3" :y="3">
        <template v-for="city in cities" :key="city.cid">
          <FxCanvas
            :x="battleGridPos(city.xy).x"
            :y="battleGridPos(city.xy).y"
            :w="56"
            :h="33"
            hand
            :tip="city.name"
            @click="onCityClick(city)"
          >
            <FxImage
              :x="0"
              :y="0"
              :w="56"
              :h="33"
              :source="BUILDING_IMAGES[Math.max(0, Math.min(11, city.image - 1))] ?? ''"
            />
            <FxImage
              v-if="FLAG_IMAGES[city.flag]"
              :x="23"
              :y="-6"
              :w="10"
              :h="10"
              :source="FLAG_IMAGES[city.flag]"
            />
            <FxLabel
              v-if="city.flagchar"
              :x="30"
              :y="-8"
              :w="12"
              :h="14"
              :fx="{
                color: FLAG_FONT_COLORS[city.flag] ?? 0,
                fontSize: 10,
                fontWeight: 'bold',
              }"
              :text="city.flagchar"
            />
            <!-- selection blink (makeCurrentBlink): a pulsing outline stands in for the filter -->
            <FxCanvas
              v-if="isBlinking(city)"
              :x="0"
              :y="0"
              :w="56"
              :h="33"
              :fx="{ backgroundColor: 16776960, backgroundAlpha: 0.25 }"
            />
          </FxCanvas>
        </template>
      </FxCanvas>

      <!-- heroPanel -->
      <FxCanvas :x="672" :y="50" :w="63" :h="200">
        <template v-for="(troop, i) in troopSlots" :key="i">
          <BattleTroopItem
            v-if="troop"
            :x="10"
            :y="i * 40"
            :troop="troop"
            :selected="troop.id === selectedTroopId"
            @select="selectTroopById($event.id)"
            @detail="onTroopDetail"
            @call-army="onTroopCallArmy"
            @quit="onTroopQuit"
          />
          <BattleTroopEmptyItem v-else :x="10" :y="i * 40" :index="i" />
        </template>
      </FxCanvas>

      <!-- left button bar (`LeftButtonBar`; the goods/buffer/task dialogs are peripheral) -->
      <FxCanvas :x="0" :y="73" :w="37" :h="155" style-name="LeftController">
        <FxButton
          :x="5"
          :y="23"
          :w="26"
          :h="26"
          style-name="TaskState"
          :tip="i18n('Chibi_ChibiMainView_RenWuZhuangTai')"
          :enabled="false"
        />
        <FxButton
          :x="5"
          :y="51"
          :w="26"
          :h="26"
          style-name="BattleGoods"
          :tip="i18n('Chibi_ChibiMainView_ZhangChangWuPin')"
          :enabled="false"
        />
        <FxButton
          :x="5"
          :y="78"
          :w="26"
          :h="26"
          style-name="HelpButton2"
          :tip="i18n('battlepanel_member_button_1')"
          :enabled="false"
        />
      </FxCanvas>

      <!-- `btnBattleMenu` -->
      <FxButton
        :x="690"
        :y="510"
        :w="40"
        :h="40"
        style-name="BattleMenu"
        @click="showMenu = true"
      />

      <!-- the dialogs over the map -->
      <BattleFiledViewDialog
        v-if="showFiled && filedState && filedRows"
        :state="filedState"
        :rows="filedRows.rows"
        :can-send="filedRows.canSend"
        :selected-troop="selectedTroop"
        @send-army="onSendArmy"
        @attack="onAttackArmy"
        @patrol="onPatrolItem"
        @chat="onChatItem"
        @view="showCityTroopDetail"
        @add-army="onAddArmy"
        @quest="onQuest"
        @close="showFiled = false"
      />
      <BattleActionDialog
        v-if="showAction && actionTroop"
        :troop="actionTroop"
        @close="showAction = false"
      />
      <BattleAttackDialog
        v-if="showAttack && attackData"
        :mine="attackData.mine"
        :target="attackData.target"
        :city="attackData.city"
        @close="showAttack = false"
      />
      <BattlefieldAddArmyDialog
        v-if="showAddArmy && addArmyData"
        :troops="addArmyData.troops"
        :reinforce="addArmyData.reinforce"
        :cid="filedState?.cid ?? 0"
        :city-name="filedState?.cityname ?? ''"
        @close="showAddArmy = false"
      />
      <BattleTroopDetailDialog
        v-if="showTroopDetail && troopDetail"
        :info="troopDetail"
        @close="showTroopDetail = false"
        @call-army="openCallArmy(Number(troopDetail?.id ?? 0))"
        @back="onTroopBack(Number(troopDetail?.id ?? 0))"
      />
      <BattleTroopViewDialog
        v-if="showTroopView && troopView"
        :troop="troopView"
        @close="showTroopView = false"
      />
      <BattleChatDialog v-if="showChat" :queue="chatQueue" @close="showChat = false" />
      <CallArmyDialog
        v-if="showCallArmy"
        :key="`callArmy ${callArmyTroopId}`"
        :troopid="callArmyTroopId"
        :troop="troops.find((t) => t.id === callArmyTroopId) ?? null"
        :honour="battle?.honour ?? 0"
        :battle="battle"
        @close="showCallArmy = false"
      />
      <BattleCampaignDialog
        v-if="showCampaign && battle"
        :ground-level="campaignGroundLevel"
        :battle="battle"
        :start-city-info="startCityInfo"
        @close="showCampaign = false"
      />
      <BattleMenu
        v-if="showMenu"
        @close="showMenu = false"
        @campaign="
          ((showMenu = false),
          game.sendGlobalCommand('battle', 'getCurrentCityGroundLevel2', [game.city.cid]))
        "
        @infor="((showMenu = false), openInfor())"
        @task="((showMenu = false), openTask())"
        @member="((showMenu = false), openMembers())"
        @honour="((showMenu = false), openHonour())"
        @quit="((showMenu = false), game.sendGlobalCommand('battle', 'getQuitResult'))"
      />
      <BattleInforDialog
        v-if="showInfor && inforState"
        :infor="inforState"
        :news="newsItems"
        :news-page="newsPage"
        :news-page-count="newsPageCount"
        @close="showInfor = false"
        @news="openNews(newsPage)"
        @prev-page="newsPage > 0 && openNews(newsPage - 1)"
        @next-page="newsPage < newsPageCount - 1 && openNews(newsPage + 1)"
      />
    </template>

    <!-- the menu / hall sub-dialogs (all of them self-contained over their flags) -->
    <BattleTaskDialog v-if="showTask" :tasks="taskRows" @close="showTask = false" />
    <InviteUserDialog
      v-if="showMember"
      :rows="memberRows"
      :count-str="
        memberCountStr(memberCount, Number(battle?.maxpeople ?? 0), Number(battle?.bid ?? 0))
      "
      :is-creator="memberIsCreator"
      @close="showMember = false"
      @invite="inviteMember"
      @cancel="(id) => game.sendGlobalCommand('battle', 'cancelBattleInvite', [id])"
    />
    <BattleInviteDialog
      v-if="showInviteList"
      :rows="inviteRows"
      @close="showInviteList = false"
      @join="
        (id) => {
          showInviteList = false;
          game.sendGlobalCommand('battle', 'joinToBattle', [id]);
        }
      "
      @ignore="(id) => game.sendGlobalCommand('battle', 'ignoreBattle', [id])"
    />
    <BattleHonourStatDialog v-if="showHonour" :lists="honourLists" @close="showHonour = false" />
    <BattleMedalChangeDialog
      v-if="showMedalChange"
      :rows="medalRows"
      @close="showMedalChange = false"
      @change="(count, tid) => game.sendGlobalCommand('battle', 'medalChange', [count, tid])"
    />
    <BattleMedalRecordDialog
      v-if="showMedalRecord"
      :rows="medalRecordRows"
      @close="showMedalRecord = false"
    />
    <BattleBuyGoodsDialog
      v-if="showBuy && buyGood"
      :good="buyGood"
      @close="showBuy = false"
      @buy="
        (count) =>
          game.sendGlobalCommand('battle', 'buyBattleGoods', [
            buyGood?.id ?? 0,
            count,
            buyGood?.battleGoodsType ?? 0,
            game.city.cid,
          ])
      "
    />
  </FxCanvas>
</template>
