<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  callArmyPreview,
  reinforceAvailable,
  type BattleState,
  type BattleTroop,
} from '../../game/battlefield';
import { armBuyAgain } from '../../game/battlefieldBuyAgain';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.CallArmyDialog: the 调遣援军 popup of a battlefield troop (`BattleTroopItem` menu /
 * `BattleTroopDetailDialog.调遣援军`). The soldier combo lists `Define.SOLDIER_NAME` (the reply
 * sends `actionSelect.selectedIndex + 1` as sid); the preview follows `resetData` — the call is
 * capped by the 荣誉 budget and the battlefield-level headroom (`getReinforceAvailable`), costs
 * `ceil(count * people / 100)` honour and `yuanjun` 援军令 (gid 135). The submit sends
 * `callArmy [troopid, sid, count]`.
 */
const props = defineProps<{
  troopid: number;
  troop: BattleTroop | null;
  honour: number;
  battle: BattleState | null;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const soldierNames = Array.from({ length: 12 }, (_, i) => i18n(`_Define_${25 + i}`));
const soldierSelect = ref(0);
const countInput = ref('1');

const available = computed(() =>
  props.battle && props.troop ? reinforceAvailable(props.battle, props.troop.soldiers) : 0,
);

const preview = computed(() =>
  callArmyPreview(
    soldierSelect.value,
    parseInt(countInput.value, 10) || 0,
    props.honour,
    available.value,
  ),
);

/** `resetData`: the preview sentence of `Battle_CallArmyDialogSrc_2..7`. */
const previewText = computed(
  () =>
    i18n('Battle_CallArmyDialogSrc_2') +
    soldierNames[soldierSelect.value] +
    i18n('Battle_CallArmyDialogSrc_3') +
    (parseInt(countInput.value, 10) || 0) +
    i18n('Battle_CallArmyDialogSrc_4') +
    preview.value.yuanjun +
    i18n('Battle_CallArmyDialogSrc_5') +
    preview.value.needHonour +
    i18n('Battle_CallArmyDialogSrc_6') +
    (props.battle?.name ?? '') +
    i18n('Battle_CallArmyDialogSrc_7'),
);

/** `changeCount` clamps to maxCall. */
watch(countInput, (value) => {
  const count = parseInt(value, 10) || 0;
  if (count > preview.value.maxCall) countInput.value = String(preview.value.maxCall);
});

/** `takeMaxSoldier`. */
function takeMax(): void {
  countInput.value = String(preview.value.maxCall);
}

/** `onSubmit` (the reply is handled by BattlePanel's `callArmy` case). */
async function onSubmit(): Promise<void> {
  const count = parseInt(countInput.value, 10) || 0;
  if (count <= 0) {
    void showAlert(i18n('Battle_CallArmyDialogSrc_1'));
    return;
  }
  armBuyAgain([135], () =>
    game.sendGlobalCommand('battle', 'callArmy', [props.troopid, soldierSelect.value + 1, count]),
  );
  game.sendGlobalCommand('battle', 'callArmy', [props.troopid, soldierSelect.value + 1, count]);
  emit('close');
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="201" :y="97" :w="280" :h="297" style-name="PanelGreyGreen">
      <FxCanvas :x="70" :y="14" :w="138" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="14"
          :y="4"
          :w="112"
          :h="18"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_CallArmyDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="21" :y="56" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_CallArmyDialog_3_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="soldierSelect"
        :x="130"
        :y="56"
        :w="128"
        :h="26"
        :items="soldierNames"
      />
      <FxCanvas :x="21" :y="96" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_CallArmyDialog_6_1')"
        />
      </FxCanvas>
      <input v-model="countInput" class="count-input" restrict="0-9" />
      <FxButton
        :x="130"
        :y="96"
        :w="60"
        :h="26"
        :label="i18n('Battle_BattleCampaignDialog_4_1')"
        @click="takeMax"
      />
      <FxLabel :x="21" :y="136" :w="238" :h="100" :fx="{ color: 16777215 }" :text="previewText" />
      <FxButton
        :x="70"
        :y="240"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="i18n('Battle_CallArmyDialog_2_1')"
        @click="onSubmit"
      />
      <FxButton
        :x="145"
        :y="240"
        :w="65"
        :h="36"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.count-input {
  position: absolute;
  left: 130px;
  top: 96px;
  width: 56px;
  height: 26px;
  box-sizing: border-box;
  border: 1px inset #b7babc;
  background: #fff;
  color: #000;
  font-size: 12px;
  padding: 0 3px;
}
</style>
