<script setup lang="ts">
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxText from '../../ui/FxText.vue';
const game = useGame();
function agree() {
  game.sendGlobalCommand('user', 'allowPK');
}
function exit() {
  game.session.userRule = false;
  game.popGame();
}
</script>
<template>
  <FxCanvas :w="1000" :h="600" :fx="{ backgroundColor: 0, backgroundAlpha: 0.6 }">
    <FxCanvas :x="300" :y="70" :w="400" :h="460" style-name="PopupDialog">
      <FxLabel
        :x="20"
        :y="18"
        :w="360"
        :fx="{ textAlign: 'center' }"
        :text="i18n('UserInfo_UserRule_1_1')"
      />
      <FxText :x="20" :y="56" :w="360" :h="344" :html="game.session.userRuleContent" scroll />
      <FxButton
        :right="20"
        :bottom="15"
        style-name="ButtonRed"
        :label="i18n('UserInfo_UserRule_2_1')"
        @click="agree"
      />
      <FxButton
        :right="109"
        :bottom="15"
        style-name="ButtonRed"
        :label="i18n('UserInfo_UserRule_2_2')"
        @click="exit"
      />
    </FxCanvas>
  </FxCanvas>
</template>
