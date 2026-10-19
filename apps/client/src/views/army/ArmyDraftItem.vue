<script setup lang="ts">
import { computed } from 'vue';
import { timeLeftText } from '../../core/clock';
import type { ArmyDraftState } from '../../game/soldiers';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/** Army.ArmyDraftItem: a queue entry (empty box when null). */
const props = defineProps<{
  x: number;
  y: number;
  draft: ArmyDraftState | null;
  /** Seconds left; counts down only for the entry in training. */
  timeLeft: number;
  needText?: string;
}>();
const emit = defineEmits<{ cancel: [qid: number] }>();

const timeText = computed(() => timeLeftText(props.timeLeft, i18n));

async function cancel() {
  const d = props.draft;
  if (!d) return;
  const text = i18n('Basic_StringDef_3').replace('%s', d.sname).replace('%d', String(d.count));
  if ((await showAlert(text, '', ['yes', 'no'])) === 'yes') emit('cancel', d.qid);
}
</script>

<template>
  <FxCanvas
    :x="x"
    :y="y"
    :w="200"
    :h="50"
    style-name="BoardListDown"
    :fx="{ fontSize: 12, borderStyle: 'outset' }"
  >
    <template v-if="draft">
      <FxImage :x="3" :y="9" :w="32" :h="32" :source="`images/army_${draft.sid}.png`" />
      <!-- 加速 needs the item dialogs (UseGoodsDialog) of the shop. -->
      <FxButton
        :x="152"
        :y="1"
        :w="46"
        :h="25"
        style-name="ButtonGreen"
        :fx="{ fontSize: 12 }"
        :label="i18n('Army_ArmyDraftItem_1_1')"
        :enabled="false"
      />
      <FxButton
        :x="152"
        :y="23"
        :w="45"
        :h="25"
        :fx="{ fontSize: 12 }"
        :label="i18n('Army_ArmyDraftItem_2_1')"
        @click="cancel"
      />
      <FxLabel :x="38" :y="5" :w="45" :fx="{ color: 16777215 }" :text="draft.sname" />
      <FxLabel :x="68" :y="24" :w="87" :h="24" :fx="{ color: 16777215 }" :text="timeText" />
      <FxLabel :x="38" :y="24" :w="30" :fx="{ color: 9227384 }" :text="needText ?? ''" />
      <FxLabel :x="85" :y="5" :w="65" :fx="{ textAlign: 'left' }" :text="draft.count" />
    </template>
  </FxCanvas>
</template>
