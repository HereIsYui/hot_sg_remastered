<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';

/** Bar.TopPanel: view switch (inner city / city / world / battle) and the function buttons. */
defineProps<{ x?: number; y?: number }>();

type View = 'cityInner' | 'city' | 'world' | 'battle';
const view = ref<View>('cityInner');
const showLevel = ref(false);
const showBuild = ref(false);
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="736">
    <FxImage source="images/board_topbar.png" />
    <FxButton
      :x="10"
      :y="4"
      style-name="TopButtonCityInner"
      :selected="view === 'cityInner'"
      @button-down="view = 'cityInner'"
    />
    <FxButton
      :x="80"
      :y="4"
      style-name="TopButtonCity"
      :selected="view === 'city'"
      @button-down="view = 'city'"
    />
    <FxButton
      :x="150"
      :y="4"
      style-name="TopButtonWorld"
      :selected="view === 'world'"
      @button-down="view = 'world'"
    />
    <FxButton
      :x="220"
      :y="4"
      style-name="TopButtonBattle"
      :selected="view === 'battle'"
      @button-down="view = 'battle'"
    />
    <FxButton
      :x="305"
      :y="4"
      style-name="TopButtonBuild"
      :selected="showBuild"
      :tip="i18n('Bar_TopPanel_1_1')"
      @click="showBuild = !showBuild"
    />
    <FxButton
      :x="407"
      :y="4"
      style-name="TopButtonLevel"
      :selected="showLevel"
      :tip="i18n('Bar_TopPanel_2_1')"
      @click="showLevel = !showLevel"
    />
    <FxButton :x="345" :y="10" style-name="TopButtonCraft" :tip="i18n('Bar_TopPanel_3_1')" />
    <FxButton :x="369" :y="10" style-name="TopButtonTrick" :tip="i18n('Bar_TopPanel_4_1')" />
    <FxButton :x="436" :y="4" style-name="TopButtonHero" />
    <FxButton :x="500" :y="4" style-name="TopButtonArmy" />
    <FxButton :x="565" :y="4" style-name="TopButtonUnion" />
    <FxButton :x="630" :y="4" style-name="TopButtonMission" />
    <FxButton :x="692" :y="4" style-name="LotteryBoxBtn" />
  </FxCanvas>
</template>
