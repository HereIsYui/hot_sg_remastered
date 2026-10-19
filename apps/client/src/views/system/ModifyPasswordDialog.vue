<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** System.ModifySecondaryPassword: sets the 2级密码, or replaces it given the old one. */
const game = useGame();
const t = (key: string) => i18n(`ModifySecondaryPassword_${key}`);
const oldPassword = ref('');
const newPassword1 = ref('');
const newPassword2 = ref('');

const inputs = [
  { y: 16, label: t('old'), model: oldPassword },
  { y: 56, label: t('new'), model: newPassword1 },
  { y: 96, label: t('new'), model: newPassword2 },
];

/** `doModify`. */
function onModify() {
  if (newPassword1.value !== newPassword2.value) {
    void showAlert(t('not_equal'));
    return;
  }
  if (newPassword1.value.trim() === '') {
    void showAlert(t('not_null'));
    return;
  }
  game.sendGlobalCommand('modifypassword', 'modifyPassword', [
    oldPassword.value,
    'sanguo',
    newPassword1.value,
  ]);
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
      :text="t('title')"
    />
    <FxCanvas :x="11" :y="53" :w="496" :h="300" style-name="BoardListUp">
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
          :text="t('instr_title')"
        />
        <FxText
          :left="10"
          :right="10"
          :top="35"
          :h="50"
          :fx="{ fontSize: 12, color: 16777215 }"
          :html="t('instr_content') + t('instr_content_1')"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="108" :w="476" :h="182" style-name="BoardListDown">
        <template v-for="input in inputs" :key="input.y">
          <FxCanvas :x="120" :y="input.y" :w="100" :h="32" style-name="BoardListUp">
            <FxLabel
              :x="0"
              :y="0"
              :w="100"
              :h="32"
              :fx="{
                fontSize: 12,
                color: 16777215,
                paddingTop: 5,
                fontWeight: 'bold',
                textAlign: 'right',
              }"
              :text="input.label"
              :tip="t('old_tip')"
            />
          </FxCanvas>
          <FxCanvas :x="223" :y="input.y" :w="133" :h="32" style-name="BoardListUp">
            <FxTextInput
              v-model="input.model.value"
              :x="0"
              :y="0"
              :w="133"
              :h="32"
              password
              restrict="a-zA-Z0-9"
              style-name="EmptyTextInput"
              :fx="{ fontSize: 12, color: 16777215, paddingLeft: 5 }"
            />
          </FxCanvas>
        </template>
        <FxButton :x="183" :y="136" :w="80" style-name="Confirm" @click="onModify" />
      </FxCanvas>
    </FxCanvas>
    <FxButton :x="434" :y="361" style-name="Close" @click="game.closeDialog()" />
  </FxCanvas>
</template>
