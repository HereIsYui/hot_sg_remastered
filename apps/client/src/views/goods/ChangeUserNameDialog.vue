<script setup lang="ts">
import { ref } from 'vue';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * UserInfo.ChangeNameDialog (名帖, gid 84; also the 君主改名 button on the hero detail): a new
 * lord name. `onSubmit` validates the length and rejects a line break, then `onUseGoodsAlert`
 * sends changeUserName and closes.
 */
const emit = defineEmits<{ change: [name: string]; close: [] }>();

const user = useUserStore();
const t = (n: number) => i18n(`UserInfo_ChangeNameDialog_${n}_1`);
/** `Global.maxCharsLength`: the lord name is at most 8 characters. */
const MAX_NAME_LENGTH = 8;

const newName = ref('');

/** `onSubmit`. */
async function onSubmit() {
  const name = newName.value;
  if (name.length === 0) {
    void showAlert(t(6));
    return;
  }
  if (name.length > MAX_NAME_LENGTH) {
    void showAlert(t(7));
    return;
  }
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) === 13) {
      void showAlert(t(8));
      return;
    }
  }
  if ((await showAlert(t(9), '', ['yes', 'no'])) === 'yes') {
    emit('change', name);
    emit('close');
  }
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
    <FxCanvas :x="218" :y="161" :w="246" :h="171" style-name="PopupDialog">
      <FxButton
        style-name="ButtonRed"
        :right="15"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(1)"
        @click="emit('close')"
      />
      <FxButton
        style-name="ButtonGreen"
        :right="85"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(2)"
        @click="onSubmit"
      />
      <FxCanvas :x="66" :y="16" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="4"
          :w="114"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="t(3)"
        />
      </FxCanvas>
      <FxCanvas :x="17" :y="53" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="7"
          :y="3"
          :w="52"
          style-name="LabelText"
          :fx="{ fontWeight: 'normal' }"
          :text="t(4)"
        />
      </FxCanvas>
      <FxCanvas :x="91" :y="53" :w="139" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="139"
          :fx="{ textAlign: 'center', color: 4783872, fontWeight: 'bold' }"
          :text="user.username"
        />
      </FxCanvas>
      <FxCanvas :x="17" :y="87" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel :x="7" :y="3" :w="52" style-name="LabelText" :text="t(5)" />
      </FxCanvas>
      <FxCanvas :x="91" :y="87" :w="140" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="newName"
          :x="2"
          :y="3"
          :w="137"
          :h="22"
          style-name="EmptyTextInput"
          :max-chars="MAX_NAME_LENGTH"
          :fx="{ textAlign: 'center' }"
          @enter="onSubmit"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
