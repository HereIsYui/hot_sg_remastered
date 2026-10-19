<script setup lang="ts">
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Login.JackarooDialog: the modal welcome after creating a role; 我知道了 starts the guide. */
const game = useGame();
const WIDTH = 400;
const HEIGHT = 266;
</script>

<template>
  <div class="modal">
    <FxCanvas
      :x="(1000 - WIDTH) / 2"
      :y="(600 - HEIGHT) / 2"
      :w="WIDTH"
      :h="HEIGHT"
      style-name="PopupDialog"
      :fx="{ fontSize: 12 }"
    >
      <FxCanvas :x="115.5" :y="14" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4.5"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Login_JackarooDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="20" :y="50" :w="360" :h="127" style-name="BoardListDown">
        <FxText
          :x="2"
          :y="2"
          :w="356"
          :h="115"
          scroll
          :fx="{ color: 15192461 }"
          :html="i18n('Login_Other_1')"
        />
      </FxCanvas>
      <FxButton
        :x="294"
        :y="202"
        :w="86"
        style-name="ButtonGreen"
        :label="i18n('Login_JackarooDialog_2_1')"
        @click="game.startGuide()"
      />
      <FxImage source="images/arrow_2.gif" :x="200" :y="181" :w="76" :h="76" />
    </FxCanvas>
  </div>
</template>

<style scoped>
.modal {
  position: absolute;
  inset: 0;
  z-index: 900;
}
</style>
