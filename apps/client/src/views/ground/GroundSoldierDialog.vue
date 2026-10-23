<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, ref } from 'vue';
import { parseGroundSoldiers, type GroundSoldier } from '../../game/ground';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Ground.WoundedDialog / CaptiveDialog / LamsterDialog share this shape: a soldier list, the gold
 * the primary action (治疗 / 招降 / 劝说) costs, and a secondary action (遣散 / 释放). Each row may
 * also act on one type via the `*Detail` commands. `data` is the matching `get*` reply.
 */
const props = defineProps<{
  data: unknown;
  title: string;
  /** Primary-action label (治疗 / 招降 / 劝说) and its all / detail commands. */
  primaryLabel: string;
  primaryAll: string;
  primaryDetail: string;
  /** Secondary-action label (遣散 / 释放) and its all / detail commands. */
  secondaryLabel: string;
  secondaryAll: string;
  secondaryDetail: string;
  /** Whether the primary action costs gold (shown next to its button). */
  showGold: boolean;
}>();
const emit = defineEmits<{
  /** `[command, [sid, count]?]`: a `get*` command carries no args, the detail ones carry two. */
  send: [command: string, args: CommandArg[]];
  close: [];
}>();

const list = computed(() => parseGroundSoldiers(props.data));
const selected = ref<GroundSoldier | null>(null);
const selectedIndex = ref(-1);
const count = ref(1);
const countText = ref('1');

const columns = [
  { header: i18n('Ground_WoundedDialogSrc_1') || '兵种', field: 'name' as const, width: 160 },
  { header: i18n('Ground_WoundedDialogSrc_2') || '数量', field: 'count' as const, width: 120 },
];

function select(row: GroundSoldier, index: number) {
  selected.value = row;
  selectedIndex.value = index;
  setCount(row.count);
}

function setCount(n: number) {
  count.value = Math.max(0, n);
  countText.value = String(count.value);
}

function onPrimaryDetail() {
  if (!selected.value) return;
  emit('send', props.primaryDetail, [selected.value.sid, count.value]);
}

function onSecondaryDetail() {
  if (!selected.value) return;
  emit('send', props.secondaryDetail, [selected.value.sid, count.value]);
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
    <FxCanvas :x="131" :y="56" :w="420" :h="340" style-name="PanelGreyGreen">
      <FxCanvas :x="136" :y="10" :w="150" :h="27" style-name="PopupTitle">
        <FxLabel
          :x="5"
          :y="4"
          :w="140"
          :fx="{ fontSize: 12, fontWeight: 'normal', textAlign: 'center', color: 15007634 }"
          :text="title"
        />
      </FxCanvas>
      <FxCanvas :x="20" :y="44" :w="380" :h="170" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="374"
          :h="164"
          :columns="columns"
          :rows="list.soldiers"
          selectable
          :selected-index="selectedIndex"
          @item-click="select"
        />
      </FxCanvas>
      <FxLabel
        v-if="showGold"
        :x="20"
        :y="222"
        :w="380"
        :fx="{ textAlign: 'left', color: 0xe7d18d }"
        :text="`${i18n('Ground_WoundedDialogSrc_3') || '所需黄金'}：${list.goldNeed}`"
      />
      <!-- selected-type count + per-type actions -->
      <FxLabel :x="20" :y="250" :text="i18n('Ground_WoundedDialogSrc_4') || '选中兵种'" />
      <FxCanvas :x="90" :y="246" :w="90" :h="26" style-name="BoardListDown">
        <FxTextInput
          :x="3"
          :y="4"
          :w="83"
          :h="18"
          :max-chars="7"
          :fx="{ backgroundAlpha: 0, borderStyle: 'none', textAlign: 'right', color: 16777215 }"
          :model-value="countText"
          @update:model-value="setCount(parseInt($event, 10) || 0)"
        />
      </FxCanvas>
      <FxButton
        :x="190"
        :y="247"
        :w="28"
        :h="18"
        style-name="MaxValue"
        @click="setCount(selected?.count ?? 0)"
      />
      <FxButton
        :x="224"
        :y="247"
        :w="60"
        :h="22"
        style-name="ButtonGreen"
        :label="primaryLabel"
        @click="onPrimaryDetail"
      />
      <FxButton
        :x="290"
        :y="247"
        :w="60"
        :h="22"
        style-name="ButtonGrey"
        :label="secondaryLabel"
        @click="onSecondaryDetail"
      />
      <!-- act-on-all + close -->
      <FxButton
        :x="60"
        :bottom="14"
        :w="90"
        style-name="ButtonYellow"
        :label="`${primaryLabel}${i18n('Ground_WoundedDialogSrc_5') || '全部'}`"
        @click="emit('send', primaryAll, [])"
      />
      <FxButton
        :x="160"
        :bottom="14"
        :w="90"
        style-name="ButtonYellow"
        :label="`${secondaryLabel}${i18n('Ground_WoundedDialogSrc_5') || '全部'}`"
        @click="emit('send', secondaryAll, [])"
      />
      <FxButton :x="280" :bottom="14" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
