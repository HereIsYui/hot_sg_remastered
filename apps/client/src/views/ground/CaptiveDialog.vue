<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { i18n } from '../../i18n';
import GroundSoldierDialog from './GroundSoldierDialog.vue';

/** Ground.CaptiveDialog: the city's 俘虏, 招降 (gold) or 释放. */
defineProps<{ data: unknown }>();
const emit = defineEmits<{ send: [command: string, args: CommandArg[]]; close: [] }>();
</script>

<template>
  <GroundSoldierDialog
    :data="data"
    :title="i18n('Ground_CaptiveDialogSrc_0') || '俘虏'"
    :primary-label="i18n('Ground_CaptiveDialogSrc_accept') || '招降'"
    primary-all="acceptCaptiveSoldier"
    primary-detail="acceptCaptiveSoldierDetail"
    :secondary-label="i18n('Ground_CaptiveDialogSrc_dismiss') || '释放'"
    secondary-all="dismissCaptiveSoldier"
    secondary-detail="dismissCaptiveSoldierDetail"
    :show-gold="true"
    @send="(c, a) => emit('send', c, a)"
    @close="emit('close')"
  />
</template>
