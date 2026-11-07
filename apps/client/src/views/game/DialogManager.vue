<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import {
  BUILDING_ARMY,
  BUILDING_BARN,
  BUILDING_BLACKSMITH,
  BUILDING_COLLEGE,
  BUILDING_GOVERNMENT,
  BUILDING_GROUND,
  BUILDING_HONGLU,
  BUILDING_HOTEL,
  BUILDING_MARKET,
  BUILDING_OFFICE,
  BUILDING_STORE,
  BUILDING_WALL,
} from '../../game/cityGrid';
import type { BuildingState } from '../../stores/city';
import { useGame } from '../../game/game';
import { useSessionStore } from '../../stores/session';
import ArmyDialog from '../army/ArmyDialog.vue';
import BarnDialog from '../barn/BarnDialog.vue';
import BlackSmithDialog from '../blacksmith/BlackSmithDialog.vue';
import BuildingExchangePanel from '../building/BuildingExchangePanel.vue';
import BuildingListDialog from '../building/BuildingListDialog.vue';
import CreateBuildingDialog from '../building/CreateBuildingDialog.vue';
import DestroyPanel from '../building/DestroyPanel.vue';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import CollegeDialog from '../college/CollegeDialog.vue';
import HeroDetailDialog from '../hero/HeroDetailDialog.vue';
import CityFieldDialog from '../government/CityFieldDialog.vue';
import CityListDialog from '../government/CityListDialog.vue';
import MyGoodsDialog from '../goods/MyGoodsDialog.vue';
import UseGoodsDialog from '../goods/UseGoodsDialog.vue';
import GovernmentDialog from '../government/GovernmentDialog.vue';
import ResourceProductDialog from '../government/ResourceProductDialog.vue';
import GroundDialog from '../ground/GroundDialog.vue';
import HongluDialog from '../honglu/HongluDialog.vue';
import HotelDialog from '../hotel/HotelDialog.vue';
import OfficeDialog from '../office/OfficeDialog.vue';
import MailDialog from '../mail/MailDialog.vue';
import MailDetailDialog from '../mail/MailDetailDialog.vue';
import MailWriteDialog from '../mail/MailWriteDialog.vue';
import MarketDialog from '../market/MarketDialog.vue';
import ModifyPasswordDialog from '../system/ModifyPasswordDialog.vue';
import OpenLockDialog from '../system/OpenLockDialog.vue';
import ArmorDialog from '../armor/ArmorDialog.vue';
import BuyAndUseGoodsDialog from '../shop/BuyAndUseGoodsDialog.vue';
import ShopDialog from '../shop/ShopDialog.vue';
import StoreDialog from '../store/StoreDialog.vue';
import TaskDialog from '../task/TaskDialog.vue';
import WallDialog from '../wall/WallDialog.vue';
import CampaignFavouritesDialog from '../world/CampaignFavouritesDialog.vue';
import WorldActionDialog from '../world/WorldActionDialog.vue';
import CityMergeDialog from '../world/CityMergeDialog.vue';
import FriendDialog from '../friend/FriendDialog.vue';
import UnionDialog from '../union/UnionDialog.vue';
import CampaignDialog from '../ground/CampaignDialog.vue';
import TroopDialog from '../troop/TroopDialog.vue';
import TroopDetailDialog from '../troop/TroopDetailDialog.vue';
import BattleDialog from '../troop/BattleDialog.vue';
import ReportDialog from '../report/ReportDialog.vue';
import RankDialog from '../rank/RankDialog.vue';
import TrickDialog from '../trick/TrickDialog.vue';
import TrickBufferDialog from '../trick/TrickBufferDialog.vue';
import UserAchivement from '../achivement/UserAchivement.vue';
import AchivementDialog from '../achivement/AchivementDialog.vue';
import StatDialog from '../stat/StatDialog.vue';
import UserInfoDialog from '../user/UserInfoDialog.vue';
import LotteryDialog from '../lottery/MainDialog.vue';
import ArenaDialog from '../arena/ArenaDialog.vue';
import GuoGuanZhanJiangDialog from '../guoguanzhuanjiang/GuoGuanZhanJiangDialog.vue';
import LuoYangBattlePanel from '../luoyang/LuoYangBattlePanel.vue';
import LuoYangBelongPanel from '../luoyang/LuoYangBelongPanel.vue';
import MarryMainPanel from '../marry/MarryMainPanel.vue';
import FuncBtnPanel from './FuncBtnPanel.vue';
import ChangeStateDialog from '../user/ChangeStateDialog.vue';
import GovernPanel from '../world/GovernPanel.vue';

/** DialogManager: the dialogs over the scene panels (only one shown at a time). */
defineProps<{ x: number; y: number }>();

const session = useSessionStore();
const game = useGame();

const dialog = computed(() => session.dialog);
const buildingKey = computed(() => {
  const d = dialog.value;
  return d?.name === 'building' ? `${d.building.inner},${d.building.x},${d.building.y}` : '';
});

/** `showBuildingDialog`: built buildings with a dialog of their own use it (`getBuildingDialog`). */
function ownDialog(building: BuildingState, bid: number): boolean {
  return building.level > 0 && building.bid === bid;
}

/** `showDestroyPanel`: on top of the building dialog until a choice or another dialog. */
const destroy = shallowRef<{ all: () => void; level: () => void } | null>(null);
watch(dialog, () => (destroy.value = null));

function choose(action: 'all' | 'level') {
  const handlers = destroy.value;
  destroy.value = null;
  handlers?.[action]();
}
</script>

<template>
  <div class="dialog-manager" :style="{ left: `${x}px`, top: `${y}px` }">
    <CreateBuildingDialog
      v-if="dialog?.name === 'createBuilding'"
      :key="dialog.kind"
      :kind="dialog.kind"
    />
    <BuildingListDialog v-else-if="dialog?.name === 'buildingList'" />
    <ResourceProductDialog v-else-if="dialog?.name === 'resourceProduct'" />
    <CityListDialog v-else-if="dialog?.name === 'cityList'" />
    <CityFieldDialog
      v-else-if="dialog?.name === 'cityField'"
      :key="`cityField ${dialog.wid}`"
      :wid="dialog.wid"
    />
    <OpenLockDialog v-else-if="dialog?.name === 'openLock'" :type="dialog.type" />
    <ModifyPasswordDialog v-else-if="dialog?.name === 'modifyPassword'" />
    <TaskDialog v-else-if="dialog?.name === 'task'" />
    <MyGoodsDialog v-else-if="dialog?.name === 'myGoods'" />
    <ArmorDialog v-else-if="dialog?.name === 'armor'" />
    <ChangeStateDialog v-else-if="dialog?.name === 'changeState'" @close="game.closeDialog()" />
    <CampaignFavouritesDialog v-else-if="dialog?.name === 'favourites'" />
    <WorldActionDialog
      v-else-if="dialog?.name === 'worldAction'"
      :key="`worldAction ${dialog.cid}`"
      :cid="dialog.cid"
    />
    <CityMergeDialog
      v-else-if="dialog?.name === 'cityMerge'"
      :key="`cityMerge ${dialog.selectCid}`"
      :select-cid="dialog.selectCid"
    />
    <FriendDialog v-else-if="dialog?.name === 'friend'" />
    <UnionDialog v-else-if="dialog?.name === 'union'" />
    <RankDialog v-else-if="dialog?.name === 'rank'" />
    <TrickDialog
      v-else-if="dialog?.name === 'trick'"
      :key="`trick ${dialog.trickType} ${dialog.params.join(',')}`"
      :trick-type="dialog.trickType"
      :params="dialog.params"
    />
    <UserAchivement
      v-else-if="dialog?.name === 'userAchievement'"
      :key="`userAchievement ${dialog.userid}`"
      :userid="dialog.userid"
      :username="dialog.username"
    />
    <AchivementDialog v-else-if="dialog?.name === 'achievementRank'" />
    <StatDialog v-else-if="dialog?.name === 'stat'" />
    <UserInfoDialog v-else-if="dialog?.name === 'userInfo'" />
    <LotteryDialog v-else-if="dialog?.name === 'lottery'" />
    <GuoGuanZhanJiangDialog v-else-if="dialog?.name === 'zhanjiang'" />
    <ArenaDialog v-else-if="dialog?.name === 'arena'" />
    <LuoYangBattlePanel v-else-if="dialog?.name === 'luoyangBattle'" />
    <LuoYangBelongPanel
      v-else-if="dialog?.name === 'luoyangBelong'"
      @battle="game.openLuoyangBattle()"
      @close="game.closeDialog()"
    />
    <MarryMainPanel v-else-if="dialog?.name === 'marry'" />
    <HeroDetailDialog
      v-else-if="dialog?.name === 'heroDetail'"
      :key="`hero ${dialog.hid}`"
      :hid="dialog.hid"
    />
    <GovernmentDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_GOVERNMENT)"
      :key="`government ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <CollegeDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_COLLEGE)"
      :key="`college ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <ArmyDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_ARMY)"
      :key="`army ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <GroundDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_GROUND)"
      :key="`ground ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <OfficeDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_OFFICE)"
      :key="`office ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <HongluDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_HONGLU)"
      :key="`honglu ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <HotelDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_HOTEL)"
      :key="`hotel ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <BlackSmithDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_BLACKSMITH)"
      :key="`blacksmith ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <WallDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_WALL)"
      :key="`wall ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <StoreDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_STORE)"
      :key="`store ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <BarnDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_BARN)"
      :key="`barn ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <MarketDialog
      v-else-if="dialog?.name === 'building' && ownDialog(dialog.building, BUILDING_MARKET)"
      :key="`market ${buildingKey}`"
      :x="0"
      :y="0"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <UpgradeBuildingDialog
      v-else-if="dialog?.name === 'building'"
      :key="buildingKey"
      :x="0"
      :y="130"
      :building="dialog.building"
      @destroy-panel="destroy = $event"
    />
    <DestroyPanel
      v-if="destroy"
      @all="choose('all')"
      @level="choose('level')"
      @close="destroy = null"
    />
    <BuildingExchangePanel
      v-if="session.exchange"
      v-show="session.exchangeOpen"
      :x="(736 - 292) / 2"
      :y="(556 - 230) / 2 - 30"
      :building="session.exchange"
    />
    <UseGoodsDialog v-if="session.useGoods" :request="session.useGoods" />
    <ShopDialog v-if="session.shop" :target-tab="session.shop.tab" />
    <BuyAndUseGoodsDialog v-if="session.buyAndUse" :request="session.buyAndUse" />
    <MailDialog v-if="session.mail" />
    <MailDetailDialog
      v-if="session.mailDetail"
      :key="`maildetail ${session.mailDetail.mid}`"
      :mid="session.mailDetail.mid"
      :page="session.mailDetail.page"
    />
    <MailWriteDialog
      v-if="session.mailWrite"
      :reply="session.mailWrite.reply"
      :receiver="session.mailWrite.receiver"
    />
    <CampaignDialog
      v-if="session.campaign"
      :key="`campaign ${session.campaign.targetCid}`"
      :ground-bid="session.campaign.groundBid"
      :ground-param="session.campaign.groundParam"
      :target-cid="session.campaign.targetCid"
      :task-index="session.campaign.taskIndex"
      :from-luoyang="session.campaign.fromLuoyang ?? false"
      @close="session.campaign = null"
    />
    <TroopDialog v-if="session.troopDialog" />
    <!-- 计谋状态 (TopPanel trick button): a pop-up that does not close the dialogs under it. -->
    <TrickBufferDialog v-if="session.trickBuffer" @close="game.closeTrickBuffer()" />
    <!-- 功能按钮区 (BloodWar openBtn): the combined function buttons pop-up. -->
    <FuncBtnPanel v-if="session.funcButtons" @close="game.toggleFuncButtons()" />
    <!-- 洛阳政令 (LuoYangBelongPanel characterThree): the mode-2 GovernPanel over the scene. -->
    <GovernPanel
      v-if="session.luoyangGovern"
      :from-flag="2"
      :luoyang-count="session.luoyangGovern.count"
      @close="session.luoyangGovern = null"
    />
    <TroopDetailDialog
      v-if="session.troopDetail"
      :key="`troopDetail ${session.troopDetail.troop.id}`"
      :troop="session.troopDetail.troop"
      :army-type="session.troopDetail.armyType"
      @close="session.troopDetail = null"
    />
    <ReportDialog v-if="session.report" />
    <BattleDialog
      v-if="session.battle"
      :key="`battle ${session.battle.battleid}`"
      :battleid="session.battle.battleid"
      :user-is-attack="session.battle.userIsAttack"
    />
  </div>
</template>

<style scoped>
.dialog-manager {
  position: absolute;
  width: 736px;
  height: 556px;
  pointer-events: none !important;
}

.dialog-manager > :deep(*) {
  pointer-events: auto;
}
</style>
