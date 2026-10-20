<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** Hero.ChangeHeroNameDialog: a new name for the hero. */
defineProps<{ name: string }>();
const emit = defineEmits<{ change: [name: string]; close: [] }>();

const t = (n: number) => i18n(`Hero_ChangeHeroNameDialog_${n}_1`);
const newName = ref('');

function onChangeName() {
  emit('change', newName.value);
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
    <FxCanvas :x="218" :y="167" :w="246" :h="158" style-name="PopupDialog">
      <FxButton style-name="Close" :right="10" :bottom="10" @click="emit('close')" />
      <FxButton
        style-name="ButtonRed"
        :right="78"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        :label="t(1)"
        @click="onChangeName"
      />
      <FxCanvas :x="66" :y="11" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          :fx="{ textAlign: 'center', color: 15192461 }"
          :text="t(2)"
        />
      </FxCanvas>
      <FxCanvas :x="20" :y="44" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="2"
          :y="3"
          :w="56"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(3)"
        />
      </FxCanvas>
      <FxCanvas :x="99" :y="44" :w="120" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="2"
          :y="3"
          :w="116"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="name"
        />
      </FxCanvas>
      <FxCanvas :x="20" :y="78" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="2"
          :y="3"
          :w="56"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(4)"
        />
      </FxCanvas>
      <FxCanvas :x="99" :y="78" :w="120" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="newName"
          :x="2"
          :y="4"
          :w="116"
          :h="22"
          style-name="EmptyTextInput"
          :fx="{ textAlign: 'center' }"
          @enter="onChangeName"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
