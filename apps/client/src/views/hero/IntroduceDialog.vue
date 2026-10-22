<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Hero.IntroduceDialog: a famous hero's biography (cfg_npc_hero). */
const props = defineProps<{ npc: Record<string, unknown> }>();
const emit = defineEmits<{ close: [] }>();

/** `onShowNpcIntroduce`: name（，字 zi）。introduce. */
const content = computed(() => {
  const npc = props.npc;
  let text = String(npc.name ?? '');
  if (String(npc.zi ?? '') !== '') text += i18n('Hero_IntroduceDialog_2_1') + String(npc.zi);
  text += i18n('Hero_IntroduceDialog_3') + String(npc.introduce ?? '');
  return text;
});
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="205" :y="118" :w="272" :h="255" style-name="PopupDialog">
      <FxButton style-name="Close" :right="10" :bottom="10" @click="emit('close')" />
      <FxCanvas :x="79" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Hero_IntroduceDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="13" :y="44" :w="248" :h="160" style-name="BoardListDown">
        <FxText :left="3" :right="3" :top="3" :bottom="3" scroll :text="content" />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
