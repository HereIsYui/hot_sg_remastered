<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import type { GoodsItem } from '../../game/goods';
import { wuhunHeroes, wuhunUseArgs } from '../../game/wuhunCards';
import { useCityStore } from '../../stores/city';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
const props = defineProps<{ goods: GoodsItem }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const city = useCityStore();
const heroes = computed(() => wuhunHeroes(city.heroes));
const selected = ref(0);
const names = computed(() => [
  i18n('Ground_CampaignDialogSrc_6'),
  ...heroes.value.map((hero) => String(hero.name ?? '')),
]);
function submit() {
  const hero = heroes.value[selected.value - 1];
  if (!hero) {
    void showAlert(i18n('Goods_WuhunUserSelectDialog_3'));
    return;
  }
  game.sendGlobalCommand('goods', 'useGoods', wuhunUseArgs(props.goods.gid, Number(hero.hid)));
  emit('close');
}
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="160" :y="95" :w="362" :h="300" style-name="PopupDialog">
      <FxLabel :x="20" :y="20" :w="320" :text="goods.name" />
      <FxText :x="20" :y="55" :w="320" :h="125" :text="goods.description" />
      <FxComboBox v-model:selected-index="selected" :x="35" :y="190" :w="285" :items="names" />
      <FxButton
        :x="35"
        :bottom="20"
        :w="110"
        style-name="ButtonGreen"
        label="使用武魂"
        @click="submit"
      />
      <FxButton :right="20" :bottom="20" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
