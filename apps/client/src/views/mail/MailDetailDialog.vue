<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { MAIL_PAGE, makeMailTime, parseMailDetail } from '../../game/mail';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Mail.MailDetailDialog: a letter's header fields and body. A 系统信 body is rendered as HTML, a
 * personal letter as plain text. The 回复 button (inbox only) opens the compose dialog pre-filled
 * from this letter. `readInboxMail` / `readOutboxMail` / `readSysMail` replies arrive on the
 * `mail_detail` action.
 */
const props = defineProps<{ mid: number; page: number }>();

const game = useGame();
const t = (n: number | string) => i18n(`Mail_MailDetailDialog_${n}`);
const unit = (k: string) => i18n(k);

type Row = Record<string, unknown>;
const detail = ref<Row>({});
const isSys = ref(false);
/** `mReplyable`: only an inbox letter can be replied to. */
const replyable = computed(() => props.page === MAIL_PAGE.inbox);

const name = computed(() => String(detail.value.name ?? ''));
const fromname = computed(() => String(detail.value.fromname ?? ''));
const title = computed(() => String(detail.value.title ?? ''));
const time = computed(() => makeMailTime(parseInt(String(detail.value.posttime), 10) || 0, unit));
const content = computed(() => String(detail.value.content ?? ''));

function load(): void {
  if (props.page === MAIL_PAGE.inbox) {
    isSys.value = false;
    game.sendGlobalCommand('mail_detail', 'readInboxMail', [props.mid]);
  } else if (props.page === MAIL_PAGE.outbox) {
    isSys.value = false;
    game.sendGlobalCommand('mail_detail', 'readOutboxMail', [props.mid]);
  } else {
    isSys.value = true;
    game.sendGlobalCommand('mail_detail', 'readSysMail', [props.mid]);
  }
}

function reply(): void {
  game.closeMailDetail();
  game.showMailWrite(detail.value);
}

const unregister = game.addGlobalReceiver('mail_detail', (command, data) => {
  detail.value = parseMailDetail(data);
  isSys.value = command === 'readSysMail';
});
onMounted(load);
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="27" :y="54" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="18" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="23"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="t('3_1')"
    />

    <FxCanvas :x="23" :y="76" :w="635" :h="350" style-name="BoardListDown">
      <!-- header fields -->
      <FxCanvas :x="6" :y="12" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="5"
          :y="4"
          :w="58"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="78" :y="12" :w="130" :h="26" style-name="BoardListDown">
        <FxTextInput
          :x="10"
          :y="3"
          :w="120"
          :h="22"
          style-name="EmptyTextInput"
          :editable="false"
          :model-value="name"
          :fx="{ textAlign: 'left' }"
        />
      </FxCanvas>
      <FxCanvas :x="214" :y="12" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="5"
          :y="4"
          :w="58"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('5_1')"
        />
      </FxCanvas>
      <FxCanvas :x="286" :y="12" :w="130" :h="26" style-name="BoardListDown">
        <FxTextInput
          :x="10"
          :y="4"
          :w="120"
          style-name="EmptyTextInput"
          :editable="false"
          :model-value="fromname"
          :fx="{ textAlign: 'left' }"
        />
      </FxCanvas>
      <FxCanvas :x="422" :y="12" :w="60" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="5"
          :y="4"
          :w="50"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('7_1')"
        />
      </FxCanvas>
      <FxCanvas :x="488" :y="12" :w="140" :h="26" style-name="BoardListDown">
        <FxTextInput
          :x="5"
          :y="4"
          :w="130"
          style-name="EmptyTextInput"
          :editable="false"
          :model-value="time"
          :fx="{ textAlign: 'center' }"
        />
      </FxCanvas>
      <FxCanvas :x="6" :y="47" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="5"
          :y="4"
          :w="58"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t('6_1')"
        />
      </FxCanvas>
      <FxCanvas :x="78" :y="47" :w="380" :h="26" style-name="BoardListDown">
        <FxTextInput
          :x="10"
          :y="4"
          :w="360"
          style-name="EmptyTextInput"
          :editable="false"
          :model-value="title"
          :fx="{ textAlign: 'left' }"
        />
      </FxCanvas>

      <!-- body: html for 系统信, plain text otherwise -->
      <FxCanvas v-if="isSys" :x="2" :y="75" :w="629" :h="273" style-name="BoardListDown">
        <FxText :x="5" :y="5" :w="620" :h="265" scroll :html="content" :fx="{ color: 15983262 }" />
      </FxCanvas>
      <FxCanvas v-else :x="2" :y="120" :w="629" :h="228" style-name="BoardListDown">
        <FxText :x="5" :y="5" :w="620" :h="220" scroll :text="content" :fx="{ color: 15983262 }" />
      </FxCanvas>
    </FxCanvas>

    <FxButton
      v-if="replyable"
      :x="388"
      :y="439"
      :w="80"
      :h="36"
      style-name="ButtonGreen"
      :label="t('2_1')"
      @click="reply()"
    />
    <FxButton :x="505" :y="439" style-name="Return" @click="game.closeMailDetail()" />
    <FxButton
      :x="582"
      :y="439"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeMailDetail()"
    />
  </FxCanvas>
</template>
