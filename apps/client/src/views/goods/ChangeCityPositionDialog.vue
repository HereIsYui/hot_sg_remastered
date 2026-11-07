<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { coordinates } from '../../game/userState';
import { provinceInfo, provinceName } from '../../game/province';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
const props = defineProps<{ advanced: boolean; description: string }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const x = ref('');
const y = ref('');
const province = ref(0);
const options = computed(() => [
  i18n('Goods_ChangeCityPositionDialogSrc_1'),
  ...Array.from({ length: 18 }, (_, i) => provinceName(i + 1)),
]);
const info = computed(() =>
  provinceInfo(province.value, {
    users: game.global.provinceUsers,
    cities: game.global.provinceCities,
    lands: game.global.provinceLands,
  }),
);
onMounted(() => {
  if (!props.advanced) game.sendGlobalCommand('user', 'loadProvinceInfo');
});
async function submit() {
  const cid = game.user.cid;
  const city = game.user.cities.find((c) => c.cid === cid);
  const name = city ? city.name + city.position : game.city.name;
  const point = coordinates(x.value, y.value);
  if (props.advanced && !point) {
    void showAlert(i18n('Goods_ChangeCityPositionDialogSrc_5'));
    return;
  }
  const target = props.advanced ? `(${point![0]},${point![1]})` : options.value[province.value];
  const prompt =
    props.advanced || province.value > 0
      ? i18n(`Goods_ChangeCityPositionDialogSrc_${props.advanced ? 8 : 2}`) +
        name +
        i18n('Goods_ChangeCityPositionDialogSrc_6') +
        target +
        i18n('Goods_ChangeCityPositionDialogSrc_3')
      : i18n('Goods_ChangeCityPositionDialogSrc_4') +
        name +
        i18n('Goods_ChangeCityPositionDialogSrc_7');
  if ((await showAlert(prompt, '', ['yes', 'no'])) !== 'yes') return;
  game.sendGlobalCommand(
    'user',
    props.advanced ? 'changeCityPositionPointing' : 'changeCityPosition',
    props.advanced ? [...point!, cid] : [province.value, cid],
  );
  emit('close');
}
</script>
<template>
  <FxCanvas :x="218" :y="109" :w="246" :h="260" style-name="PopupDialog" style="overflow: visible">
    <FxLabel
      :x="20"
      :y="18"
      :w="206"
      :fx="{ textAlign: 'center' }"
      :text="i18n('Goods_ChangeCityPositionDialog_3_1')"
    />
    <FxLabel :x="20" :y="54" :text="i18n(`Goods_ChangeCityPositionDialog_${advanced ? 8 : 4}_1`)" />
    <template v-if="advanced">
      <FxTextInput v-model="x" :x="98" :y="53" :w="60" :max-chars="3" restrict="0-9" />
      <FxTextInput v-model="y" :x="166" :y="53" :w="60" :max-chars="3" restrict="0-9" />
    </template>
    <FxComboBox
      v-else
      v-model:selected-index="province"
      :x="98"
      :y="53"
      :w="126"
      :items="options"
      :row-count="8"
    />
    <FxText :x="20" :y="88" :w="206" :h="114" :html="advanced ? description : info" scroll />
    <FxButton :right="93" :bottom="14" style-name="Confirm" @click="submit" />
    <FxButton :right="16" :bottom="14" style-name="Cancel" @click="emit('close')" />
  </FxCanvas>
</template>
