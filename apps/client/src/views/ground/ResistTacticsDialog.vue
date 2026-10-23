<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Ground.ResistTacticsDialog: edits the 防守 tactics (反掠夺 / 反侵略 / 城防 + 反巡逻).
 *
 * Like AttackTacticsDialog, this keeps the `setResistTactics` protocol faithful — the packed
 * `[deplunderCount, …, deinvadeCount, …, defenceCount, …, patrolJoin, patrolAction]` layout — and
 * presents a compact editor over it (反巡逻 join + action). The original's full per-type join /
 * action / target grid is left for a later UI pass; a saved row still round-trips.
 */
const props = defineProps<{ data: unknown }>();
const emit = defineEmits<{ save: [args: CommandArg[]]; close: [] }>();

const current = computed(() => {
  const arr = Array.isArray(props.data) ? props.data : [];
  return (arr[0] ?? null) as Record<string, unknown> | null;
});

const PATROL = [
  i18n('Ground_ResistTacticsDialogSrc_retreat') || '撤退',
  i18n('Ground_ResistTacticsDialogSrc_hold') || '坚守',
  i18n('Ground_ResistTacticsDialogSrc_attack') || '出击',
];
const patrol = ref(parsePatrol(current.value));
const patrolJoin = ref(String(current.value?.depatrol_join ?? '') !== '');

function parsePatrol(row: Record<string, unknown> | null): number {
  const parts = String(row?.depatrol ?? '').split(',');
  const n = parseInt(parts[1] ?? '', 10);
  return Number.isFinite(n) ? n : 1;
}

function save() {
  // [deplunderCount=0, deinvadeCount=0, defenceCount=0, patrolJoin, patrolAction]
  emit('save', [0, 0, 0, patrolJoin.value ? 1 : 0, patrol.value]);
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
    <FxCanvas :x="171" :y="96" :w="340" :h="280" style-name="PanelGreyGreen">
      <FxCanvas :x="96" :y="10" :w="150" :h="27" style-name="PopupTitle">
        <FxLabel
          :x="5"
          :y="4"
          :w="140"
          :fx="{ fontSize: 12, fontWeight: 'normal', textAlign: 'center', color: 15007634 }"
          :text="i18n('Ground_ResistTacticsDialogSrc_0') || '防守战术'"
        />
      </FxCanvas>
      <FxLabel
        :x="24"
        :y="60"
        :w="292"
        :fx="{ textAlign: 'left', color: 0xe7d18d }"
        :text="i18n('Ground_ResistTacticsDialogSrc_patrol') || '反巡逻行动'"
      />
      <FxButton
        v-for="(label, i) in PATROL"
        :key="i"
        :x="24 + i * 100"
        :y="90"
        :w="90"
        :style-name="patrol === i ? 'ButtonGreen' : 'ButtonGrey'"
        :label="label"
        @click="patrol = i"
      />
      <FxButton
        :x="24"
        :y="130"
        :w="190"
        :style-name="patrolJoin ? 'ButtonGreen' : 'ButtonGrey'"
        :label="`${i18n('Ground_ResistTacticsDialogSrc_join') || '参与巡逻'}：${patrolJoin ? i18n('Basic_yes') || '是' : i18n('Basic_no') || '否'}`"
        @click="patrolJoin = !patrolJoin"
      />
      <FxButton
        :x="90"
        :bottom="16"
        style-name="Confirm"
        :label="i18n('Ground_ResistTacticsDialogSrc_save') || '保存'"
        @click="save"
      />
      <FxButton :x="180" :bottom="16" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
