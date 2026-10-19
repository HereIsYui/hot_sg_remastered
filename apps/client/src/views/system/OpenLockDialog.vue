<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import { vTip } from '../../ui/tooltip';

/** System.OpenLock: the 2级密码 asked before a guarded action of `type`. */
const props = defineProps<{ type: string }>();

const game = useGame();
const password = ref('');

/** `setFirstParam`: the guarded action's name, by `OpenLock_title_type_N`. */
const TYPE_NAMES: Record<string, number> = {
  discardCityType: 1,
  dismissHero: 2,
  dismissSoldier: 3,
  analyArmor: 4,
  multipAnalyArmor: 4,
  sellArmor: 5,
  unionExchangeArmor: 6,
};
const validateText = computed(() => {
  const n = TYPE_NAMES[props.type];
  if (n === undefined) return '';
  return `${i18n('OpenLock_title_head')}<font color='#ff0000'>${i18n(`OpenLock_title_type_${n}`)}</font>${i18n('OpenLock_title_1')}`;
});

/** `doCheck`. */
function onCheck() {
  if (password.value === '') {
    void showAlert(i18n('SystemMenu_SystemMenuPanel_can_not_empty'));
    return;
  }
  game.sendGlobalCommand('openlock', 'openLock', [props.type, 'sanguo', password.value]);
  game.closeDialog();
}
</script>

<template>
  <FxCanvas :x="82" :y="43" :w="518" :h="406" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="124" :y="16" source="images/title.png" />
    <FxLabel
      :x="183.5"
      :y="19"
      :w="151"
      :h="20"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'bold', fontSize: 14 }"
      :text="i18n('OpenLock_title')"
    />
    <FxCanvas :x="11" :y="59" :w="496" :h="294" style-name="BoardListUp">
      <FxCanvas :x="10" :y="10" :w="476" :h="90" style-name="BoardListDown">
        <FxText
          :left="10"
          :right="10"
          :top="5"
          :h="25"
          :fx="{
            paddingTop: 3,
            textAlign: 'center',
            fontSize: 13,
            color: 15192461,
            fontWeight: 'bold',
          }"
          :text="i18n('ModifySecondaryPassword_instr_title')"
        />
        <FxText
          :left="10"
          :right="10"
          :top="35"
          :h="50"
          :fx="{ fontSize: 12, color: 16777215 }"
          :html="i18n('ModifySecondaryPassword_instr_content')"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="110" :w="476" :h="174" style-name="BoardListDown">
        <FxText
          :x="10"
          :y="13"
          :w="456"
          :h="61"
          :fx="{
            fontSize: 13,
            paddingTop: 5,
            fontWeight: 'bold',
            textAlign: 'center',
            color: 16777215,
          }"
          :html="validateText"
        />
        <FxLabel
          :x="44"
          :y="82"
          :w="153"
          :h="32"
          :fx="{
            textAlign: 'right',
            color: 16777215,
            fontWeight: 'bold',
            fontSize: 13,
            paddingTop: 5,
          }"
          :text="i18n('OpenLock_title_2')"
        />
        <FxCanvas :x="198" :y="82" :w="133" :h="32" style-name="BoardListUp">
          <FxTextInput
            v-model="password"
            :x="0"
            :y="0"
            :w="133"
            :h="32"
            password
            restrict="a-zA-Z0-9"
            style-name="EmptyTextInput"
            :fx="{ fontSize: 12, color: 16777215, paddingLeft: 12 }"
            @enter="onCheck"
          />
        </FxCanvas>
        <FxLabel
          :x="368"
          :y="140"
          :w="104"
          :h="28"
          hand
          :fx="{
            fontSize: 12,
            fontWeight: 'bold',
            color: 16247152,
            paddingTop: 5,
            textDecoration: 'underline',
            textAlign: 'right',
          }"
          :text="i18n('ModifySecondaryPassword_title')"
          @click="game.showDialog('modifyPassword')"
        />
        <FxButton :x="198" :y="123" :w="80" style-name="Confirm" @click="onCheck" />
        <FxText
          v-tip="i18n('OpenLock_title_rule_describe')"
          :x="10"
          :y="140"
          :w="94"
          :h="28"
          :fx="{ fontSize: 12 }"
          :html="i18n('OpenLock_title_rule')"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton :x="434" :y="361" style-name="Close" @click="game.closeDialog()" />
  </FxCanvas>
</template>
