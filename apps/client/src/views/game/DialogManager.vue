<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import {
  BUILDING_ARMY,
  BUILDING_BARN,
  BUILDING_BLACKSMITH,
  BUILDING_COLLEGE,
  BUILDING_GOVERNMENT,
  BUILDING_GROUND,
  BUILDING_HOTEL,
  BUILDING_STORE,
  BUILDING_WALL,
} from '../../game/cityGrid';
import type { BuildingState } from '../../stores/city';
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
import HotelDialog from '../hotel/HotelDialog.vue';
import MailDialog from '../mail/MailDialog.vue';
import MailDetailDialog from '../mail/MailDetailDialog.vue';
import MailWriteDialog from '../mail/MailWriteDialog.vue';
import ModifyPasswordDialog from '../system/ModifyPasswordDialog.vue';
import OpenLockDialog from '../system/OpenLockDialog.vue';
import BuyAndUseGoodsDialog from '../shop/BuyAndUseGoodsDialog.vue';
import ShopDialog from '../shop/ShopDialog.vue';
import StoreDialog from '../store/StoreDialog.vue';
import TaskDialog from '../task/TaskDialog.vue';
import WallDialog from '../wall/WallDialog.vue';
import CampaignFavouritesDialog from '../world/CampaignFavouritesDialog.vue';
import WorldActionDialog from '../world/WorldActionDialog.vue';
import CampaignDialog from '../ground/CampaignDialog.vue';
import TroopDialog from '../troop/TroopDialog.vue';
import TroopDetailDialog from '../troop/TroopDetailDialog.vue';
import BattleDialog from '../troop/BattleDialog.vue';
import ReportDialog from '../report/ReportDialog.vue';

/** DialogManager: the dialogs over the scene panels (only one shown at a time). */
defineProps<{ x: number; y: number }>();

const session = useSessionStore();

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
    <CampaignFavouritesDialog v-else-if="dialog?.name === 'favourites'" />
    <WorldActionDialog
      v-else-if="dialog?.name === 'worldAction'"
      :key="`worldAction ${dialog.cid}`"
      :cid="dialog.cid"
    />
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
      :y="130"
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
      @close="session.campaign = null"
    />
    <TroopDialog v-if="session.troopDialog" />
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
