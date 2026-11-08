<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import type { GoodsItem } from '../../game/goods';
import { isFragment, isPortrait } from '../../game/wuhunCards';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxToggle from '../../ui/FxToggle.vue';
import WuhunSelectDialog from './WuhunSelectDialog.vue';
const props = defineProps<{ goods: GoodsItem[]; things: GoodsItem[]; initial?: GoodsItem }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const portrait = ref(!props.initial || props.initial.gid === 149 || props.initial.isThing);
const banner = ref(props.initial?.gid === 148);
const fragmentItem = shallowRef<GoodsItem | null>(
  props.initial && isFragment(props.initial.gid) ? props.initial : null,
);
const portraitItem = shallowRef<GoodsItem | null>(props.initial?.isThing ? props.initial : null);
const selecting = ref(false);
const selected = computed(() => (portrait.value ? portraitItem.value : fragmentItem.value));
const choices = computed(() =>
  portrait.value
    ? props.things.filter((item) => isPortrait(item.gid))
    : props.goods.filter((item) => isFragment(item.gid)),
);
const incense = computed(() => props.goods.find((item) => item.gid === 149)?.count ?? 0);
function choose(item: GoodsItem) {
  if (portrait.value) portraitItem.value = item;
  else fragmentItem.value = item;
  selecting.value = false;
}
function submit() {
  const item = selected.value;
  if (!item) {
    void showAlert(i18n(portrait.value ? 'Goods_WuhunDialogSrc_8' : 'Goods_WuhunDialogSrc_7'));
    return;
  }
  game.sendGlobalCommand(
    'goods',
    portrait.value ? 'genWuHunByRumor' : 'genWuHunBySuipian',
    portrait.value ? [item.gid] : [item.gid, banner.value ? 1 : 0],
  );
  emit('close');
}
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="100" :y="55" :w="482" :h="370" style-name="PopupDialog">
      <FxLabel :x="20" :y="15" :w="300" :text="i18n('Goods_WuhunDialogSrc_1')" />
      <FxButton
        :x="20"
        :y="50"
        :w="130"
        :label="i18n('Goods_WuhunDialogSrc_5')"
        :selected="portrait"
        @click="portrait = true"
      />
      <FxButton
        :x="160"
        :y="50"
        :w="130"
        :label="i18n('Goods_WuhunDialogSrc_4')"
        :selected="!portrait"
        @click="portrait = false"
      />
      <FxButton :x="35" :y="110" :w="130" label="选择材料" @click="selecting = true" />
      <FxImage
        v-if="selected"
        :x="65"
        :y="155"
        :w="64"
        :h="64"
        :source="selected.imageName"
        :tip="selected.description"
        hand
        @click="selecting = true"
      />
      <FxLabel
        :x="20"
        :y="225"
        :w="180"
        :text="selected ? `${selected.name} ×${selected.count}` : '请选择材料'"
      />
      <FxText
        :x="200"
        :y="110"
        :w="260"
        :h="135"
        :text="i18n(portrait ? 'Goods_WuhunDialogSrc_6' : 'Goods_WuhunDialogSrc_3')"
      />
      <FxLabel v-if="portrait" :x="200" :y="250" :w="250" :text="`招魂香：${incense}`" />
      <FxToggle
        v-else
        v-model:selected="banner"
        :x="30"
        :y="270"
        :w="420"
        :label="i18n('Goods_WuhunDialogSrc_2')"
      />
      <FxButton
        :x="210"
        :bottom="15"
        :w="110"
        style-name="ButtonGreen"
        label="合成"
        @click="submit"
      />
      <FxButton :right="15" :bottom="15" style-name="Close" @click="emit('close')" />
    </FxCanvas>
    <WuhunSelectDialog
      v-if="selecting"
      :items="choices"
      @select="choose"
      @close="selecting = false"
    />
  </FxCanvas>
</template>
