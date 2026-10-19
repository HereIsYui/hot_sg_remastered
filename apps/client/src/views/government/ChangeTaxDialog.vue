<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';
import FxText from '../../ui/FxText.vue';

/** Government.ChangeTaxDialog: the tax rate, with the hourly gold it would bring. */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const t = (key: string) => i18n(`Government_ChangeTaxDialog_${key}`);
const tax = ref(city.tax);
const income = computed(() => city.goldIncome(tax.value));

function submitChange() {
  game.sendGlobalCommand('city', 'changeTax', [city.cid, tax.value]);
  emit('close');
}

async function onSubmit() {
  if (tax.value <= 50) return submitChange();
  const answer = await showAlert(`${t('7_1')}${tax.value}${t('8')}`, '', ['yes', 'no']);
  if (answer === 'yes') submitChange();
}

const rows = computed(() => [
  { y: 59, title: t('2_1'), value: city.people_all },
  { y: 93, title: t('3_1'), value: city.morale },
]);
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="213" :y="123" :w="256" :h="281" style-name="PopupDialog">
      <FxButton
        style-name="Close"
        :right="13"
        :bottom="13"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :x="71" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel :x="0" :y="3" :w="114" :fx="{ textAlign: 'center' }" :text="t('1_1')" />
      </FxCanvas>
      <template v-for="row in rows" :key="row.y">
        <FxCanvas :x="19" :y="row.y" :w="57" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="6"
            :y="3"
            :w="43"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="row.title"
          />
        </FxCanvas>
        <FxCanvas :x="84" :y="row.y" :w="130" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="2"
            :y="3"
            :w="128"
            style-name="ItemValue"
            :fx="{ textAlign: 'left' }"
            :text="row.value"
          />
        </FxCanvas>
      </template>
      <FxCanvas :x="19" :y="127" :w="57" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="43"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('4_1')"
        />
      </FxCanvas>
      <FxNumericStepper v-model="tax" :x="84" :y="127" :minimum="0" :maximum="100" />
      <FxLabel :x="19" :y="161" style-name="ItemValue" :text="`${t('5_1')}${income}${t('5_2')}`" />
      <FxText :x="19" :y="189" :w="214" :h="52" type="TextArea" :text="t('6_1')" />
      <FxButton
        style-name="Confirm"
        :right="82"
        :bottom="13"
        :fx="{ fontSize: 16 }"
        @click="onSubmit"
      />
    </FxCanvas>
  </FxCanvas>
</template>
