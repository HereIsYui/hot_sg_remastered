<script setup lang="ts">
import { computed } from 'vue';
import { timeLeftText } from '../../core/clock';
import type { WallReinforceState } from '../../game/defences';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/** Wall.WallReinforceItem: a queue entry (empty box when null). */
const props = defineProps<{
  x: number;
  y: number;
  reinforce: WallReinforceState | null;
  /** Seconds left; counts down only for the entry being built. */
  timeLeft: number;
  needText?: string;
}>();
const emit = defineEmits<{ cancel: [qid: number]; accelerate: [qid: number] }>();

const timeText = computed(() => timeLeftText(props.timeLeft, i18n));

async function cancel() {
  const r = props.reinforce;
  if (!r) return;
  const text = `${i18n('Wall_WallReinforceItemSrc_3')}${r.dname}${i18n('Wall_WallReinforceItemSrc_4')}${r.count})?`;
  if ((await showAlert(text, '', ['yes', 'no'])) === 'yes') emit('cancel', r.qid);
}

async function accelerate() {
  const r = props.reinforce;
  if (!r) return;
  if ((await showAlert(i18n('Wall_WallReinforceItemSrc_2'), '', ['yes', 'no'])) === 'yes') {
    emit('accelerate', r.qid);
  }
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
    <template v-if="reinforce">
      <FxImage :x="3" :y="9" :w="40" :h="32" :source="`images/defence_${reinforce.did}.png`" />
      <FxButton
        :x="152"
        :y="2"
        :w="45"
        :h="25"
        style-name="ButtonGreen"
        :label="i18n('Wall_WallReinforceItem_1_1')"
        :enabled="reinforce.accmark === 0"
        @click="accelerate"
      />
      <FxButton
        :x="152"
        :y="24"
        :w="45"
        :h="25"
        style-name="ButtonRed"
        :label="i18n('Wall_WallReinforceItem_2_1')"
        @click="cancel"
      />
      <FxLabel
        :x="45"
        :y="3"
        :w="45"
        :fx="{ color: 16777215, textAlign: 'left' }"
        :text="reinforce.dname"
      />
      <FxLabel :x="75" :y="25" :w="75" :h="24" :fx="{ color: 16777215 }" :text="timeText" />
      <FxLabel
        :x="45"
        :y="25"
        :w="30"
        :fx="{ color: 9227384 }"
        :text="needText ?? i18n('Wall_WallReinforceItemSrc_1')"
      />
      <FxLabel :x="92" :y="3" :w="60" :text="reinforce.count" />
    </template>
  </FxCanvas>
</template>
