<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import { stateNameKey, vacationQuote } from '../../game/userState';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import FxText from '../../ui/FxText.vue';
const game = useGame();
const emit = defineEmits<{ close: [] }>();
const selected = ref(game.user.ustate === 2 ? 1 : 0);
const days = ref('2');
const end = ref(0);
const count = ref(0);
const t = (suffix: string) => i18n(`UserInfo_ChangeStateDialog_${suffix}`);
const items = computed(() => ['6', '7', '8', '8_1'].map(t));
const information = computed(() =>
  game.user.ustate === 2 && selected.value === 1
    ? t('15_1') +
      timeLeftText(end.value - serverTime(), i18n) +
      t('16_1').replace('%', String(count.value + 1))
    : t(['19_1', '20_1', '21_1', '20_2'][selected.value]!),
);
const unregister = game.addGlobalReceiver('user', (command, data) => {
  if (command === 'loadMianZhanEndTime' && Array.isArray(data)) {
    end.value = Number(data[0]);
    count.value = Number(data[1]) || 0;
  }
});
onUnmounted(unregister);
onMounted(() => {
  if (game.user.ustate === 2) game.sendGlobalCommand('user', 'loadMianZhanEndTime');
});
async function submit() {
  let prompt: string;
  if (selected.value === 0) {
    if (game.user.ustate === 0) {
      void showAlert(t('26_1'));
      return;
    }
    prompt = t('29_1');
  } else if (selected.value === 2) {
    const quote = vacationQuote(days.value);
    if (!quote) {
      void showAlert(t(Number(days.value) > 15 ? '31_1' : '30_1'));
      return;
    }
    prompt = t('32_1') + quote.days + t('33_1') + quote.cost + t('34_1');
    if (quote.cooldown > 0) prompt += t('35_1') + quote.cooldown + t('36_1');
  } else if (game.user.ustate === 2) {
    if (
      (await showAlert(t('23_1') + timeLeftText(end.value - serverTime(), i18n) + t('24_1'), '', [
        'yes',
        'no',
      ])) === 'yes'
    ) {
      game.showUseGoodsDialog(0, 143);
      emit('close');
    }
    return;
  } else
    prompt = selected.value === 3 ? t('28_2') : t('28_1').replace('%', String(count.value + 1));
  if ((await showAlert(prompt, '', ['yes', 'no'])) !== 'yes') return;
  game.changeUserState(selected.value, days.value);
  emit('close');
}
</script>
<template>
  <FxCanvas :x="186" :y="73" :w="278" :h="298" style-name="PopupDialog" style="overflow: visible">
    <FxLabel :x="20" :y="18" :w="238" :fx="{ textAlign: 'center' }" :text="t('3_1')" />
    <FxLabel :x="20" :y="54" :text="t('4_1')" />
    <FxLabel :x="94" :y="54" :w="164" :text="i18n(stateNameKey(game.user.ustate))" />
    <FxText :x="20" :y="94" :w="238" :h="90" :text="information" scroll />
    <FxComboBox
      v-model:selected-index="selected"
      :x="20"
      :y="196"
      :w="selected === 2 ? 140 : 238"
      :items="items"
    />
    <FxTextInput
      v-if="selected === 2"
      v-model="days"
      :x="170"
      :y="196"
      :w="64"
      :max-chars="2"
      restrict="0-9"
    />
    <FxLabel v-if="selected === 2" :x="242" :y="199" :text="t('10')" />
    <FxButton :x="35" :bottom="25" style-name="Confirm" @click="submit" />
    <FxButton :right="35" :bottom="25" style-name="Cancel" @click="emit('close')" />
  </FxCanvas>
</template>
