<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { parseTroopDetail, type TroopDetail, type TroopRow } from '../../game/troop';
import { cid2wid, makeCid } from '../../game/world';
import { i18n } from '../../i18n';
import { useGlobalStore } from '../../stores/global';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Troop/TroopDetailDialog: the 军队详情 pop-up opened from a troop row. It loads `getTroopDetail`
 * for the troop and shows its owner, hero, soldiers, carried resources and techs. The buttons are
 * driven by the troop's state and the panel it came from (self / enemy / union), mirroring the
 * AS3 `showArmyDetail` / `showEnemyDetail` / `showUnionArmyDetail` branches: 召回 (callBackTroop),
 * 踢回 (kickTroop), 集结 (gatherFieldStart), 结束集结 (gatherFieldEnd) and 写信.
 */
const props = defineProps<{ troop: TroopRow; armyType: 'self' | 'enemy' | 'union' }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const user = useUserStore();
const global = useGlobalStore();

const detail = ref<TroopDetail | null>(null);
const state = computed(() => props.troop.state);

/** Which buttons show, per the AS3 showArmyDetail / showEnemyDetail / showUnionArmyDetail. */
const recallVisible = computed(
  () => props.armyType === 'self' && state.value !== 1 && state.value !== 3,
);
const kickVisible = computed(() => props.armyType === 'union');
const mailVisible = computed(() => props.armyType === 'enemy' || props.armyType === 'union');
const gatherStartVisible = computed(() => props.armyType === 'self' && state.value === 4);
const gatherEndVisible = computed(() => props.armyType === 'self' && state.value === 5);

const title = computed(() => i18n('Troop_TroopDetailDialog_1_1') || '军队详情');
const soldierColumns = [
  { header: i18n('Troop_TroopDetailDialog_6_1') || '兵种', field: 'soldier' as const, width: 160 },
  { header: i18n('Troop_TroopDetailDialog_7_1') || '数量', field: 'count' as const, width: 160 },
];
const resourceColumns = [
  { header: i18n('Troop_TroopDetailDialog_8_1') || '资源', field: 'resource' as const, width: 160 },
  { header: i18n('Troop_TroopDetailDialog_9_1') || '数量', field: 'count' as const, width: 160 },
];
const technicColumns = [
  { header: i18n('Troop_TroopDetailDialog_10_1') || '科技', field: 'name' as const, width: 160 },
  { header: i18n('Troop_TroopDetailDialog_11_1') || '等级', field: 'level' as const, width: 160 },
];

const countDesc = computed(() =>
  global.countDesc.map((r) => ({ count: Number(r.count) || 0, desc: String(r.desc ?? '') })),
);

const unregister = game.addGlobalReceiver('troop', (command, data) => {
  if (command === 'getTroopDetail') {
    detail.value = parseTroopDetail(data, global.soldierNames, global.technicNames, {
      showEnemy: props.armyType === 'enemy',
      countDesc: countDesc.value,
    });
  }
});

/** `TroopDetailDialog.onRecall`: 洛阳 troops use the luoyang callback. */
function onRecall(): void {
  if (props.troop.userid !== user.uid) return;
  const cmd = props.troop.targetcid === 215265 ? 'luoyangCallbackTroop' : 'callBackTroop';
  game.sendGlobalCommand('troop', cmd, [props.troop.id]);
  emit('close');
}

function onKick(): void {
  game.sendGlobalCommand('troop', 'kickTroop', [props.troop.id]);
  emit('close');
}

function onGatherStart(): void {
  game.sendGlobalCommand('troop', 'gatherFieldStart', [cid2wid(props.troop.targetcid)]);
  emit('close');
}

async function onGatherEnd(): Promise<void> {
  if (
    (await showAlert(i18n('Troop_TroopDetailDialogSrc_11') || '确定结束集结？', '', [
      'yes',
      'no',
    ])) === 'yes'
  ) {
    game.sendGlobalCommand('troop', 'gatherFieldEnd', [cid2wid(props.troop.targetcid)]);
    emit('close');
  }
}

/** `onMail`: compose to the troop owner. */
function onMail(): void {
  if (detail.value?.owner) game.showMailWrite(null, detail.value.owner);
}

onMounted(() =>
  game.sendGlobalCommand('troop', 'getTroopDetail', [props.troop.id, props.troop.hid]),
);
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="159" :y="20" :w="364" :h="448" style-name="PopupDialog" :fx="{ fontSize: 12 }">
      <FxCanvas :x="97" :y="15" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4"
          :y="3"
          :w="160"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="title"
        />
      </FxCanvas>

      <!-- owner / union / hero -->
      <div class="info">
        <FxLabel
          :x="15"
          :y="60"
          :w="45"
          :fx="{ color: 0xffffff }"
          :text="i18n('Troop_TroopDetailDialog_2_1') || '君主'"
        />
        <FxLabel :x="68" :y="60" :w="110" :fx="{ color: 0xffffff }" :text="detail?.owner || '--'" />
        <FxLabel
          :x="186"
          :y="60"
          :w="45"
          :fx="{ color: 0xffffff }"
          :text="i18n('Troop_TroopDetailDialog_3_1') || '联盟'"
        />
        <FxLabel
          :x="239"
          :y="60"
          :w="110"
          :fx="{ color: 0xffffff }"
          :text="detail?.union || '--'"
        />
        <FxLabel
          :x="15"
          :y="93"
          :w="45"
          :fx="{ color: 0xffffff }"
          :text="i18n('Troop_TroopDetailDialog_4_1') || '将领'"
        />
        <FxLabel
          :x="68"
          :y="93"
          :w="110"
          :fx="{ color: 0xffffff }"
          :text="detail?.heroName || '--'"
        />
        <FxLabel
          :x="186"
          :y="93"
          :w="45"
          :fx="{ color: 0xffffff }"
          :text="i18n('Troop_TroopDetailDialog_5_1') || '等级'"
        />
        <FxLabel
          :x="239"
          :y="93"
          :w="110"
          :fx="{ color: 0xffffff }"
          :text="detail?.heroLevel || '--'"
        />
      </div>

      <!-- soldiers -->
      <FxCanvas :x="15" :y="124" :w="334" :h="129" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="328"
          :h="123"
          :columns="soldierColumns"
          :rows="detail?.soldiers ?? []"
        />
      </FxCanvas>

      <!-- resource (self/union) or technic (enemy) -->
      <FxCanvas :x="15" :y="261" :w="334" :h="129" style-name="BoardListDown">
        <FxDataGrid
          v-if="armyType === 'enemy'"
          :x="3"
          :y="3"
          :w="328"
          :h="123"
          :columns="technicColumns"
          :rows="detail?.technic ?? []"
        />
        <FxDataGrid
          v-else
          :x="3"
          :y="3"
          :w="328"
          :h="123"
          :columns="resourceColumns"
          :rows="detail?.resource ?? []"
        />
      </FxCanvas>

      <!-- actions -->
      <FxButton
        v-if="recallVisible"
        :x="15"
        :y="398"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Troop_TroopDetailDialog_12_1') || '召回'"
        @click="onRecall"
      />
      <FxButton
        v-if="kickVisible"
        :x="90"
        :y="398"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Troop_TroopDetailDialog_13_1') || '踢回'"
        @click="onKick"
      />
      <FxButton
        v-if="gatherStartVisible"
        :x="90"
        :y="398"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Troop_TroopDetailDialog_16_1') || '集结'"
        @click="onGatherStart"
      />
      <FxButton
        v-if="gatherEndVisible"
        :x="90"
        :y="398"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Troop_TroopDetailDialog_17_1') || '结束集结'"
        @click="onGatherEnd"
      />
      <FxButton
        v-if="mailVisible"
        :x="165"
        :y="398"
        :h="36"
        style-name="ButtonGreen"
        :label="i18n('Troop_TroopDetailDialog_15_1') || '写信'"
        :enabled="!!detail?.owner"
        @click="onMail"
      />
      <FxButton :x="289" :y="398" :w="65" :h="36" style-name="Close" @click="emit('close')" />
      <FxLabel
        :x="15"
        :y="440"
        :w="334"
        :fx="{ color: 0x8a8a8a, fontSize: 11 }"
        :text="`坐标：${makeCid(troop.targetcid)}`"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.info {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
