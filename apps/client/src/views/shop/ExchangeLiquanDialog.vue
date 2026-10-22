<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Shop.ExchangeLiquanDialog: redeems a 礼券 code through `exchangeLiquan`; the reply (the
 * granted items) is shown by ShopDialog's TreasureGetDialog.
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const code = ref('');

function onSubmit() {
  game.sendGlobalCommand('shop', 'exchangeLiquan', [code.value]);
  emit('close');
}
</script>

<template>
  <FxCanvas class="exchange-liquan" :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxCanvas :x="(682 - 292) / 2" :y="(492 - 180) / 2" :w="292" :h="180" style-name="PopupDialog">
      <FxCanvas :x="(292 - 114) / 2" :y="13" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="4"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('Shop_ShopDialog_8_1')"
        />
      </FxCanvas>
      <FxLabel
        :x="20"
        :y="70"
        style-name="ItemTitle"
        :text="i18n('exchangeLiquan_YuanBao') || '礼券码'"
      />
      <FxCanvas :x="90" :y="66" :w="180" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="code"
          :x="2"
          :y="3"
          :w="176"
          :h="23"
          style-name="EmptyTextInput"
          :max-chars="20"
        />
      </FxCanvas>
      <FxButton
        :x="60"
        :bottom="15"
        :w="76"
        style-name="ButtonGreen"
        :label="i18n('_CommandSrc_7') || '确定'"
        @click="onSubmit"
      />
      <FxButton
        :right="60"
        :bottom="15"
        style-name="Cancel"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.exchange-liquan {
  pointer-events: none !important;
}

.exchange-liquan > :deep(*) {
  pointer-events: auto;
}
</style>
