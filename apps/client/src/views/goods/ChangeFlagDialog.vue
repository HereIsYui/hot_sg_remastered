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
 * UserInfo.ChangeFlagDialog (旌旗, gid 39): a new one-character flag for the lord. `onSubmit`
 * validates the length, then `onUseGoodsAlert` sends changeUserFlagchar and closes.
 */
const emit = defineEmits<{ change: [flagchar: string]; close: [] }>();

const user = useUserStore();
const t = (n: number) => i18n(`UserInfo_ChangeFlagDialog_${n}_1`);
/** `Global.flagCharLength`: the flag is a single character. */
const FLAG_CHAR_LENGTH = 1;

const flagchar = ref('');

/** `onSubmit`. */
async function onSubmit() {
  if (flagchar.value.length === 0) {
    void showAlert(t(6));
    return;
  }
  if (flagchar.value.length > FLAG_CHAR_LENGTH) {
    void showAlert(t(7));
    return;
  }
  if ((await showAlert(t(8), '', ['yes', 'no'])) === 'yes') {
    emit('change', flagchar.value);
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
    <FxCanvas :x="218" :y="171" :w="246" :h="166" style-name="PopupDialog">
      <FxButton
        style-name="ButtonRed"
        :right="10"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        :label="t(1)"
        @click="emit('close')"
      />
      <FxButton
        style-name="ButtonGreen"
        :right="78"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        :label="t(2)"
        @click="onSubmit"
      />
      <FxCanvas :x="66" :y="13" :w="114" :h="26" style-name="PopupTitle">
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
          :text="user.flagchar"
        />
      </FxCanvas>
      <FxCanvas :x="17" :y="87" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel :x="7" :y="3" :w="52" style-name="LabelText" :text="t(5)" />
      </FxCanvas>
      <FxCanvas :x="91" :y="87" :w="140" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="flagchar"
          :x="2"
          :y="3"
          :w="137"
          :h="22"
          style-name="EmptyTextInput"
          :max-chars="FLAG_CHAR_LENGTH"
          :fx="{ textAlign: 'center' }"
          @enter="onSubmit"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
