<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Government.ChangeNameDialog: the city's new name, once a day. */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const t = (key: string) => i18n(`Government_ChangeNameDialog_${key}`);
const name = ref('');

function onSubmit() {
  game.sendGlobalCommand('city', 'changeCityName', [city.cid, name.value]);
  emit('close');
}
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="218" :y="97" :w="246" :h="194" style-name="PopupDialog">
      <FxButton
        style-name="Close"
        :right="10"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxButton
        style-name="Confirm"
        :right="78"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        @click="onSubmit"
      />
      <FxCanvas :x="66" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel :x="0" :y="3" :w="114" :fx="{ textAlign: 'center' }" :text="t('1_1')" />
      </FxCanvas>
      <FxCanvas :x="10" :y="44" :w="81" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="2"
          :y="3"
          :w="77"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="99" :y="44" :w="137" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="2"
          :y="3"
          :w="133"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="city.name + city.position"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="78" :w="81" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="2"
          :y="3"
          :w="77"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="99" :y="78" :w="137" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="name"
          :x="5"
          :y="4"
          :w="130"
          :h="22"
          style-name="EmptyTextInput"
          @enter="onSubmit"
        />
      </FxCanvas>
      <FxText :x="10" :y="112" :w="226" :text="t('4_1')" />
    </FxCanvas>
  </FxCanvas>
</template>
