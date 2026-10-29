<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/** MarrySystem.MarryChangeChildName: the one-shot rename of a child (`changeChildName [hid, name]`). */
const props = defineProps<{ child: Record<string, unknown> }>();
const emit = defineEmits<{ close: []; renamed: [] }>();

const game = useGame();
const name = ref('');

/** `onSubmit`. */
function onSubmit(): void {
  if (!name.value.trim()) return;
  game.sendGlobalCommand('MarrySystem', 'changeChildName', [
    Number(props.child.hid),
    name.value.trim(),
  ]);
  emit('close');
  emit('renamed');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.3 }">
    <FxCanvas :x="(682 - 371) / 2" :y="131" :w="371" :h="221" style-name="PanelGreyGreen">
      <FxImage :x="54" :y="22" source="images/title.png" />
      <FxLabel
        :y="27"
        :w="371"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="i18n('Marry_System_change_name')"
      />
      <FxCanvas :x="50" :y="69" :w="271" :h="136" style-name="BoardListDown">
        <FxCanvas :x="20" :y="25" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="4"
            :y="3"
            :w="65"
            style-name="LabelText"
            :fx="{ fontWeight: 'normal' }"
            :text="i18n('Marry_System_change_name_old')"
          />
        </FxCanvas>
        <FxCanvas :x="101" :y="25" :w="139" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="3"
            :w="139"
            :fx="{ textAlign: 'center', color: 4783872, fontWeight: 'bold' }"
            :text="String(props.child.name ?? '')"
          />
        </FxCanvas>
        <FxCanvas :x="20" :y="58" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="65"
            style-name="LabelText"
            :text="i18n('Marry_System_change_name_new')"
          />
        </FxCanvas>
        <FxCanvas :x="101" :y="58" :w="140" :h="26" style-name="BoardListDown">
          <FxTextInput
            v-model="name"
            :x="2"
            :y="3"
            :w="137"
            :h="22"
            style-name="EmptyTextInput"
            :fx="{ textAlign: 'center' }"
          />
        </FxCanvas>
        <FxButton
          :x="51"
          :y="92"
          :w="72"
          style-name="ButtonYellow"
          :label="i18n('Chat_ChatPrivateInput_3_1')"
          @click="onSubmit"
        />
        <FxButton
          :x="149"
          :y="92"
          :w="72"
          :label="i18n('Chat_ChatPrivateInput_2_1')"
          @click="emit('close')"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
