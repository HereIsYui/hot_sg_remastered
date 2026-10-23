<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { i18n } from '../../i18n';
import GroundSoldierDialog from './GroundSoldierDialog.vue';

/** Ground.WoundedDialog: the city's 伤兵, 治疗 (gold) or 遣散 (back to people). */
defineProps<{ data: unknown }>();
const emit = defineEmits<{ send: [command: string, args: CommandArg[]]; close: [] }>();
</script>

<template>
  <GroundSoldierDialog
    :data="data"
    :title="i18n('Ground_WoundedDialogSrc_0') || '伤兵'"
    :primary-label="i18n('Ground_WoundedDialogSrc_cure') || '治疗'"
    primary-all="cureWoundedSoldier"
    primary-detail="cureWoundedSoldierDetail"
    :secondary-label="i18n('Ground_WoundedDialogSrc_dismiss') || '遣散'"
    secondary-all="dismissWoundedSoldier"
    secondary-detail="dismissWoundedSoldierDetail"
    :show-gold="true"
    @send="(c, a) => emit('send', c, a)"
    @close="emit('close')"
  />
</template>
