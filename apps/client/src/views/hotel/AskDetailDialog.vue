<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * Hotel.AskDetailDialog: pays 元宝 (0) or 礼金 (1) to learn a rumoured hero's exact location.
 * `price` is the rumor's cost; `send` runs the parent's `askDetail` dialog command (reply ttype
 * 2, so the 市井传闻 detail pane refreshes with the revealed location).
 */
const props = defineProps<{
  rumorId: number;
  price: number;
  send: (cmd: string, args: CommandArg[], ttype?: number) => void;
}>();
const emit = defineEmits<{ close: [] }>();

/** `onChangePayType`: 0 元宝 / 1 礼金. */
const payType = ref(0);

/** `onAction`. */
function onConfirm() {
  props.send('askDetail', [props.rumorId, payType.value], 2);
  emit('close');
}
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, borderStyle: 'none', backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="168.5" :y="110" :w="319" :h="243" style-name="PopupDialog">
      <FxCanvas :x="33.5" :y="15" :w="252" :h="24" style-name="PopupTitle">
        <FxLabel
          :y="3"
          :w="232"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'left' }"
          :text="i18n('AskDetailDialog_Text1')"
        />
      </FxCanvas>
      <FxImage :x="65" :y="73" :w="64" :h="64" source="images/item_00000.png" />
      <FxImage :x="189" :y="73" :w="64" :h="64" source="images/item_0.png" />
      <FxLabel
        :x="96.5"
        :y="119"
        :w="32.5"
        :h="18"
        :fx="{ color: 16777215, textAlign: 'right' }"
        :text="String(price)"
      />
      <FxLabel
        :x="227"
        :y="119"
        :w="27"
        :h="18"
        :fx="{ color: 16777215, textAlign: 'right' }"
        :text="String(price)"
      />
      <FxToggle
        :x="65"
        :y="145"
        :w="64"
        type="RadioButton"
        :selected="payType === 0"
        :label="i18n('AskDetailDialog_YuanbaoLabel')"
        :tip="i18n('AskDetailDialog_YuanbaoTooltip')"
        @change="payType = 0"
      />
      <FxToggle
        :x="189"
        :y="145"
        :w="64"
        type="RadioButton"
        :selected="payType === 1"
        :label="i18n('AskDetailDialog_LijinLabel')"
        :tip="i18n('AskDetailDialog_LijinTooltip')"
        @change="payType = 1"
      />
      <FxButton
        :x="96.5"
        :y="187"
        :w="66.5"
        style-name="ButtonGreen"
        :label="i18n('AskDetailDialog_OK')"
        @click="onConfirm()"
      />
      <FxButton
        :x="189"
        :y="187"
        :w="65"
        :label="i18n('AskDetailDialog_Close')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
