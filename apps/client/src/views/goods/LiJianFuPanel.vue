<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { coordinates } from '../../game/userState';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxButton from '../../ui/FxButton.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
const props = defineProps<{ goods: { gid: number; name: string; description: string } }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const x = ref('');
const y = ref('');
function submit() {
  const point = coordinates(x.value, y.value);
  if (!point) {
    void showAlert(i18n('Goods_ChangeCityPositionDialogSrc_5'));
    return;
  }
  game.sendGlobalCommand('user', 'useLiJianFu', [...point, props.goods.gid]);
  emit('close');
}
</script>
<template>
  <FxCanvas :x="218" :y="109" :w="246" :h="260" style-name="PopupDialog">
    <FxLabel :x="20" :y="18" :w="206" :fx="{ textAlign: 'center' }" :text="goods.name" />
    <FxLabel :x="20" :y="54" :text="i18n('Goods_ChangeCityPositionDialog_8_1')" />
    <FxTextInput v-model="x" :x="98" :y="53" :w="60" :max-chars="3" restrict="0-9" />
    <FxTextInput v-model="y" :x="166" :y="53" :w="60" :max-chars="3" restrict="0-9" />
    <FxText :x="20" :y="88" :w="206" :h="114" :html="goods.description" scroll />
    <FxButton
      :right="93"
      :bottom="14"
      style-name="ButtonGreen"
      :label="i18n('Good_Use_LiJianFu_Use')"
      @click="submit"
    />
    <FxButton :right="16" :bottom="14" style-name="Cancel" @click="emit('close')" />
  </FxCanvas>
</template>
