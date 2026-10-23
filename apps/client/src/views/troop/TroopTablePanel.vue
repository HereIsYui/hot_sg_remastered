<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { serverTime } from '../../core/clock';
import { troopDisplay, type TroopDisplay, type TroopRow } from '../../game/troop';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';

/**
 * Troop/TroopArmyPanel · TroopEnemyPanel · TroopStayPanel · TroopUnionPanel share one layout: a
 * read-only grid of marching / stationed troops with a live countdown and a per-row action
 * button. The four AS3 panels differ only in which columns and which button they show, so the kind
 * is a prop. A finished countdown asks the parent to reload (the AS3's `getArmyTroops` on expiry).
 */
const props = defineProps<{
  troops: TroopRow[];
  /** Which tab this is: controls the action button label/behaviour. */
  kind: 'army' | 'enemy' | 'stay' | 'union';
}>();
const emit = defineEmits<{
  /** Row action: view detail (army/enemy/union) or the stay-panel gather/callback. */
  action: [troop: TroopRow];
  /** `callBackTroop` / `luoyangCallbackTroop` / `kickTroop` depending on the row + tab. */
  control: [troop: TroopRow];
  reload: [];
}>();

const now = ref(serverTime());
let waitSeconds = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const rows = computed<TroopDisplay[]>(() => props.troops.map((t) => troopDisplay(t, now.value)));

const t = (n: number) => i18n(`Troop_TroopArmyPanel_${n}_1`);
/** The columns per tab (header + the width the AS3 DataGridColumns use). */
const columns = computed(() => {
  const base = [
    { key: 'taskName', header: t(1) || '任务', width: 50 },
    { key: 'stateName', header: t(2) || '状态', width: 50 },
    { key: 'fromLabel', header: t(3) || '出发', width: 80 },
    { key: 'targetLabel', header: t(5) || '目标', width: 80 },
    { key: 'arriveLabel', header: t(7) || '到达时间', width: 120 },
    { key: 'timeLeft', header: t(8) || '剩余时间', width: 90 },
  ] as const;
  return base;
});

/** `TroopArmyPanel.onControlTroop`: fighting -> battle, moving/staying -> callback. */
function controlLabel(d: TroopDisplay): string {
  if (props.kind === 'enemy') return i18n('Troop_TroopEnemyPanelSrc_1') || '详情';
  if (d.state === 3) return i18n('Troop_TroopArmyPanelSrc_2') || '查看';
  if (props.kind === 'stay') return i18n('Troop_TroopStayPanelSrc_1') || '召回';
  return i18n('Troop_TroopArmyPanelSrc_1') || '召回';
}

function onControl(d: TroopDisplay): void {
  // enemy rows only open the detail; the others can be recalled / kicked
  if (props.kind === 'enemy') emit('action', d.troop);
  else emit('control', d.troop);
}

/** `*Panel.onTimer`: tick the countdown; reload when a troop's time runs out (debounced 5s). */
function onTimer(): void {
  now.value = serverTime();
  if (waitSeconds > 0) waitSeconds--;
  const expired = props.troops.some((tr) => tr.state < 2 && tr.endtime - now.value < 0);
  if (expired && waitSeconds <= 0) {
    waitSeconds = 5;
    emit('reload');
  }
}

onMounted(() => (timer = setInterval(onTimer, 1000)));
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="642" :h="332" style-name="BoardListUp">
    <!-- header -->
    <div class="row header">
      <div v-for="c in columns" :key="c.key" class="cell" :style="{ width: `${c.width}px` }">
        {{ c.header }}
      </div>
      <div class="cell" :style="{ width: '70px' }">{{ t(9) || '操作' }}</div>
    </div>
    <!-- rows -->
    <div class="body">
      <div v-for="d in rows" :key="d.id" class="row">
        <div
          v-for="c in columns"
          :key="c.key"
          class="cell"
          :style="{ width: `${c.width}px` }"
          @click="emit('action', d.troop)"
        >
          {{ d[c.key] }}
        </div>
        <div class="cell" :style="{ width: '70px' }">
          <FxButton
            :w="60"
            :h="24"
            style-name="ButtonGreen"
            :label="controlLabel(d)"
            @click="onControl(d)"
          />
        </div>
      </div>
      <div v-if="rows.length === 0" class="empty">
        {{ i18n('Troop_TroopArmyPanelSrc_4') || '暂无军队' }}
      </div>
    </div>
  </FxCanvas>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  height: 30px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 12px;
}

.header {
  color: #e7d18d;
  position: sticky;
  top: 0;
  background: rgba(0, 0, 0, 0.25);
}

.body {
  position: absolute;
  inset: 34px 3px 3px;
  overflow: hidden auto;
}

.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
  cursor: default;
}

.empty {
  text-align: center;
  color: #9aa;
  padding-top: 40px;
}
</style>
