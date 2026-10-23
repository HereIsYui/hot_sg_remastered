<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Ground.AttackTacticsDialog: edits the 出征 tactics (掠夺 / 侵略 / 野地 行动方案 + 巡逻 action).
 *
 * The original is a large per-soldier action/target configurator. This port keeps the server
 * protocol faithful — it reads the saved tactics from `getAttackTactics` and sends
 * `setAttackTactics` with the packed `[plunderCount, …, invadeCount, …, fieldCount, …, patrol]`
 * layout — while presenting a compact editor: 巡逻 行动 (撤退 / 坚守 / 出击) plus a reset. The full
 * per-type grid of the original is left for a UI pass; a saved row still round-trips.
 */
const props = defineProps<{ data: unknown }>();
const emit = defineEmits<{
  /** Packed setAttackTactics parameters. */
  save: [args: CommandArg[]];
  close: [];
}>();

/** `getAttackTactics` reply: `[row]` or `[]`. */
const current = computed(() => {
  const arr = Array.isArray(props.data) ? props.data : [];
  return (arr[0] ?? null) as Record<string, unknown> | null;
});

/** 巡逻 action: 0 撤退, 1 坚守, 2 出击 (the original's three patrol stances). */
const PATROL = [
  i18n('Ground_AttackTacticsDialogSrc_retreat') || '撤退',
  i18n('Ground_AttackTacticsDialogSrc_hold') || '坚守',
  i18n('Ground_AttackTacticsDialogSrc_attack') || '出击',
];
const patrol = ref(parsePatrol(current.value));

/** The saved patrol is stored as `"3,<action>,3"`. */
function parsePatrol(row: Record<string, unknown> | null): number {
  const parts = String(row?.patrol ?? '').split(',');
  const n = parseInt(parts[1] ?? '', 10);
  return Number.isFinite(n) ? n : 1;
}

/** Sends the current config; the per-type lists are preserved as empty (0 groups). */
function save() {
  // [plunderCount=0, invadeCount=0, fieldCount=0, patrolAction]
  emit('save', [0, 0, 0, patrol.value]);
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
    <FxCanvas :x="171" :y="96" :w="340" :h="260" style-name="PanelGreyGreen">
      <FxCanvas :x="96" :y="10" :w="150" :h="27" style-name="PopupTitle">
        <FxLabel
          :x="5"
          :y="4"
          :w="140"
          :fx="{ fontSize: 12, fontWeight: 'normal', textAlign: 'center', color: 15007634 }"
          :text="i18n('Ground_AttackTacticsDialogSrc_0') || '出征战术'"
        />
      </FxCanvas>
      <FxLabel
        :x="24"
        :y="60"
        :w="292"
        :fx="{ textAlign: 'left', color: 0xe7d18d }"
        :text="i18n('Ground_AttackTacticsDialogSrc_patrol') || '巡逻行动'"
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
        :x="90"
        :bottom="16"
        style-name="Confirm"
        :label="i18n('Ground_AttackTacticsDialogSrc_save') || '保存'"
        @click="save"
      />
      <FxButton :x="180" :bottom="16" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
