<script setup lang="ts">
import { computed } from 'vue';
import { endTimeText, timeLeftText } from '../../core/clock';
import {
  destroyBuildingTip,
  maxBuildingLevel,
  upgradeBuildingTip,
  type BuildingInfo,
} from '../../game/buildings';
import { BUILDING_GOVERNMENT } from '../../game/cityGrid';
import { useGame } from '../../game/game';
import { HERO_TYPE_KING } from '../../game/units';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Building.UpgradeBuildingItem: upgrade / demolish, or the countdown with cancel. */
const props = defineProps<{
  x: number;
  y: number;
  state: BuildingState;
  current: BuildingInfo | null;
  next: BuildingInfo | null;
  /** Server time of the last dialog tick, so the countdown follows it. */
  now: number;
}>();
const emit = defineEmits<{
  hide: [];
  destroyPanel: [handlers: { all: () => void; level: () => void }];
}>();

const game = useGame();
const city = useCityStore();
const user = useUserStore();

const upgrading = computed(() => props.state.state !== 0);
const levelDescription = computed(() =>
  props.next?.level === 1 ? props.next.levelDescription : (props.current?.levelDescription ?? ''),
);
const upgradingText = computed(() => {
  const s = props.state;
  if (s.state !== 1 && s.state !== 2) return '';
  const [left, end] = s.state === 2 ? [1, 2] : [3, 4];
  return (
    i18n(`Building_UpgradeBuildingItemSrc_${left}`) +
    timeLeftText(s.state_endtime - props.now, i18n) +
    i18n(`Building_UpgradeBuildingItemSrc_${end}`) +
    endTimeText(s.state_endtime)
  );
});

/** `Global.mKingInfo.kingLevel`: the king hero row of the city. */
const kingLevel = computed(() => {
  const king = city.heroes.find((h) => parseInt(String(h.herotype), 10) === HERO_TYPE_KING);
  return parseInt(String(king?.kingLevel), 10) || 0;
});
const maxLevel = computed(() => maxBuildingLevel(props.state.bid, city.type, kingLevel.value));

const upgradeTip = () => upgradeBuildingTip(props.current, props.next, maxLevel.value, city);
const destroyTip = () => destroyBuildingTip(props.current, city);
function accelerateTip() {
  if (props.state.state === 1) return upgradeTip();
  if (props.state.state === 2) return destroyTip();
  return null;
}

const t = (n: number) => i18n(`Building_UpgradeBuildingItemSrc_${n}`);

async function confirm(text: string): Promise<boolean> {
  return (await showAlert(text, '', ['yes', 'no'])) === 'yes';
}

async function startUpgrade() {
  const current = props.current;
  if (current && props.state.level >= maxLevel.value) {
    void showAlert(i18n('Building_UpgradeBuildingItem_2_1'));
    return;
  }
  if (props.state.bid === BUILDING_GOVERNMENT && current) {
    if (current.level === 4 && user.ustate === 1 && !(await confirm(t(5)))) return;
    if (current.level >= 10) {
      // City merging (合并城池) comes with the government dialogs.
      emit('hide');
      return;
    }
  }
  game.buildingCommand('startUpgradeBuilding', props.state.bid);
}

async function destroyOneLevel() {
  const s = props.state;
  if (await confirm(`${t(16)}${s.bname}${t(17)}${props.current?.level ?? 0})?`)) {
    game.buildingCommand('startDestroyBuilding', s.bid);
  }
}

async function destroyAll() {
  const s = props.state;
  if (await confirm(`${t(14)}${s.bname}${t(15)}${props.current?.level ?? 0})?`)) {
    game.buildingCommand('startDestroyBuildingAll', s.bid);
    game.closeDialog();
  }
}

async function startDestroy() {
  const s = props.state;
  const level = props.current?.level ?? 0;
  if (s.bid !== BUILDING_GOVERNMENT) {
    emit('destroyPanel', { all: () => void destroyAll(), level: () => void destroyOneLevel() });
  } else if (level === 1) {
    void showAlert(t(8));
  } else if (level > 10) {
    void showAlert(i18n('Building_UpgradeBuildingItem_7_1'));
  } else if (await confirm(`${t(9)}${s.bname}${t(10)}${level}${t(11)}`)) {
    game.buildingCommand('startDestroyBuilding', s.bid);
  }
}

async function cancel() {
  const s = props.state;
  if (s.state === 1) {
    if (await confirm(`${t(18)}${s.bname}${t(19)}${props.next?.level ?? 0})?`)) {
      game.buildingCommand('stopUpgradeBuilding', s.bid);
      if (s.level === 0) emit('hide');
    }
  } else if (s.state === 2) {
    if (await confirm(`${t(20)}${s.bname}${t(21)}${props.current?.level ?? 0})?`)) {
      game.buildingCommand('stopDestroyBuilding', s.bid);
    }
  }
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="646" :h="73" style-name="BoardListUp" :fx="{ fontSize: 12 }">
    <template v-if="!upgrading">
      <FxButton
        :x="90"
        :y="7"
        :w="50"
        :h="30"
        style-name="ButtonGreen"
        :fx="{ fontSize: 12, fontWeight: 'normal' }"
        :label="i18n('Building_UpgradeBuildingItem_1_1')"
        :enabled="next ? next.canUpgrade : true"
        :tip="{ resource: upgradeTip }"
        @click="startUpgrade"
      />
      <FxButton
        :x="90"
        :y="37"
        :w="50"
        :h="30"
        style-name="ButtonRed"
        :fx="{ fontSize: 12, fontWeight: 'normal' }"
        :label="i18n('Building_UpgradeBuildingItem_3_1')"
        :tip="{ resource: destroyTip }"
        @click="startDestroy"
      />
    </template>
    <template v-else>
      <!-- 加速 needs the item dialogs (UseGoodsDialog) of the shop. -->
      <FxButton
        :x="90"
        :y="7"
        :w="50"
        :h="30"
        style-name="ButtonYellow"
        :fx="{ fontSize: 12, fontWeight: 'normal' }"
        :label="i18n('Building_UpgradeBuildingItem_4_1')"
        :enabled="false"
        :tip="{ resource: accelerateTip }"
      />
      <FxButton
        :x="90"
        :y="37"
        :w="50"
        :h="30"
        style-name="ButtonRed"
        :fx="{ fontSize: 12, fontWeight: 'normal' }"
        :label="i18n('Building_UpgradeBuildingItem_5_1')"
        @click="cancel"
      />
    </template>
    <FxCanvas :x="8" :y="7" :w="76" :h="60" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="72"
        :h="56"
        :source="`images/building_intro_${state.bid}.png`"
        :tip="levelDescription"
      />
    </FxCanvas>
    <FxCanvas :x="147" :y="7" :w="491" :h="59" style-name="BoardListDown">
      <FxText :y="2" :w="486" :h="42" :right="0" scroll :text="state.description" />
      <FxLabel :x="5" :y="38" :w="476" :text="upgradingText" />
    </FxCanvas>
  </FxCanvas>
</template>
