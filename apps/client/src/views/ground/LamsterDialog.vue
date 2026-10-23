<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { i18n } from '../../i18n';
import GroundSoldierDialog from './GroundSoldierDialog.vue';

/** Ground.LamsterDialog: the city's 逃兵, 劝说 (gold) back into the army or 遣散 to people. */
defineProps<{ data: unknown }>();
const emit = defineEmits<{ send: [command: string, args: CommandArg[]]; close: [] }>();
</script>

<template>
  <GroundSoldierDialog
    :data="data"
    :title="i18n('Ground_LamsterDialogSrc_0') || '逃兵'"
    :primary-label="i18n('Ground_LamsterDialogSrc_say') || '劝说'"
    primary-all="sayToLamster"
    primary-detail="sayToLamsterDetail"
    :secondary-label="i18n('Ground_LamsterDialogSrc_dismiss') || '遣散'"
    secondary-all="dismissLamster"
    secondary-detail="dismissLamsterDetail"
    :show-gold="true"
    @send="(c, a) => emit('send', c, a)"
    @close="emit('close')"
  />
</template>
