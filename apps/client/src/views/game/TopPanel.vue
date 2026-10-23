<script setup lang="ts">
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useSessionStore } from '../../stores/session';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';

/** Bar.TopPanel: view switch (inner city / city / world / battle) and the function buttons. */
defineProps<{ x?: number; y?: number }>();

const game = useGame();
const session = useSessionStore();
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="736">
    <FxImage source="images/board_topbar.png" />
    <FxButton
      :x="10"
      :y="4"
      style-name="TopButtonCityInner"
      :selected="session.view === 'cityInner'"
      @button-down="game.gotoView('cityInner')"
    />
    <FxButton
      :x="80"
      :y="4"
      style-name="TopButtonCity"
      :selected="session.view === 'city'"
      @button-down="game.gotoView('city')"
    />
    <FxButton
      :x="150"
      :y="4"
      style-name="TopButtonWorld"
      :selected="session.view === 'world'"
      @button-down="game.gotoView('world')"
    />
    <FxButton
      :x="220"
      :y="4"
      style-name="TopButtonBattle"
      :selected="session.view === 'battle'"
      @button-down="game.gotoView('battle')"
    />
    <FxButton
      :x="305"
      :y="4"
      style-name="TopButtonBuild"
      :selected="session.showBuildingList"
      :tip="i18n('Bar_TopPanel_1_1')"
      @click="game.toggleBuildingList()"
    />
    <FxButton
      :x="407"
      :y="4"
      style-name="TopButtonLevel"
      :selected="session.showLevel"
      :tip="i18n('Bar_TopPanel_2_1')"
      @click="game.toggleShowLevel()"
    />
    <FxButton :x="345" :y="10" style-name="TopButtonCraft" :tip="i18n('Bar_TopPanel_3_1')" />
    <FxButton :x="369" :y="10" style-name="TopButtonTrick" :tip="i18n('Bar_TopPanel_4_1')" />
    <FxButton :x="436" :y="4" style-name="TopButtonHero" @click="game.showHeroDetail()" />
    <FxButton
      :x="500"
      :y="4"
      style-name="TopButtonArmy"
      :tip="i18n('Bar_TopPanel_5_1')"
      @click="game.showTroopDialog()"
    />
    <FxButton :x="565" :y="4" style-name="TopButtonUnion" />
    <FxButton :x="630" :y="4" style-name="TopButtonMission" @click="game.showDialog('task')" />
    <FxButton :x="692" :y="4" style-name="LotteryBoxBtn" />
  </FxCanvas>
</template>
