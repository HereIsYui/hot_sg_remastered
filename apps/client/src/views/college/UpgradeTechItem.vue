<script setup lang="ts">
import { computed } from 'vue';
import { timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import type { TechnicState } from '../../game/technics';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/** College.UpgradeTechItem: a technic some 书院 is researching (empty box when null). */
const props = defineProps<{
  x: number;
  y: number;
  technic: TechnicState | null;
  /** The city of the dialog: only its own research can be cancelled here. */
  cid: number;
  now: number;
}>();
const emit = defineEmits<{ cancel: [tid: number] }>();

const game = useGame();
const own = computed(() => props.technic?.cid === props.cid);
const timeLeft = computed(() =>
  props.technic ? timeLeftText(Math.max(0, props.technic.state_endtime - props.now), i18n) : '',
);

async function cancel() {
  const t = props.technic;
  if (!t) return;
  const answer = await showAlert(`${i18n('College_UpgradeTechItemSrc_2')}${t.tname}?`, '', [
    'yes',
    'no',
  ]);
  if (answer === 'yes') emit('cancel', t.tid);
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
    <template v-if="technic">
      <FxButton
        v-if="own"
        :x="152"
        :y="1"
        :w="46"
        :h="25"
        style-name="ButtonGreen"
        :fx="{ fontSize: 12 }"
        :label="i18n('College_UpgradeTechItem_1_1')"
        @click="game.accelerateTechnic(technic.state_endtime - now)"
      />
      <FxButton
        v-if="own"
        :x="152"
        :y="23"
        :w="45"
        :h="25"
        :fx="{ fontSize: 12 }"
        :label="i18n('College_UpgradeTechItem_2_1')"
        @click="cancel"
      />
      <FxLabel :x="10" :y="5" :w="73" :fx="{ color: 16777215 }" :text="technic.tname" />
      <FxLabel :x="48" :y="24" :w="102" :h="24" :fx="{ color: 16777215 }" :text="timeLeft" />
      <FxLabel
        :x="10"
        :y="24"
        :w="30"
        :fx="{ color: 9227384 }"
        :text="i18n('College_UpgradeTechItemSrc_1')"
      />
      <FxLabel
        :x="89"
        :y="5"
        :w="50"
        :fx="{ textAlign: 'left' }"
        :text="`${technic.level}${i18n('College_UpgradeTechItem_3_1')}`"
      />
    </template>
  </FxCanvas>
</template>
