<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * GuoGuanZhanJiang.BuyBattleGoodDialog: the 军令 purchase popup opened by the ladder dialog's
 * 购买军令 button. It rides the existing purchase-popup chain (the buy-and-use pattern): five
 * 元宝 per piece (`BATTLE_GOOD_PRICE`), at most 100 in stock, `campaign/buyJunlingFunc [0, n]`
 * answers `[0, newCount, money]`.
 */
const props = defineProps<{ junling: number }>();
const emit = defineEmits<{ close: []; bought: [count: number] }>();

const game = useGame();
const user = useUserStore();

const PRICE = 5;
const countText = ref('0');
const count = computed(() => parseInt(countText.value, 10) || 0);
const enough = computed(() => count.value * PRICE <= user.money);

watch(countText, (v) => {
  const parsed = parseInt(v, 10) || 0;
  const capped = Math.min(parsed, Math.max(0, 100 - props.junling));
  if (capped !== parsed) countText.value = String(Math.max(0, capped));
});

/** `inputCount`: the cost line, red over the balance. */
const cost = computed(() => count.value * PRICE);

/** `doBuy`. */
function doBuy(): void {
  if (!enough.value) {
    void showAlert(i18n('Hero_Battle_Dialog_buy_good_money_not_enough'));
    return;
  }
  if (count.value <= 0) return;
  game.sendGlobalCommand('campaign', 'buyJunlingFunc', [0, count.value]);
  emit('close');
}
</script>

<template>
  <FxCanvas :x="240" :y="108" :w="252" :h="290" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxLabel
      :x="0"
      :y="10"
      :w="252"
      :h="20"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Hero_Battle_Dialog_buy_good_title')"
    />
    <FxCanvas :x="20" :y="44" :w="212" :h="180" style-name="BoardListDown">
      <FxLabel :x="10" :y="10" :w="90" :text="i18n('Hero_Battle_Dialog_buy_good_money')" />
      <FxLabel :x="110" :y="10" :w="90" :fx="{ textAlign: 'right' }" :text="String(user.money)" />
      <FxLabel :x="10" :y="38" :w="90" :text="i18n('Hero_Battle_Dialog_buy_good_count')" />
      <FxTextInput
        v-model="countText"
        :x="110"
        :y="36"
        :w="90"
        :h="22"
        style-name="EmptyTextInput"
        :fx="{ textAlign: 'right', color: 16777215 }"
      />
      <FxLabel :x="10" :y="66" :w="90" :text="i18n('Hero_Battle_Dialog_buy_good_type')" />
      <FxLabel
        :x="110"
        :y="66"
        :w="90"
        :fx="{ textAlign: 'right', color: enough ? 15983262 : 16711680 }"
        :text="String(cost)"
      />
      <FxLabel
        :x="10"
        :y="120"
        :w="192"
        :fx="{ color: 16247152 }"
        :text="i18n('Hero_Battle_Dialog_buy_good_max_count_tip')"
      />
    </FxCanvas>
    <FxButton :x="40" :y="240" :w="80" :h="34" style-name="Confirm" @click="doBuy" />
    <FxButton :x="150" :y="240" :w="70" :h="34" style-name="Cancel" @click="emit('close')" />
  </FxCanvas>
</template>
