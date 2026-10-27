<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import UnionApplicationsPanel from './UnionApplicationsPanel.vue';
import UnionAreaPanel from './UnionAreaPanel.vue';
import UnionCityPanel from './UnionCityPanel.vue';
import UnionDiplomacyPanel from './UnionDiplomacyPanel.vue';
import UnionMembersPanel from './UnionMembersPanel.vue';
import UnionOverviewPanel from './UnionOverviewPanel.vue';
import UnionReportsPanel from './UnionReportsPanel.vue';

/** Union/UnionDialog: founding, pending applications and the complete union tabs. */
const game = useGame();
const unionId = ref(0);
const unionPos = ref(0);
const unionName = ref('');
const pending = ref('');
const invitations = ref<Record<string, unknown>[]>([]);
const nameInput = ref('');
const applyName = ref('');
const tab = ref<
  'overview' | 'members' | 'applications' | 'diplomacy' | 'reports' | 'city' | 'area'
>('overview');
const isMember = computed(() => unionId.value > 0);
const tabs = [
  ['overview', '概览'],
  ['members', '成员'],
  ['applications', '申请邀请'],
  ['diplomacy', '外交'],
  ['reports', '军情'],
  ['city', '主城商城'],
  ['area', '势力'],
] as const;

function reload(): void {
  game.sendGlobalCommand('union_empty', 'getUnionApplyInvite');
}
const unregister = game.addGlobalReceiver('union_empty', (command, data) => {
  const d = (Array.isArray(data) ? data : []) as unknown[];
  if (command === 'getOtherUnionAreaByName') {
    game.sendGlobalCommand('union_empty', 'applyJoin', [Number(d[4] ?? 0)]);
    applyName.value = '';
    reload();
    return;
  }
  if (command !== 'getUnionApplyInvite') return;
  unionId.value = Number(d[0] ?? 0);
  unionPos.value = Number(d[1] ?? 0);
  unionName.value = String(d[2] ?? '');
  pending.value = unionId.value > 0 ? '' : String(d[2] ?? '');
  invitations.value = unionId.value > 0 ? [] : ((d[3] as Record<string, unknown>[]) ?? []);
});
function applyUnion(): void {
  const name = applyName.value.trim();
  if (name) game.sendGlobalCommand('union_empty', 'getOtherUnionAreaByName', [name]);
}
function onCreate(): void {
  const name = nameInput.value.trim();
  if (!name) return;
  game.sendGlobalCommand('union_empty', 'createUnion', [name]);
  nameInput.value = '';
  reload();
}
function onClose(): void {
  game.closeDialog();
}
reload();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="27" :y="32" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxCanvas :x="251" :y="10" :w="180" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="4"
        :w="180"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Union_UnionDialog_27_1')"
      />
    </FxCanvas>
    <template v-if="isMember">
      <FxLabel :x="25" :y="45" :w="630" :text="unionName" />
      <FxButton
        v-for="[key, label] in tabs"
        :key="key"
        :x="20 + tabs.findIndex((t) => t[0] === key) * 91"
        :y="68"
        :w="85"
        :h="28"
        :style-name="tab === key ? 'ButtonGreen' : 'ButtonYellow'"
        :label="label"
        @click="tab = key"
      />
      <UnionOverviewPanel
        v-if="tab === 'overview'"
        :key="tab"
        :union-pos="unionPos"
        @changed="reload"
      />
      <UnionMembersPanel v-else-if="tab === 'members'" :key="tab" />
      <UnionApplicationsPanel v-else-if="tab === 'applications'" :key="tab" />
      <UnionDiplomacyPanel v-else-if="tab === 'diplomacy'" :key="tab" />
      <UnionReportsPanel v-else-if="tab === 'reports'" :key="tab" />
      <UnionCityPanel v-else-if="tab === 'city'" :key="tab" :union-id="unionId" />
      <UnionAreaPanel v-else :key="tab" />
    </template>
    <template v-else>
      <FxCanvas :x="23" :y="83" :w="635" :h="180" style-name="BoardListDown">
        <FxLabel :x="14" :y="10" :w="120" text="创建联盟" />
        <FxTextInput v-model="nameInput" :x="140" :y="8" :w="200" :h="24" :max-chars="8" />
        <FxButton
          :x="360"
          :y="6"
          :w="74"
          :h="28"
          style-name="ButtonGreen"
          :label="i18n('Union_UnionDialog_27_1')"
          @click="onCreate"
        />
        <FxTextInput v-model="applyName" :x="140" :y="45" :w="200" :h="24" :max-chars="8" />
        <FxButton
          :x="360"
          :y="43"
          :w="90"
          style-name="ButtonGreen"
          label="申请加入"
          @click="applyUnion"
        />
        <FxLabel v-if="pending" :x="14" :y="80" :w="460" :text="`申请中：${pending}`" />
        <FxButton
          v-if="pending"
          :x="500"
          :y="50"
          :w="90"
          style-name="ButtonRed"
          label="取消申请"
          @click="
            game.sendGlobalCommand('union_empty', 'cancelApply');
            reload();
          "
        />
        <FxCanvas
          v-for="(invite, index) in invitations"
          :key="String(Number(invite.id))"
          :x="0"
          :y="80 + index * 34"
          :w="635"
          :h="32"
        >
          <FxLabel :x="14" :y="5" :w="330" :text="`${invite.name} 邀请你加入`" />
          <FxButton
            :x="400"
            :y="0"
            :w="90"
            style-name="ButtonGreen"
            label="接受邀请"
            @click="
              game.sendGlobalCommand('union_empty', 'acceptInvite', [Number(invite.id)]);
              reload();
            "
          />
          <FxButton
            :x="500"
            :y="0"
            :w="90"
            style-name="ButtonRed"
            label="拒绝邀请"
            @click="
              game.sendGlobalCommand('union_empty', 'rejectInvite', [Number(invite.id)]);
              reload();
            "
          />
        </FxCanvas>
      </FxCanvas>
    </template>
    <FxButton
      :x="594"
      :y="437"
      :w="65"
      :h="36"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="onClose"
    />
  </FxCanvas>
</template>
