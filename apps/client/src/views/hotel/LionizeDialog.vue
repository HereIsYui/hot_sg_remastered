<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { serverTime } from '../../core/clock';
import { useGame } from '../../game/game';
import {
  ID_BUILDING_HOTEL,
  LIONIZE_STATE,
  lionizeAffairs,
  lionizeBravery,
  lionizeCommand,
  lionizeWisdom,
  parseLionizeData,
  type LionizeHero,
} from '../../game/hotelLionize';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * Hotel.LionizeDialog: the 结交名将 roster — every famous hero this lord has befriended (结交),
 * is pursuing (游说), owns (自己人) or holds captive (俘虏), joined to the hero's current master.
 * `param` round-trips the 客栈's building position so the reply is addressed back here.
 *
 * 查看 (`showFriendDetailDialog` → `PersuadeHero`) and 领取任务 (`showHeroPublicTaskDialog`) open
 * dialogs whose commands are a later stage and are not ported yet, so they show NotYetValid.
 */
const props = defineProps<{ param: number }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const now = ref(serverTime());
const heroes = shallowRef<LionizeHero[]>([]);
const selectedHid = ref(0);

function send(cmd: string, args: CommandArg[], ttype = 0) {
  game.sendDialogCommand(cmd, ID_BUILDING_HOTEL, props.param, args, ttype);
}

/** `LionizeDialog.getDate`: (re)loads the roster (reply ttype 13). */
function reload() {
  selectedHid.value = 0;
  send('getJiejiaoHero', [], 13);
}

const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === ID_BUILDING_HOTEL && p === props.param,
  onData(reply, ttype) {
    if (ttype !== 13 || !Array.isArray(reply)) return;
    heroes.value = parseLionizeData(reply).heroes;
  },
});

const t = (n: number) => i18n(`Hotel_JiejiaoHeroDialog_${n}_1`);

interface Row {
  hero: LionizeHero;
  name: string;
  npcname: string;
  npcstate: string;
  command: number;
  bravery: number;
  wisdom: number;
  affairs: number;
  friendstate: string;
  friend: number;
}

const rows = computed<Row[]>(() =>
  heroes.value.map((h) => ({
    hero: h,
    name: h.name,
    npcname: h.npcname,
    npcstate: h.npcstate,
    command: lionizeCommand(h, now.value),
    bravery: lionizeBravery(h, now.value),
    wisdom: lionizeWisdom(h, now.value),
    affairs: lionizeAffairs(h, now.value),
    friendstate: h.friendstate,
    friend: h.friend,
  })),
);

type Column = { header: string; field: keyof Row; width: number };
const columns: Column[] = [
  { header: i18n('Office_HeroExprDialog_2_1'), field: 'hero', width: 40 },
  { header: t(4), field: 'name', width: 80 },
  { header: t(5), field: 'npcname', width: 80 },
  { header: t(6), field: 'npcstate', width: 60 },
  { header: t(7), field: 'command', width: 40 },
  { header: t(8), field: 'bravery', width: 40 },
  { header: t(9), field: 'wisdom', width: 40 },
  { header: t(10), field: 'affairs', width: 40 },
  { header: t(11), field: 'friendstate', width: 60 },
  { header: t(12), field: 'friend', width: 80 },
  { header: i18n('Office_HeroExprDialog_13_1'), field: 'hero', width: 40 },
];

/** `selectItem`: the radio column keeps a single selection; 领取任务 needs a 游说ing hero. */
function onSelect(hero: LionizeHero) {
  selectedHid.value = selectedHid.value === hero.hid ? 0 : hero.hid;
}

const selected = computed(() => heroes.value.find((h) => h.hid === selectedHid.value) ?? null);
const canTask = computed(() => selected.value?.state === LIONIZE_STATE.PURSUING);

/** `onShowPublicTaskDialog`: the 名将任务 dialog is a later stage. */
function onTask() {
  if (!selected.value) {
    void showAlert(i18n('Hotel_LionizeDialogSrc_1_1'));
    return;
  }
  if (selected.value.state !== LIONIZE_STATE.PURSUING) {
    void showAlert(i18n('Hotel_LionizeDialogSrc_2_1'));
    return;
  }
  void showAlert(i18n('NotYetValid'));
}

/** `showDetailDialog`: the 名将详情 / 游说 dialog is a later stage. */
function onDetail() {
  void showAlert(i18n('NotYetValid'));
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  reload();
  timer = setInterval(() => (now.value = serverTime()), 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  unregister();
});
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="10" :y="49" :w="662" :h="433" style-name="PopupDialog">
      <FxCanvas :x="246.5" :y="10" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4.5"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="t(1)"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="42" :w="642" :h="308" style-name="BoardListDown">
        <FxDataGrid
          :x="0"
          :y="0"
          :w="642"
          :h="308"
          :row-height="28"
          :columns="columns"
          :rows="rows"
        >
          <template #cell="{ row, column, index }">
            <FxToggle
              v-if="column.header === i18n('Office_HeroExprDialog_2_1')"
              :key="`sel ${index}`"
              type="RadioButton"
              :selected="row.hero.hid === selectedHid"
              @change="onSelect(row.hero)"
            />
            <FxButton
              v-else-if="column.header === i18n('Office_HeroExprDialog_13_1')"
              :w="40"
              :h="25"
              style-name="ButtonRed"
              :label="t(3)"
              @click="onDetail()"
            />
            <template v-else>{{ row[column.field] }}</template>
          </template>
        </FxDataGrid>
      </FxCanvas>
      <FxButton
        :x="443"
        :bottom="18"
        :w="100"
        :h="36"
        style-name="ButtonGreen"
        :enabled="canTask"
        :label="t(2)"
        @click="onTask()"
      />
      <FxButton :x="582" :bottom="18" :w="65" :h="36" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
