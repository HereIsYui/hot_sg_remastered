<script setup lang="ts">
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxText from '../../ui/FxText.vue';

/** Building.DestroyPanel: demolish one level, or everything with a 火药筒. */
const emit = defineEmits<{ all: []; level: []; close: [] }>();

const W = 274;
const H = 144;
const BUTTON_W = 70;
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" :fx="{ fontSize: 12 }">
    <FxCanvas :x="(682 - W) / 2" :y="(492 - H) / 2" :w="W" :h="H" style-name="PopupDialog">
      <FxButton
        :left="20"
        :bottom="15"
        :w="BUTTON_W"
        style-name="ButtonYellow"
        :label="i18n('Building_DestroyPanel_1_1')"
        @click="emit('all')"
      />
      <FxButton
        :x="(W - BUTTON_W) / 2"
        :bottom="15"
        :w="BUTTON_W"
        style-name="ButtonGreen"
        :label="i18n('Building_DestroyPanel_2_1')"
        @click="emit('level')"
      />
      <FxButton
        :right="20"
        :bottom="15"
        :w="BUTTON_W"
        :label="i18n('Building_DestroyPanel_3_1')"
        @click="emit('close')"
      />
      <FxText
        :top="15"
        :left="10"
        :right="10"
        :bottom="55"
        style-name="EmptyTextInput"
        :text="i18n('Building_DestroyPanel_4_1')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
