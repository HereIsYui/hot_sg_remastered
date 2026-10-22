<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Hero.HeroBufferDialog: the chosen hero's active 宝物 buffs. Each row shows the buff name, the
 * live remaining time (counted down every second), and a 续买 button that opens the item picker
 * to renew it — the three 内政/勇武/智谋 attribute buffs (gid 26/27/28/29) map to their item use
 * types, every other buff reuses its own gid. Opened by the 宝物 button of HeroDetailDialog.
 */
const props = defineProps<{ hid: number; cid: number }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;

interface BuffRow {
  hid: number;
  gid: number;
  name: string;
  endtime: number;
  /** The live countdown label (`timeleftSrc`). */
  timeleftSrc: string;
  /** Placeholder cell for the action column; the 续买 button is rendered by the slot. */
  action: string;
}

const list = ref<BuffRow[]>([]);
/** A reactive clock the countdown column derives from; ticked once a second. */
const now = ref(serverTime());

const rows = computed<BuffRow[]>(() =>
  list.value.map((r) => ({ ...r, timeleftSrc: timeLeftText(r.endtime - now.value, i18n) })),
);

const columns = [
  { header: i18n('Hero_HeroBufferDialog_2_1'), field: 'name' as const, width: 110 },
  { header: i18n('Hero_HeroBufferDialog_3_1'), field: 'timeleftSrc' as const, width: 120 },
  { header: i18n('Buffer_GoodsBufferDialog_4_1'), field: 'action' as const, width: 70 },
];

/** `getHeroBuffer` reply: `[{hid, gid, name, endtime}, ...]`. */
const unregister = game.addGlobalReceiver('hero', (command, data) => {
  if (command !== 'getHeroBuffer') return;
  const arr = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  list.value = arr.map((r) => ({
    hid: int(r.hid),
    gid: int(r.gid),
    name: String(r.name ?? ''),
    endtime: int(r.endtime),
    timeleftSrc: '',
    action: '',
  }));
});

function reload() {
  game.sendGlobalCommand('hero', 'getHeroBuffer', [props.cid, props.hid]);
}

// `HeroBufferDialog.onTimer`: tick the countdown once a second; reload a buff when it expires.
let timer = 0;
onMounted(() => {
  reload();
  timer = window.setInterval(() => {
    now.value = serverTime();
    if (list.value.some((r) => r.endtime - now.value <= 0)) reload();
  }, 1000);
});
onUnmounted(() => {
  window.clearInterval(timer);
  unregister();
});
watch(() => props.hid, reload);

/**
 * `HeroBufferDialog.inlineComponent1.onDelay`: the 续买 button. The 内政/勇武/智谋 buffs renew
 * through their attribute item types (43/44/45/46); the two 赞誉 buffs (19082/19083) cannot be
 * repeated; everything else reuses its own gid, carrying the hero.
 */
const RENEW_TYPE: Record<number, number> = { 26: 43, 27: 44, 28: 45, 29: 46 };
function onRenew(row: BuffRow) {
  if (row.gid === 19082 || row.gid === 19083) {
    void showAlert(i18n('Hero_PraiseDialog_Praise_CanNotRepeat'));
    return;
  }
  const type = RENEW_TYPE[row.gid];
  if (type !== undefined) game.showUseGoodsDialog(0, type, []);
  else game.showUseGoodsDialog(0, row.gid, [row.hid]);
}
</script>

<template>
  <FxCanvas :x="(736 - 350) / 2" :y="(556 - 352) / 2" :w="350" :h="352" style-name="PopupDialog">
    <FxCanvas :x="(350 - 114) / 2" :y="14" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="114"
        style-name="PopupDialogTitle"
        :text="i18n('Hero_HeroBufferDialog_1_1')"
      />
    </FxCanvas>
    <FxButton :right="8" :y="6" style-name="Close" @click="emit('close')" />

    <FxCanvas :x="20" :y="46" :w="310" :h="258" style-name="BoardListDown">
      <FxDataGrid :x="3" :y="3" :w="304" :h="252" :row-height="30" :columns="columns" :rows="rows">
        <template #cell="{ row, column }">
          <FxButton
            v-if="column.field === 'action'"
            :w="60"
            :h="24"
            style-name="ButtonGreen"
            :label="i18n('Buffer_GoodsBufferDialog_5_1')"
            @click="onRenew(row)"
          />
          <span v-else>{{ row[column.field] }}</span>
        </template>
      </FxDataGrid>
    </FxCanvas>
  </FxCanvas>
</template>
