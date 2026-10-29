<script setup lang="ts">
import type { LyUserTroop } from '../../game/luoyang';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * LuoYang.BattleTroopEmptyItem: one own-troop slot of the map's heroPanel — the hero portrait,
 * the 在途/在城 state (`LuoYang_Battle_select_troop_1/2`), and the selection frame when the
 * troop is the one marching orders are given to.
 */
const props = defineProps<{
  troop: LyUserTroop | null;
  selected: boolean;
  userSex: number;
  userFace: number;
}>();
const emit = defineEmits<{ select: [troop: LyUserTroop] }>();

const stateText = (troop: LyUserTroop): string =>
  Number(troop.cid) === 0
    ? i18n('LuoYang_Battle_select_troop_1')
    : i18n('LuoYang_Battle_select_troop_2');
const image = (troop: LyUserTroop): string =>
  Number(troop.herotype) === 1000
    ? `images/player/player_${props.userSex === 0 ? 'girl' : 'boy'}_${props.userFace + 1}.jpg`
    : `images/herox/hero_${Number(troop.sex) === 0 ? 'girl' : 'boy'}_${Number(troop.face ?? 0)}.jpg`;
</script>

<template>
  <FxCanvas :w="60" :h="66" hand @click="props.troop && emit('select', props.troop)">
    <FxCanvas :x="0" :y="0" :w="56" :h="42" style-name="FramePicture">
      <FxImage
        v-if="props.troop"
        :x="0"
        :y="0"
        :w="56"
        :h="42"
        :source="image(props.troop)"
        :tip="String(props.troop.heroname ?? '')"
      />
    </FxCanvas>
    <FxLabel
      v-if="props.troop"
      :x="0"
      :y="44"
      :w="60"
      :h="20"
      :fx="{ textAlign: 'center', color: props.selected ? 16776960 : 16777215, fontSize: 11 }"
      :text="stateText(props.troop)"
    />
    <!-- selection frame -->
    <FxCanvas
      v-if="props.selected"
      :x="0"
      :y="0"
      :w="60"
      :h="64"
      :fx="{ backgroundColor: 16776960, backgroundAlpha: 0.15 }"
    />
  </FxCanvas>
</template>
