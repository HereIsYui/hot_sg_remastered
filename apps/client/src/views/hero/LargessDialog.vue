<script setup lang="ts">
import { computed, ref } from 'vue';
import { largessText, type HeroDetail } from '../../game/hero';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Hero.LargessDialog: gold or a jewel for the hero's loyalty. */
const props = defineProps<{ hero: HeroDetail }>();
const emit = defineEmits<{ largess: [typeidx: number]; close: [] }>();

const t = (n: number | string) => i18n(`Hero_LargessDialog_${n}_1`);
const ITEMS = Array.from({ length: 10 }, (_, i) => i18n(`Hero_LargessDialog_7_1_${i + 1}`));
const selected = ref(0);
const text = computed(() =>
  largessText(selected.value, props.hero.goldNeed, parseInt(props.hero.loyalty, 10) || 0),
);

/** `onLargess`. */
function onLargess() {
  emit('largess', selected.value);
  emit('close');
}

const rows = computed(
  () =>
    [
      [44, 3, props.hero.name],
      [78, 4, props.hero.level],
      [112, 5, props.hero.loyalty],
    ] as const,
);
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="207" :y="88" :w="268" :h="316" style-name="PopupDialog">
      <FxButton style-name="Close" :right="15" :bottom="15" @click="emit('close')" />
      <FxCanvas :x="77" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(1)"
        />
      </FxCanvas>
      <FxButton
        :w="65"
        :h="36"
        :right="88"
        :bottom="16"
        style-name="ButtonGreen"
        :fx="{ fontSize: 16 }"
        :label="t(2)"
        @click="onLargess"
      />
      <template v-for="[y, title, value] in rows" :key="y">
        <FxCanvas :x="23" :y="y" :w="57" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="6"
            :y="3"
            :w="43"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="t(title)"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="y" :w="156" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="10"
            :y="3"
            :w="136"
            style-name="ItemValue"
            :fx="{ textAlign: 'center' }"
            :text="value"
          />
        </FxCanvas>
      </template>
      <FxCanvas :x="23" :y="146" :w="57" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="43"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(6)"
        />
      </FxCanvas>
      <FxComboBox v-model:selected-index="selected" :x="88" :y="148" :w="156" :items="ITEMS" />
      <FxText :x="23" :y="180" :w="221" :h="82" type="TextArea" :text="text" />
    </FxCanvas>
  </FxCanvas>
</template>
