<script setup lang="ts">
import { computed } from 'vue';
import { useGame } from '../../game/game';
import { attrTip, type GoodsItem } from '../../game/goods';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import { showMenu, type MenuItem } from '../../ui/menu';
import { stagePoint, type TipValue } from '../../ui/tooltip';

/** Goods.UserGoodsItem: an item's picture, count and name; a click opens its menu. */
const props = defineProps<{ x: number; y: number; item: GoodsItem }>();
const emit = defineEmits<{ action: [action: string, item: GoodsItem] }>();

const game = useGame();

const CARD_FRAMES = ['purple', 'red', 'yellow', 'blue'];
const use = { label: i18n('Goods_UserGoodsItem_1_1'), data: 'use' };
const sell = { label: i18n('Goods_UserGoodsItem_2_1'), data: 'sell' };
const MENU: MenuItem[] = [
  use,
  sell,
  { label: i18n('Goods_UserGoodsItem_compose'), data: 'compose' },
];
const MENU_GUIDE: MenuItem[] = [use, { ...sell, enabled: false }];
const MENU_CARD: MenuItem[] = [use, sell, { label: i18n('Hero_card_2'), data: 'mix' }];
const MENU_ORIGINAL_CARD: MenuItem[] = [use, sell, { label: i18n('Hero_card_9'), data: 'multi' }];
/** Everything but the item's menu, closed off while the guide waits for 使用. */
const GUIDE_MASK = [
  { x: 0, y: 0, w: 1000, h: 166 },
  { x: 0, y: 166, w: 324, h: 96 },
  { x: 404, y: 166, w: 594, h: 96 },
  { x: 0, y: 262, w: 1000, h: 358 },
];

let useClicked = false;
let masked = false;

const cardFrame = computed(() => {
  if (props.item.group !== 6) return null;
  const color = CARD_FRAMES[Math.trunc((props.item.gid - 200000) / 10000) - 1];
  return color ? `images/hero_card_${color}64.png` : null;
});
const tip = computed<TipValue>(() => ({
  goods: { title: props.item.name, text: attrTip(props.item.row) + props.item.description },
}));

async function onClick(e: MouseEvent) {
  if (props.item.isThing) return;
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  let menu = MENU;
  if (game.guide.justCreatedRole) {
    menu = useClicked ? MENU : MENU_GUIDE;
    if (!masked) {
      game.guide.maskAll(GUIDE_MASK);
      masked = true;
    }
  } else if (props.item.gid === 250) {
    menu = MENU_ORIGINAL_CARD;
  } else if (props.item.group === 6) {
    menu = MENU_CARD;
  }
  const action = await showMenu(menu, p.x, p.y);
  if (!action) return;
  if (action === 'use') {
    useClicked = true;
    if (game.guide.justCreatedRole) game.guide.unmask();
  }
  emit('action', action, props.item);
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="78" :h="90" style-name="BoardListDown">
    <FxCanvas :x="5" :y="4" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="item.imageName"
        :tip="tip"
        hand
        @click="onClick"
      />
      <FxImage
        v-if="cardFrame"
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="cardFrame"
        :tip="tip"
        hand
        @click="onClick"
      />
      <FxLabel
        :x="0"
        :y="49"
        :w="68"
        :h="19"
        class="count"
        :fx="{ color: 16777215, textAlign: 'right' }"
        :text="item.count"
        :tip="tip"
        @click="onClick"
      />
    </FxCanvas>
    <FxLabel
      :x="3"
      :y="70"
      :w="75"
      :h="20"
      :fx="{ color: 16777215, textAlign: 'center' }"
      :text="item.name"
    />
  </FxCanvas>
</template>

<style scoped>
.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
