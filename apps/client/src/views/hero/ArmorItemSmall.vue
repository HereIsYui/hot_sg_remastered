<script setup lang="ts">
import { computed } from 'vue';
import {
  armorInfo,
  armorPartName,
  armorTip,
  armorTipRow,
  EMPTY_ARMOR_IMAGE,
  type Armor,
} from '../../game/armor';
import { i18n } from '../../i18n';
import { gameAlert } from '../../ui/alert';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import { MENU_SEPARATOR, showMenu, type MenuItem } from '../../ui/menu';
import { stagePoint, type TipValue } from '../../ui/tooltip';

/** Hero.ArmorItemSmall: one gear slot; a click opens 装备 / 卸下 / 修理 / 修复. */
const props = defineProps<{
  x: number;
  y: number;
  spart: number;
  armor?: Armor;
  healthy: boolean;
}>();
const emit = defineEmits<{ action: [action: string, spart: number] }>();

const src = (n: number) => i18n(`Hero_HeroArmorPanelSrc_${n}`);
const partText = computed(() => armorPartName(Math.floor(props.spart / 10)));
const tip = computed<TipValue>(() => {
  const a = props.armor;
  if (!a) return i18n('Hero_ArmorItemSmall_1_1');
  return { armor: () => armorTip(armorInfo, armorTipRow(a)) };
});

/** `onClick` */
async function onClick(e: MouseEvent) {
  if (!props.healthy) {
    gameAlert(src(18));
    return;
  }
  const a = props.armor;
  const menu: MenuItem[] = [
    { label: src(1), data: 'equip' },
    { label: src(2), data: 'offload', enabled: !!a },
    MENU_SEPARATOR,
    { label: src(3), data: 'repair', enabled: !!a && a.hp < a.hpMax },
    {
      label: src(4),
      data: 'renovate',
      enabled: !!a && !(a.hpMax >= a.oriHpMax && a.hp >= a.hpMax),
    },
  ];
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  const action = await showMenu(menu, p.x, p.y);
  if (action) emit('action', action, props.spart);
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="32" :h="32" style-name="BoardListDown">
    <FxImage
      :x="0"
      :y="0"
      :w="32"
      :h="32"
      :source="armor?.imageName ?? EMPTY_ARMOR_IMAGE"
      :tip="tip"
      hand
      @click="onClick"
    />
    <FxLabel
      v-if="!armor"
      :x="0"
      :y="8"
      :w="32"
      :fx="{ textAlign: 'center', color: 10526880 }"
      :text="partText"
      :tip="i18n('Hero_ArmorItemSmall_2_1')"
      @click="onClick"
    />
  </FxCanvas>
</template>
