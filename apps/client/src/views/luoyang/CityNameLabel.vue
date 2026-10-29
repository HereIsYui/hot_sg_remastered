<script setup lang="ts">
import { computed } from 'vue';
import type { LuoyangCity } from '../../game/luoyang';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * LuoYang.CityNameLabel: one of the eleven city slots of LuoYangBattlePanel — the serial city
 * image, its name and union owner line, the reachable-cid tip and a click that opens the city's
 * troop list (`luoyangCityTroops`).
 */
const props = defineProps<{
  city: LuoyangCity | null;
  index: number;
  x: number;
  y: number;
  selected: boolean;
}>();
const emit = defineEmits<{ click: [city: LuoyangCity] }>();

const image = computed(() => `images/luoyangBattle/luoyang_city_${props.index}.png`);
const tip = computed(() => {
  const city = props.city;
  if (!city) return '';
  return `${String(city.name ?? '')}\n${i18n('LuoYang_Battle_can_enter')}${city.nextcid || '-'}`;
});
</script>

<template>
  <FxCanvas
    :x="props.x"
    :y="props.y"
    :w="60"
    :h="25"
    :tip="tip"
    hand
    @click="props.city && emit('click', props.city)"
  >
    <FxImage :w="60" :h="25" :source="image" />
    <FxLabel
      v-if="props.selected"
      :x="0"
      :y="0"
      :w="60"
      :h="25"
      :fx="{ textAlign: 'center', color: 16776960, fontWeight: 'bold', paddingTop: 4 }"
      :text="String(props.city?.name ?? '')"
    />
    <FxLabel
      v-else
      :x="0"
      :y="0"
      :w="60"
      :h="25"
      :fx="{ textAlign: 'center', color: 16777215, paddingTop: 4 }"
      :text="String(props.city?.name ?? '')"
    />
  </FxCanvas>
</template>
