<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  battleChapters,
  battleDesc,
  calcHeroAttr,
  dropGoodOf,
  enterCondition,
  maxBattleOf,
  parseBuyJunling,
  parseCampaignInit,
  parseCampaignMax,
  parsePkBattle,
  parsePkFirstReward,
  parsePkRewardRank,
  applyShowState,
  type LadderHero,
} from '../../game/campaign-pk';
import { treasureItems } from '../../game/goods';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import type { TipValue } from '../../ui/tooltip';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';
import TreasureGetDialog from '../goods/TreasureGetDialog.vue';
import BattleHeroItem from './BattleHeroItem.vue';
import BattleItem from './BattleItem.vue';
import BuyBattleGoodDialog from './BuyBattleGoodDialog.vue';
import HeroBattlePanel from './HeroBattlePanel.vue';
import StartChallengePanel from './StartChallengePanel.vue';
import ZhanJiangRewardDialog from './ZhanJiangRewardDialog.vue';

/**
 * GuoGuanZhanJiang.GuoGuanZhanJiangDialog (`showZhanjiangDialog`): the 过关斩将 ladder. Pick the
 * difficulty (普通/精英), page through the ten chapters and their floors, then 进军 opens the
 * StartChallengePanel; a fight replays in the shared HeroBattlePanel. 军令 is bought in place,
 * the chapter's first-pass top three opens from 榜首奖励, and a won chest shows through the
 * existing TreasureGetDialog (`newTreasureGetDialog` chain).
 */
const game = useGame();
const user = useUserStore();

const BATTLE_VISIBLE = 7;
const HERO_VISIBLE = 8;

const flag = ref(0); // 0 普通, 1 精英
const init = ref<ReturnType<typeof parseCampaignInit> | null>(null);
const battlePage = ref(0);
const heroPage = ref(0);
const chapter = ref(1);
const floor = ref<number | null>(null);
const showBuy = ref(false);
const showChallenge = ref(false);
const showReward = ref(false);
const rewardRanks = ref<ReturnType<typeof parsePkRewardRank>>([]);
const battle = ref<ReturnType<typeof parsePkBattle>>(null);
const battleNames = ref<Record<number, string>>({});
const treasure = ref<ReturnType<typeof treasureItems>>([]);

const chapters = battleChapters((id) => i18n(`Hero_Battle_Dialog_battle_name_${id}`));
/** `holdUserMaxData` of the current difficulty: the reached chapter and its next floor. */
const maxOf = computed(() => {
  const i = init.value;
  if (!i) return { battleId: 1, floor: 1 };
  return maxBattleOf(
    flag.value === 0 ? i.normal : i.special,
    flag.value === 0 ? i.common : i.specialHeroes,
  );
});
const maxBattleId = computed(() => maxOf.value.battleId);
const maxFloor = computed(() => maxOf.value.floor);

/** The heroes of the current difficulty (`UserBattleCommonHeroListArray` / special). */
const ladderHeroes = computed<LadderHero[]>(() =>
  flag.value === 0 ? (init.value?.common ?? []) : (init.value?.specialHeroes ?? []),
);
/** `saveHerosByBattleType`: the per-chapter buckets the tips read. */
const heroesByBattle = computed(() => {
  const map = new Map<number, LadderHero[]>();
  for (const hero of ladderHeroes.value) {
    const list = map.get(hero.battleid) ?? [];
    list.push(hero);
    map.set(hero.battleid, list);
  }
  return map;
});
const chapterHeroesOf = (battleid: number): LadderHero[] =>
  heroesByBattle.value.get(battleid) ?? [];
const chapterHeroes = computed(() => chapterHeroesOf(chapter.value));

/** `getHerosData(2, …)`: the three NPC heroes of the selected floor. */
const enemyHeroes = computed<(LadderHero | null)[]>(() => {
  if (floor.value == null) return [null, null, null];
  const rows = chapterHeroes.value
    .filter((h) => h.levelid === floor.value)
    .sort((a, b) => a.area - b.area)
    .slice(0, 3)
    .map((h) => calcHeroAttr(h));
  return [rows[0] ?? null, rows[1] ?? null, rows[2] ?? null];
});

const dropGood = computed(() => dropGoodOf(init.value?.rewards ?? [], chapter.value, flag.value));
const dropTip = computed<TipValue | undefined>(() => {
  const good = dropGood.value;
  return good
    ? { goods: { title: String(good.name ?? ''), text: String(good.description ?? '') } }
    : undefined;
});
const dropImage = computed(() => {
  const good = dropGood.value;
  if (!good) return null;
  const image = Number(good.image ?? 0);
  return image === 0 ? `images/item_${Number(good.gid ?? 0)}.png` : `images/pack_${image}.png`;
});

const visibleChapters = computed(() =>
  chapters.slice(battlePage.value, battlePage.value + BATTLE_VISIBLE),
);
const visibleHeroes = computed(() =>
  chapterHeroes.value.slice(heroPage.value, heroPage.value + HERO_VISIBLE),
);
const heroTotalPages = computed(() =>
  Math.max(1, Math.ceil(chapterHeroes.value.length / HERO_VISIBLE)),
);

/** `doSelectType`: switching the difficulty resets the selection to the reached chapter. */
function setFlag(value: boolean, next: number): void {
  if (!value) return;
  if (flag.value === next) return;
  flag.value = next;
  floor.value = null;
  chapter.value = Math.min(chapter.value, maxBattleId.value);
  battlePage.value = 0;
  heroPage.value = 0;
}

/** `BattleItem.___Image1_click`: only the reached chapters open (`isCanClick`). */
function selectChapter(data: number): void {
  if (data > maxBattleId.value) {
    void showAlert(i18n('Hero_Battle_Dialog_battle_tip_lock'));
    return;
  }
  chapter.value = data;
  floor.value = null;
  heroPage.value = 0;
}

/** `BattleHeroItem.doClick`: pick a floor — passed, current or locked shows the state tip. */
function selectFloor(hero: LadderHero): void {
  floor.value = hero.levelid;
}

/** `doMoveLeft` / `doMoveRight`: which=1 pages the chapters, 2 the floors. */
function doMoveLeft(which: number): void {
  if (which === 1) battlePage.value = Math.max(0, battlePage.value - 1);
  else heroPage.value = Math.max(0, heroPage.value - 1);
}
function doMoveRight(which: number): void {
  if (which === 1) {
    battlePage.value = Math.min(chapters.length - BATTLE_VISIBLE, battlePage.value + 1);
  } else {
    heroPage.value = Math.min(heroTotalPages.value - 1, heroPage.value + 1);
  }
}

/** `loadCampaignData`. */
onMounted(() => game.sendGlobalCommand('campaign', 'loadCampaignInitData'));

const unregister = game.addGlobalReceiver('campaign', (command, data) => {
  if (command === 'loadCampaignInitData') {
    init.value = parseCampaignInit(data);
  } else if (command === 'regetCampaignMaxData') {
    const i = init.value;
    if (i) {
      const max = parseCampaignMax(data);
      init.value = applyShowState({ ...i, ...max });
    }
  } else if (command === 'getOneBattleRet') {
    battle.value = parsePkBattle(data);
  } else if (command === 'buyJunlingFunc') {
    const reply = parseBuyJunling(data);
    if (init.value) init.value.junling = reply.count;
    if (reply.money != null) user.money = reply.money;
    showBuy.value = false;
    void showAlert(i18n('Shop_ShopDialogSrc_1'));
  } else if (command === 'loadPKRewardRank') {
    rewardRanks.value = parsePkRewardRank(data);
  } else if (command === 'getPkFirstReward') {
    treasure.value = treasureItems(parsePkFirstReward(data));
    showReward.value = false;
  }
});
onUnmounted(unregister);

/** `getRewardPanel`. */
function openReward(): void {
  showReward.value = true;
  game.sendGlobalCommand('campaign', 'loadPKRewardRank', [chapter.value, flag.value]);
}

/** `getPkFirstReward [battleid, flag, rankid]`. */
function claimReward(rankid: number): void {
  game.sendGlobalCommand('campaign', 'getPkFirstReward', [chapter.value, flag.value, rankid]);
}

/** `doEnterBattlePanel`: a floor and the level gates are checked before the challenge panel. */
function enterBattle(): void {
  if (floor.value == null) {
    void showAlert(i18n('Hero_Battle_Dialog_battle_not_select_floor'));
    return;
  }
  const first = enemyHeroes.value[0];
  if (flag.value === 0 && user.kingHeroLevel < Number(first?.hero_level ?? 0)) {
    void showAlert(i18n('Hero_Battle_Dialog_enterBattle_herolevel_low'));
    return;
  }
  showChallenge.value = true;
}

/** `StartChallengePanel.onShowBattleDialog`: `getOneBattleRet [battleid, flag, level, hids]`. */
function startBattle(hids: number[], names: Record<number, string>): void {
  battleNames.value = names;
  game.sendGlobalCommand('campaign', 'getOneBattleRet', [
    chapter.value,
    flag.value,
    floor.value,
    hids,
  ]);
}

/** `BattleRewardPanel.doQuit`: refresh the reached floors after a fight. */
function finishBattle(): void {
  battle.value = null;
  game.sendGlobalCommand('campaign', 'regetCampaignMaxData');
}

/** The selected floor's entry condition tip (`showRestrictCondition`). */
function floorTip(hero: LadderHero): string {
  return enterCondition(
    chapters[chapter.value - 1]?.label ?? '',
    chapters[chapter.value - 1]?.floorCount ?? 10,
    Number(hero.hero_level ?? 0),
    Number(hero.user_level ?? 0),
    i18n,
  );
}
</script>

<template>
  <FxCanvas :w="733" :h="525" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="240" :y="12" source="images/title.png" />
    <FxLabel
      :y="17"
      :w="733"
      :h="18"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Hero_Battle_Dialog_title')"
    />
    <FxCanvas :x="10" :y="48" :w="713" :h="467" style-name="BoardListUp" :fx="{ color: 16777215 }">
      <FxLabel
        :x="10"
        :y="15"
        :w="94"
        :h="32"
        :fx="{ color: 16247152, fontWeight: 'bold', paddingTop: 5, textAlign: 'left' }"
        :text="i18n('Hero_Battle_Dialog_battle_difficulty')"
      />
      <FxCanvas :x="105" :y="15" :w="172" :h="34" style-name="BoardListUp">
        <FxToggle
          type="RadioButton"
          :x="6"
          :y="5"
          :w="80"
          :label="i18n('Hero_Battle_Dialog_battle_difficulty_1')"
          :selected="flag === 0"
          @change="(v) => setFlag(v, 0)"
        />
        <FxToggle
          type="RadioButton"
          :x="88"
          :y="5"
          :w="80"
          :label="i18n('Hero_Battle_Dialog_battle_difficulty_2')"
          :selected="flag === 1"
          @change="(v) => setFlag(v, 1)"
        />
      </FxCanvas>
      <FxLabel
        :x="363"
        :y="15"
        :w="80"
        :h="32"
        :fx="{ color: 16247152, fontWeight: 'bold', paddingTop: 7, textAlign: 'right' }"
        :text="i18n('Hero_Battle_Dialog_battle_junling')"
      />
      <FxCanvas :x="452" :y="15" :w="90" :h="34" style-name="BoardListUp">
        <FxLabel
          :x="4"
          :w="48"
          :fx="{
            textAlign: 'right',
            paddingTop: 8,
            color: (init?.junling ?? 0) === 0 ? 16711680 : 16777215,
          }"
          :text="String(init?.junling ?? 0)"
        />
        <FxLabel
          :x="51"
          :w="38"
          :fx="{ textAlign: 'left', paddingTop: 8 }"
          :text="i18n('Hero_Battle_Dialog_battle_total_times')"
        />
      </FxCanvas>
      <FxButton
        :x="565"
        :y="10"
        :w="80"
        :h="40"
        style-name="ButtonYellow"
        :label="i18n('Hero_Battle_Dialog_battle_buyGoods_button')"
        @click="showBuy = true"
      />
      <!-- chapter strip -->
      <FxButton :x="6" :y="64" :w="30" :h="100" style-name="moveToLeft" @click="doMoveLeft(1)" />
      <FxButton
        :x="673"
        :y="64"
        :w="30"
        :h="100"
        style-name="moveToRight"
        @click="doMoveRight(1)"
      />
      <FxCanvas :x="38" :y="64" :w="630" :h="100" style-name="BoardListUp">
        <BattleItem
          v-for="(c, i) in visibleChapters"
          :key="c.data"
          :x="4 + i * 90"
          :y="4"
          :label="c.label"
          :image="c.image"
          :locked="c.data > maxBattleId"
          :selected="c.data === chapter"
          :tip="floorTip(chapterHeroesOf(c.data)[0] ?? ({} as LadderHero))"
          @click="selectChapter(c.data)"
        />
      </FxCanvas>
      <!-- floor strip -->
      <FxCanvas :x="9" :y="169" :w="95" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="4"
          :y="4"
          :w="87"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold', fontSize: 13 }"
          :text="i18n('Hero_Battle_Dialog_hero')"
        />
      </FxCanvas>
      <FxButton :x="6" :y="203" :w="30" :h="115" style-name="moveToLeft" @click="doMoveLeft(2)" />
      <FxButton
        :x="673"
        :y="203"
        :w="30"
        :h="115"
        style-name="moveToRight"
        @click="doMoveRight(2)"
      />
      <FxCanvas :x="40" :y="203" :w="630" :h="115" style-name="BoardListUp">
        <BattleHeroItem
          v-for="(hero, i) in visibleHeroes"
          :key="`${hero.battleid}-${hero.levelid}-${hero.area}`"
          :x="5 + i * 78"
          :y="4"
          :hero-image="hero.heroImage"
          :name="String(hero.name ?? '')"
          :levelid="hero.levelid"
          :show-state="hero.showState ?? -1"
          :selected="floor === hero.levelid"
          :tip="floorTip(hero)"
          @click="selectFloor(hero)"
        />
      </FxCanvas>
      <!-- drop goods + actions -->
      <FxCanvas :x="10" :y="327" :w="693" :h="130" style-name="BoardListUp">
        <FxLabel
          :x="13"
          :y="14"
          :w="72"
          :h="32"
          :fx="{ color: 16247152, fontWeight: 'bold', paddingTop: 5, textAlign: 'right' }"
          :text="i18n('Hero_Battle_Dialog_battle_drop_goods')"
        />
        <FxCanvas :x="98" :y="32" :w="90" :h="82" style-name="BoardListUp">
          <FxCanvas :x="7" :y="4" :w="75" :h="75" style-name="BoardListDown">
            <FxImage :x="5" :y="4" :w="64" :h="64" :source="dropImage" :tip="dropTip" />
          </FxCanvas>
        </FxCanvas>
        <FxButton
          :x="273"
          :y="43"
          :w="92"
          :h="45"
          style-name="ButtonGreen"
          :label="i18n('Hero_Battle_Dialog_battle_startPanel_1_5')"
          @click="openReward"
        />
        <FxButton
          :x="479"
          :y="43"
          :w="122"
          :h="45"
          style-name="enterBattle"
          :fx="{ fontSize: 13 }"
          @click="enterBattle"
        />
        <FxButton :x="624" :y="88" :w="69" style-name="Close" @click="game.closeDialog()" />
      </FxCanvas>
    </FxCanvas>

    <BuyBattleGoodDialog v-if="showBuy" :junling="init?.junling ?? 0" @close="showBuy = false" />
    <StartChallengePanel
      v-if="showChallenge"
      :chapter="chapter"
      :flag="flag"
      :levelid="floor ?? 1"
      :battle-name="chapters[chapter - 1]?.label ?? ''"
      :intro="battleDesc(init?.descs ?? [], chapter)"
      :total-floors="chapters[chapter - 1]?.floorCount ?? 10"
      :passed-floors="maxFloor"
      :enemy-heroes="enemyHeroes"
      @battle="startBattle"
      @back="showChallenge = false"
      @close="showChallenge = false"
    />
    <HeroBattlePanel
      v-if="battle"
      :battle="battle"
      :names="battleNames"
      @finish="finishBattle"
      @quit="battle = null"
    />
    <ZhanJiangRewardDialog
      v-if="showReward"
      :battle-name="chapters[chapter - 1]?.label ?? ''"
      :ranks="rewardRanks"
      :uid="user.uid"
      @claim="claimReward"
      @close="showReward = false"
    />
    <TreasureGetDialog v-if="treasure.length > 0" :items="treasure" @close="treasure = []" />
  </FxCanvas>
</template>
