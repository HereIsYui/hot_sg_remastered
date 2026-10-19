<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import type { BuildingState } from '../../stores/city';
import { useSessionStore } from '../../stores/session';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Building.BuildingExchangePanel: rebuilds a resource field as another kind with a 地变符. */
const props = defineProps<{ x: number; y: number; building: BuildingState }>();

const game = useGame();
const session = useSessionStore();

/** `Define.RES_TYPE`: the index is the field's bid. */
const RES_TYPE = [
  i18n('_Define_21_1'),
  i18n('_Define_Res_1'),
  i18n('_Define_Res_2'),
  i18n('_Define_Res_3'),
  i18n('_Define_Res_4'),
];
const target = ref(0);

function submit() {
  if (target.value < 1) {
    void showAlert(i18n('buildingExchangePanel_select'));
    return;
  }
  if (target.value === props.building.bid) {
    void showAlert(i18n('buildingExchangePanel_same_ret'));
    return;
  }
  game.buildingCommand('startChangeBuilding', props.building.bid, target.value);
  session.exchangeOpen = false;
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="292" :h="230" style-name="PopupDialog">
    <FxCanvas :x="46" :y="20" :w="200" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="24.5"
        :y="2"
        :w="151"
        :h="18"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('buildingExchangePanel_title')"
      />
    </FxCanvas>
    <FxLabel
      :x="27"
      :y="54"
      :fx="{ color: 16383743 }"
      :text="i18n('buildingExchangePanel_change_res')"
    />
    <FxTextInput
      :x="110"
      :y="52"
      :w="160"
      style-name="DownEmptyInput"
      :editable="false"
      :model-value="building.bname"
    />
    <FxLabel
      :x="24.5"
      :y="95"
      :fx="{ color: 16383743 }"
      :text="i18n('buildingExchangePanel_change_taget')"
    />
    <FxComboBox v-model:selected-index="target" :x="107.5" :y="93" :w="160" :items="RES_TYPE" />
    <FxText
      :x="27"
      :y="129"
      :w="243"
      :h="41"
      scroll
      :fx="{ color: 16185593 }"
      :text="i18n('buildingExchangePanel_change_des')"
    />
    <FxButton :x="205" :y="178" style-name="Close" @click="session.exchangeOpen = false" />
    <FxButton
      :x="125"
      :y="178"
      :w="72"
      :label="i18n('buildingExchangePanel_change_submit')"
      @click="submit"
    />
  </FxCanvas>
</template>
