<script setup lang="ts">
import type { CommandArg } from '@hot/shared';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import {
  parseTrickList,
  parseUseTrickReply,
  trickCommandArgs,
  trickTarget,
  TRICK_GRID_COLUMNS,
  type TrickItemRow,
  type TrickTarget,
} from '../../game/trick';
import SelectHeroDialog from './SelectHeroDialog.vue';
import TrickItem from './TrickItem.vue';

/**
 * Trick/TrickDialog (682x492): the 使用计谋 dialog. `onInit` fixes the target line by tricktype —
 * 0 本城 (官府 计谋 / WorldActionDialog own city), 1 敌城 (WorldActionDialog), 2 出征中的军队 and
 * 3 来袭的军队 (TroopDetailDialog 计谋) — then `getTrickList` fills the 7-wide cell grid. Using a
 * trick sends `trick/useTrick [hid, trickid, tricktype, target]` (the 洛阳 troop dispatches
 * useLuoyangTrick); a 锦囊 shortage opens the buy-and-use popup through the global
 * not_enough_goods path, and the buy reply re-sends the stored arguments (gid 13 branch of
 * BloodWar.useTheGoodsJustBuy).
 */
const props = defineProps<{ trickType: number; params: (number | string)[] }>();

const game = useGame();
const city = useCityStore();

const target = ref<TrickTarget>(
  trickTarget(props.trickType, props.params, {
    cid: city.cid,
    name: city.name,
    position: city.position,
  }),
);
const items = ref<TrickItemRow[]>([]);
const bagCount = ref(0);
/** The hero picker over the grid (SelectHeroDialog.setTrick + visible). */
const select = ref<TrickItemRow | null>(null);

/** `TrickDialog.onInit`: the getTrickList request goes out as the dialog opens. */
onMounted(() => {
  game.sendGlobalCommand('trick', 'getTrickList');
});

/** `TrickDialog.onCommand`. */
const unregister = game.addGlobalReceiver('trick', (command, data) => {
  if (command === 'getTrickList') {
    const parsed = parseTrickList(data, props.trickType);
    items.value = parsed.items;
    bagCount.value = parsed.bagCount;
  } else if (command === 'useTrick' || command === 'useLuoyangTrick') {
    const reply = parseUseTrickReply(data);
    bagCount.value = reply.bagCount;
    void showAlert(reply.message);
  }
});

/**
 * `TrickDialog.useTrick`: `[hid, trickid, tricktype, target]`; the 洛阳 target (215265) sends
 * useLuoyangTrick (not ported server-side — stage 8 —, kept faithful). The arguments are kept so
 * the 锦囊 buy-and-use reply can retry.
 */
let lastUseArgs: CommandArg[] | null = null;

function useTrick(hid: number, trickid: number): void {
  const args = trickCommandArgs(target.value, hid, trickid);
  lastUseArgs = args;
  if (target.value.troopTargetCid === 215265) {
    game.sendGlobalCommand('trick', 'useLuoyangTrick', args);
  } else {
    game.sendGlobalCommand('trick', 'useTrick', args);
  }
  select.value = null;
}

/** `BloodWar.useTheGoodsJustBuy` gid 13: the bought 锦囊 re-runs the pending trick. */
const unregisterBuy = game.addGlobalReceiver('buybeforeuse', (command, data) => {
  if (command !== 'buyGoodsBeforeUse') return;
  const gid = parseInt(String((data as unknown[])?.[0]), 10) || 0;
  if (gid === 13 && lastUseArgs) game.sendGlobalCommand('trick', 'useTrick', lastUseArgs);
});

onUnmounted(() => {
  unregister();
  unregisterBuy();
});

/** `TrickDialog.onClickTrick`: an invalid trick shows its manual, type 2 skips the hero picker. */
function onClickTrick(item: TrickItemRow): void {
  if (item.invalid) {
    void showAlert(item.manual);
  } else if (props.trickType === 2) {
    useTrick(target.value.troopHid, item.id);
  } else {
    select.value = item;
  }
}

const cells = computed(() =>
  items.value.map((item, index) => ({
    item,
    column: index % TRICK_GRID_COLUMNS,
    x: 10 + (index % TRICK_GRID_COLUMNS) * 86,
    y: 10 + Math.floor(index / TRICK_GRID_COLUMNS) * 98,
    key: item.id,
  })),
);
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="10" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="14"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Trick_TrickDialog_2_1')"
    />
    <FxCanvas :x="31" :y="61" :w="65" :h="26" style-name="BoardListUp">
      <FxLabel :x="4" :y="3" :w="58" style-name="ItemTitle" :text="i18n('Trick_TrickDialog_3_1')" />
    </FxCanvas>
    <FxCanvas :x="104" :y="61" :w="84" :h="26" style-name="BoardListDown">
      <FxLabel :x="6" :y="3" :w="72" style-name="ItemValue" :text="String(bagCount)" />
    </FxCanvas>
    <FxCanvas :x="262" :y="61" :w="65" :h="26" style-name="BoardListUp">
      <FxLabel :x="4" :y="3" :w="58" style-name="ItemTitle" :text="i18n('Trick_TrickDialog_4_1')" />
    </FxCanvas>
    <FxCanvas :x="335" :y="61" :w="213" :h="26" style-name="BoardListDown">
      <FxLabel :x="4" :y="3" :w="207" style-name="ItemValue" :text="target.label" />
    </FxCanvas>
    <FxCanvas :x="31" :y="95" :w="620" :h="330" style-name="BoardListUp" scroll-y>
      <div class="grid">
        <div
          v-for="cell in cells"
          :key="cell.key"
          class="slot"
          :style="{ left: `${cell.x}px`, top: `${cell.y}px` }"
        >
          <TrickItem :item="cell.item" :column="cell.column" @click="onClickTrick" />
        </div>
      </div>
    </FxCanvas>
    <FxButton
      :x="597"
      :bottom="10"
      :fx="{ fontSize: 16 }"
      style-name="ButtonRed"
      :label="i18n('Trick_TrickDialog_1_1')"
      @click="game.closeDialog()"
    />
    <SelectHeroDialog
      v-if="select"
      :trick="select"
      @use="(hid) => useTrick(hid, select!.id)"
      @close="select = null"
    />
  </FxCanvas>
</template>

<style scoped>
.grid {
  position: relative;
  min-height: 330px;
}

.slot {
  position: absolute;
}
</style>
