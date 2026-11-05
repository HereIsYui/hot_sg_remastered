<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { MORIZHIREN_ID, type Armor } from '../../game/armor';
import { useGame } from '../../game/game';
import { goodsImage } from '../../game/goods';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import type { TipValue } from '../../ui/tooltip';
import UserArmorItem from './UserArmorItem.vue';

/** Armor.ActiveArmorSpecial: a 神兵鉴符 activates the piece's special (末日之刃 re-rolls it). */
const props = defineProps<{ armor: Armor }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const goods = ref<Record<string, unknown> | null>(null);

const isMorizhiren = computed(
  () => parseInt(String(props.armor.row.armorid), 10) === MORIZHIREN_ID,
);
const desc = computed(() =>
  i18n(isMorizhiren.value ? 'Armor_ActiveSpecial_desc_2' : 'Armor_ActiveSpecial_desc'),
);
const goodsTip = computed<TipValue>(() =>
  goods.value
    ? {
        goods: {
          title: String(goods.value.name ?? ''),
          text: String(goods.value.description ?? ''),
        },
      }
    : '',
);

/** `loadGoods` */
function loadGoods() {
  game.sendGlobalCommand('armor', 'loadActiveArmorSpecialGoods', [props.armor.sid]);
}
watch(() => props.armor, loadGoods, { immediate: true });

const unregister = game.addGlobalReceiver('armor', (command, data) => {
  if (command !== 'loadActiveArmorSpecialGoods' || !Array.isArray(data)) return;
  const row = data[0] as unknown;
  goods.value = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
});
onUnmounted(unregister);

/** `onActive`: 末日之刃 stays open for another roll. */
function onActive() {
  game.sendGlobalCommand('armor', 'activeArmorSpecial', [props.armor.sid]);
  if (!isMorizhiren.value) emit('close');
}
</script>

<template>
  <FxCanvas :x="178" :y="122" :w="326" :h="248" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="106" :y="10" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="114"
        :fx="{ textAlign: 'center' }"
        :text="i18n('Armor_ActiveSpecial')"
      />
    </FxCanvas>
    <UserArmorItem :x="45" :y="50" :armor="armor" />
    <FxCanvas :x="205" :y="50" :w="76" :h="88" style-name="BoardListDown">
      <FxCanvas :x="6" :y="4" :w="64" :h="64" style-name="EquipBigItem2">
        <FxImage
          :x="8"
          :y="8"
          :w="48"
          :h="48"
          :source="goods ? goodsImage(goods) : null"
          :tip="goodsTip"
        />
        <FxLabel
          :x="8"
          :y="40"
          :w="48"
          :h="20"
          class="count"
          :fx="{ color: 16777215, textAlign: 'right' }"
          :text="String(goods?.count ?? '')"
        />
      </FxCanvas>
      <FxLabel
        :x="10"
        :y="69"
        :w="58"
        :h="18"
        :fx="{ color: 16777215, textAlign: 'right' }"
        :text="String(goods?.name ?? '')"
        :tip="goodsTip"
      />
    </FxCanvas>
    <FxText :x="45" :y="145" :w="245" :h="51" type="TextArea" :text="desc" />
    <FxButton
      :left="67"
      :bottom="13"
      :w="86"
      style-name="ButtonGreen"
      :fx="{ fontSize: 16 }"
      :label="i18n('Armor_ActiveSpecial')"
      @click="onActive"
    />
    <FxButton
      :right="48"
      :bottom="13"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="emit('close')"
    />
  </FxCanvas>
</template>

<style scoped>
.count {
  pointer-events: none;
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
