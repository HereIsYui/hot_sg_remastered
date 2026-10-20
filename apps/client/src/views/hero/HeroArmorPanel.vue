<script setup lang="ts">
import { computed } from 'vue';
import { ARMOR_SPARTS, armorPartName, EMPTY_ARMOR_IMAGE, SKILL_SPART } from '../../game/armor';
import { skillImage, skillTip } from '../../game/skill';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import { showMenu } from '../../ui/menu';
import { stagePoint, type TipValue } from '../../ui/tooltip';
import ArmorItemSmall from './ArmorItemSmall.vue';
import type { HeroArmorState } from './heroArmor';
import type { HeroSkillControls } from './heroSkill';

/**
 * Hero.HeroArmorPanel: the hero's 16 gear slots over the figure, the skill book slot, and the
 * whole-set buttons.
 */
const props = defineProps<{
  x: number;
  y: number;
  state: HeroArmorState;
  skill: HeroSkillControls;
}>();

const SLOTS: [number, number][] = [
  [90, 6],
  [90, 44],
  [45, 41],
  [90, 85],
  [155, 90],
  [90, 128],
  [14, 150],
  [120, 307],
  [182, 149],
  [190, 187],
  [70, 200],
  [115, 200],
  [8, 205],
  [8, 241],
  [8, 277],
  [192, 331],
];
const t = (n: number) => i18n(`Hero_HeroArmorPanel_${n}_1`);

const worn = computed(() => props.skill.state.value.worn);
const skillTipValue = computed<TipValue>(() =>
  worn.value ? { skill: skillTip(worn.value) } : i18n('Hero_ArmorItemSmall_8_1'),
);

/** HeroSkillItemSmall.onClick */
async function onSkill(e: MouseEvent) {
  if (props.state.unhealthy()) return;
  const empty = !worn.value;
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  const action = await showMenu(
    [
      { label: i18n('Hero_ArmorItemSmall_3_1'), data: 'equip', enabled: empty },
      { label: i18n('Hero_ArmorItemSmall_4_1'), data: 'offload', enabled: !empty },
    ],
    p.x,
    p.y,
  );
  if (action) props.skill.onSlotAction(action);
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="235" :h="375" style-name="BoardListDown">
    <FxImage :x="19" :y="3" :w="205" :h="369" source="images/back_armor.png" />
    <ArmorItemSmall
      v-for="(spart, i) in ARMOR_SPARTS"
      :key="spart"
      :x="SLOTS[i]![0]"
      :y="SLOTS[i]![1]"
      :spart="spart"
      :armor="state.armors.value[spart]"
      :healthy="state.healthy.value"
      @action="state.onSlotAction"
    />
    <FxCanvas :x="12" :y="92" :w="32" :h="32" style-name="BoardListDown">
      <FxImage
        :x="0"
        :y="0"
        :w="32"
        :h="32"
        :source="worn ? skillImage(worn.skill, worn.level) : EMPTY_ARMOR_IMAGE"
        :tip="skillTipValue"
        hand
        @click="onSkill"
      />
      <FxLabel
        v-if="!worn"
        :x="0"
        :y="8"
        :w="32"
        :fx="{ textAlign: 'center', color: 10526880 }"
        :text="armorPartName(SKILL_SPART / 10)"
        :tip="i18n('Hero_ArmorItemSmall_8_2')"
        @click="onSkill"
      />
    </FxCanvas>
    <FxButton
      :x="168"
      :y="10"
      style-name="ButtonRepair"
      :tip="t(1)"
      :enabled="state.hasArmors.value"
      @click="state.onRepairAll"
    />
    <FxButton
      :x="200"
      :y="10"
      style-name="ButtonRenovate"
      :tip="t(2)"
      :enabled="state.hasArmors.value"
      @click="state.onRenovateAll"
    />
    <FxButton
      :x="18"
      :y="10"
      style-name="ButtonDeify"
      :tip="t(3)"
      :enabled="state.finishOneTie.value"
      @click="state.onDeify"
    />
    <FxButton
      :x="48"
      :y="10"
      style-name="ButtonRenovate"
      :tip="t(4)"
      :enabled="state.hasArmors.value"
      @click="state.onOffloadAll"
    />
  </FxCanvas>
</template>
