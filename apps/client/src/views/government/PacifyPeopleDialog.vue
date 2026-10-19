<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { pacifyOptions, pacifyPreview } from '../../game/government';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Government.PacifyPeopleDialog: 赈灾, 祈福, 祭天 or 增丁. */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const t = (key: string) => i18n(`Government_PacifyPeopleDialog_${key}`);
const options = pacifyOptions(i18n);
const action = ref(0);
const preview = computed(() => pacifyPreview(action.value, city.people_max, i18n));

function onSubmit() {
  emit('close');
  game.sendGlobalCommand('city', 'pacifyPeople', [city.cid, action.value]);
}

const rows = computed(() => [
  { y: 44, title: t('3_1'), value: city.people_all },
  { y: 78, title: t('4_1'), value: city.morale },
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
    <FxCanvas :x="218" :y="101" :w="209" :h="280" style-name="PopupDialog">
      <FxButton
        style-name="Close"
        :right="10"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :x="47.5" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('1_1')"
        />
      </FxCanvas>
      <FxButton
        :right="78"
        :bottom="10"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="options[action]"
        @click="onSubmit"
      />
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
          :text="t('5_1')"
        />
      </FxCanvas>
      <FxText :x="17" :y="146" :w="176" :h="80" type="TextArea" :text="preview" />
      <FxComboBox v-model:selected-index="action" :x="93" :y="114" :w="80" :items="options" />
    </FxCanvas>
  </FxCanvas>
</template>
