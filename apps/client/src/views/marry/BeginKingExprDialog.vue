<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';
import FxText from '../../ui/FxText.vue';

/**
 * MarrySystem.BeginKingExprDialog: the 寻访红颜 opener — 1-8 hours of free king expr
 * (`beginKingExpr [hours]`); the reply's message toasts and the refreshed expr row closes it.
 */
const emit = defineEmits<{ close: []; started: [] }>();

const game = useGame();
const user = useUserStore();
const hours = ref(1);

/** `BeginKingExprDialog.onSubmit`. */
function onSubmit(): void {
  game.sendGlobalCommand('MarrySystem', 'beginKingExpr', [hours.value]);
  emit('started');
}
</script>

<template>
  <FxCanvas :w="625" :h="353" style-name="BoardListDown">
    <FxCanvas :x="137" :y="10" :w="350" :h="317" style-name="PopupDialog">
      <FxButton
        :right="45"
        :bottom="14"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :y="12" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="3"
          :w="102"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Marry_king_exp_title')"
        />
      </FxCanvas>
      <FxButton
        :right="118"
        :bottom="14"
        :w="65"
        :h="36"
        style-name="ButtonGreen"
        :fx="{ fontSize: 16 }"
        :label="i18n('BeginHeroExprDialog_2_1')"
        @click="onSubmit"
      />
      <FxCanvas :x="34" :y="58" :w="100" :h="30" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="24"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Marry_king_name')"
        />
      </FxCanvas>
      <FxCanvas :x="143" :y="58" :w="127" :h="30" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="107"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="user.username"
        />
      </FxCanvas>
      <FxCanvas :x="34" :y="97" :w="100" :h="30" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="24"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('BeginHeroExprDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="143" :y="97" :w="127" :h="30" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="107"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Marry_king_exp_search_wife')"
        />
      </FxCanvas>
      <FxCanvas :x="34" :y="134" :w="100" :h="30" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="24"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('BeginHeroExprDialog_5_1')"
        />
      </FxCanvas>
      <FxNumericStepper
        v-model="hours"
        :x="143"
        :y="135"
        :w="127"
        :h="30"
        :minimum="1"
        :maximum="8"
      />
      <FxText
        :x="34"
        :y="173"
        :w="255"
        :h="89"
        style-name="ItemValue"
        :text="i18n('Marry_king_expdes')"
      />
      <FxLabel
        :x="278"
        :y="140"
        :w="61"
        style-name="ItemValue"
        :text="i18n('BeginHeroExprDialog_7_1')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
