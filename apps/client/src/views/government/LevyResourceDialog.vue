<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { levyOptions, levyPreview } from '../../game/government';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * Government.LevyResourceDialog: an extra tenth of an hour's yield for 20 morale. The original
 * first shows the 防沉迷 reminder to minors (AdultSrc), which is not ported.
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const t = (key: string) => i18n(`Government_LevyResourceDialog_${key}`);
const options = levyOptions(i18n);
const resource = ref(0);
const preview = computed(() => levyPreview(resource.value, city.people_all, i18n));

function onSubmit() {
  game.sendGlobalCommand('city', 'levyResource', [city.cid, resource.value]);
  emit('close');
}

const rows = computed(() => [
  { y: 44, title: t('2_1'), value: city.people_all },
  { y: 78, title: t('3_1'), value: city.morale },
]);
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="236.5" :y="105" :w="209" :h="305" style-name="PopupDialog">
      <FxButton
        style-name="Close"
        :right="10"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :x="47.5" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel :x="0" :y="3" :w="114" :fx="{ textAlign: 'center' }" :text="t('1_1')" />
      </FxCanvas>
      <template v-for="row in rows" :key="row.y">
        <FxCanvas :x="28" :y="row.y" :w="57" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="6"
            :y="3"
            :w="43"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="row.title"
          />
        </FxCanvas>
        <FxCanvas :x="93" :y="row.y" :w="80" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="3"
            :w="80"
            style-name="ItemValue"
            :fx="{ textAlign: 'center' }"
            :text="row.value"
          />
        </FxCanvas>
      </template>
      <FxCanvas :x="28" :y="112" :w="57" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="43"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('4_1')"
        />
      </FxCanvas>
      <FxLabel :x="28" :y="149" :w="157" style-name="ItemValue" :text="preview" />
      <FxText :x="12" :y="180" :w="185" :h="44" type="TextArea" :text="t('5_1')" />
      <FxButton
        :right="78"
        :bottom="10"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="t('6_1')"
        @click="onSubmit"
      />
      <FxComboBox v-model:selected-index="resource" :x="93" :y="114" :w="80" :items="options" />
    </FxCanvas>
  </FxCanvas>
</template>
