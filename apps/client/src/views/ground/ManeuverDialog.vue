<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import {
  formatManeuverResult,
  normalizeManeuverCount,
  parseManeuverLosses,
  serializeManeuverSoldiers,
  type ManeuverSoldier,
} from '../../game/maneuver';
import { i18n } from '../../i18n';
import { useGlobalStore } from '../../stores/global';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const emit = defineEmits<{
  send: [command: string, args: CommandArg[], ttype: number];
  close: [];
}>();

const global = useGlobalStore();
const makeRows = (): ManeuverSoldier[] =>
  global.soldiers.map((s) => ({
    sid: Number(s.sid) || 0,
    name: String(s.name ?? ''),
    count: 0,
    diecount: 0,
  }));
const attack = reactive<ManeuverSoldier[]>(makeRows());
const resist = reactive<ManeuverSoldier[]>(makeRows());
const waiting = ref(false);
const resultText = ref('');
let maneuverId = 0;
let checks = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const attackColumns = [
  { header: i18n('Ground_ManeuverDialog_2_1') || '进攻方', field: 'name' as const, width: 100 },
  { header: i18n('Ground_ManeuverDialog_3_1') || '出战人数', field: 'count' as const, width: 105 },
  {
    header: i18n('Ground_ManeuverDialog_4_1') || '战斗损失',
    field: 'diecount' as const,
    width: 107,
  },
];
const resistColumns = [
  { header: i18n('Ground_ManeuverDialog_5_1') || '防守方', field: 'name' as const, width: 100 },
  { header: i18n('Ground_ManeuverDialog_6_1') || '出战人数', field: 'count' as const, width: 105 },
  {
    header: i18n('Ground_ManeuverDialog_7_1') || '战斗损失',
    field: 'diecount' as const,
    width: 107,
  },
];

function start(): void {
  if (waiting.value) return;
  resultText.value = '';
  emit(
    'send',
    'startManeuver',
    [serializeManeuverSoldiers(attack), serializeManeuverSoldiers(resist)],
    1,
  );
}

function onReply(data: unknown[], ttype: number): void {
  if (ttype === 1) {
    maneuverId = Number(data[0]) || 0;
    checks = 5;
    waiting.value = true;
    return;
  }
  if (ttype !== 2 || Number(data[0]) !== 1) return;
  waiting.value = false;
  const row = (data[1] ?? {}) as Record<string, unknown>;
  const attackLosses = parseManeuverLosses(row.attackdie);
  const resistLosses = parseManeuverLosses(row.resistdie);
  for (const s of attack) s.diecount = attackLosses.get(s.sid) ?? 0;
  for (const s of resist) s.diecount = resistLosses.get(s.sid) ?? 0;
  resultText.value = formatManeuverResult(row);
}

defineExpose({ onReply });

onMounted(() => {
  timer = setInterval(() => {
    if (!waiting.value) return;
    if (checks <= 0) {
      waiting.value = false;
      showAlert(i18n('Ground_ManeuverDialogSrc_1') || '系统繁忙，无法完成演习。');
      return;
    }
    checks--;
    emit('send', 'getManeuverResult', [maneuverId], 2);
  }, 1000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxButton :x="612" :bottom="10" style-name="Close" @click="emit('close')" />
    <FxButton :x="544" :bottom="10" style-name="Return" @click="emit('close')" />
    <FxButton :x="476" :bottom="10" style-name="Confirm" @click="start" />
    <FxCanvas :x="241" :y="11" :w="200" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="24"
        :y="3"
        :w="151"
        :h="18"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Ground_ManeuverDialog_1_1') || '演习'"
      />
    </FxCanvas>

    <FxCanvas :x="15" :y="47" :w="324" :h="388" style-name="BoardListUp">
      <FxDataGrid
        :x="2"
        :y="2"
        :w="320"
        :h="385"
        :columns="attackColumns"
        :rows="attack"
        :row-height="30"
        :header-height="24"
      >
        <template #cell="{ row, column }">
          <FxTextInput
            v-if="column.field === 'count'"
            :x="0"
            :y="1"
            :w="103"
            :h="23"
            :max-chars="6"
            style-name="EmptyTextInput"
            :fx="{ textAlign: 'center' }"
            :model-value="String(row.count)"
            @update:model-value="row.count = normalizeManeuverCount($event)"
          />
          <span v-else>{{ row[column.field] }}</span>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxCanvas :x="343" :y="47" :w="324" :h="388" style-name="BoardListUp">
      <FxDataGrid
        :x="2"
        :y="2"
        :w="320"
        :h="384"
        :columns="resistColumns"
        :rows="resist"
        :row-height="30"
        :header-height="24"
      >
        <template #cell="{ row, column }">
          <FxTextInput
            v-if="column.field === 'count'"
            :x="0"
            :y="1"
            :w="103"
            :h="23"
            :max-chars="6"
            style-name="EmptyTextInput"
            :fx="{ textAlign: 'center' }"
            :model-value="String(row.count)"
            @update:model-value="row.count = normalizeManeuverCount($event)"
          />
          <span v-else>{{ row[column.field] }}</span>
        </template>
      </FxDataGrid>
    </FxCanvas>

    <FxCanvas :x="85" :y="444" :w="338" :h="32" style-name="BoardListDown">
      <FxLabel :x="3" :y="6" :w="324" :h="20" :text="resultText" />
    </FxCanvas>
    <FxLabel
      :x="20"
      :y="450"
      style-name="ItemTitle"
      :text="i18n('Ground_ManeuverDialog_9_1') || '演习结果'"
    />

    <FxCanvas
      v-if="waiting"
      :x="0"
      :y="0"
      :w="682"
      :h="492"
      :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }"
    >
      <FxCanvas
        :x="241"
        :y="249"
        :w="200"
        :h="20"
        :fx="{ backgroundColor: 16777215, backgroundAlpha: 1 }"
      >
        <FxLabel
          :x="0"
          :y="1"
          :w="200"
          :fx="{ color: 734012, textAlign: 'center' }"
          :text="i18n('Ground_ManeuverDialog_8_1') || '等待演习结果'"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
