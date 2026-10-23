<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { canWriteUnionMail } from '../../game/mail';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * Mail.MailWriteDialog: compose a personal letter, or a 联盟群发 when the lord is a 盟主 / 副盟主
 * (the checkbox). A reply pre-fills the receiver, subject and quoted body. `send` dispatches
 * `sendPersonMail` / `sendUnionMail`; the reply arrives on the `mail_write` action and clears the
 * form. 联盟群发 is refused server-side (暂未开放) until the 联盟 module is ported.
 */
const props = defineProps<{ reply?: Record<string, unknown> | null; receiver?: string }>();

const game = useGame();
const user = useUserStore();
const t = (n: number) => i18n(`Mail_MailWriteDialog_${n}_1`);
const src = (n: number) => i18n(`Mail_MailWriteDialogSrc_${n}`);

const toName = ref('');
const subject = ref('');
const content = ref('');
const unionSend = ref(false);

const canUnion = computed(() => canWriteUnionMail(user.unionid, user.unionpos));

function send(): void {
  const args: (string | number)[] = [user.username];
  if (unionSend.value) {
    args.push(user.unionid);
  } else {
    if (toName.value.length === 0) {
      void showAlert(src(2));
      return;
    }
    args.push(toName.value);
  }
  if (content.value.length > 500) {
    void showAlert(src(3));
    return;
  }
  args.push(subject.value);
  args.push(content.value);
  game.sendGlobalCommand('mail_write', unionSend.value ? 'sendUnionMail' : 'sendPersonMail', args);
}

const unregister = game.addGlobalReceiver('mail_write', () => {
  toName.value = '';
  subject.value = '';
  content.value = '';
  gameAlert(src(1));
});

onMounted(() => {
  if (props.receiver) toName.value = props.receiver;
  const r = props.reply;
  if (r) {
    toName.value = String(r.fromname ?? '');
    subject.value = src(4) + String(r.title ?? '');
    content.value = src(5) + String(r.fromname ?? '') + src(6) + String(r.content ?? '');
  }
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="27" :y="54" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="16" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="20"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="t(3)"
    />

    <FxCanvas :x="23" :y="76" :w="635" :h="350" style-name="BoardListDown">
      <!-- receiver -->
      <FxCanvas :x="6" :y="10" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="5"
          :y="4"
          :w="58"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(4)"
        />
      </FxCanvas>
      <FxCanvas :x="78" :y="10" :w="130" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="toName"
          :x="10"
          :y="4"
          :w="120"
          :h="22"
          style-name="EmptyTextInput"
          :max-chars="8"
          :editable="!unionSend"
          :fx="{ textAlign: 'left', color: 15983262 }"
        />
      </FxCanvas>

      <!-- 联盟群发 checkbox -->
      <FxToggle
        v-if="canUnion"
        v-model:selected="unionSend"
        :x="224"
        :y="12"
        :label="t(7)"
        :fx="{ color: 15192461 }"
      />
      <FxLabel
        v-if="canUnion"
        :x="311"
        :y="14"
        :w="206"
        :h="18"
        :fx="{ textAlign: 'left', color: 15192461, fontWeight: 'normal' }"
        :text="t(8)"
      />

      <!-- subject -->
      <FxCanvas :x="6" :y="45" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="5"
          :y="4"
          :w="58"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(5)"
        />
      </FxCanvas>
      <FxCanvas :x="78" :y="45" :w="340" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="subject"
          :x="10"
          :y="4"
          :w="320"
          style-name="EmptyTextInput"
          :max-chars="20"
          :fx="{ textAlign: 'left' }"
        />
      </FxCanvas>

      <!-- body -->
      <FxCanvas :x="2" :y="82" :w="630" :h="265" style-name="BoardListDown">
        <textarea v-model="content" class="mail-body" maxlength="500"></textarea>
      </FxCanvas>
    </FxCanvas>

    <FxButton
      :x="477"
      :y="439"
      :w="80"
      :h="36"
      style-name="ButtonGreen"
      :label="t(2)"
      @click="send()"
    />
    <FxButton
      :x="582"
      :y="439"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeMailWrite()"
    />
  </FxCanvas>
</template>

<style scoped>
.mail-body {
  position: absolute;
  inset: 5px;
  width: 610px;
  height: 248px;
  box-sizing: border-box;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: #f3dede;
  font: inherit;
  padding: 2px;
}
</style>
