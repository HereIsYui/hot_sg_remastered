<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.CreateBattleDialog: pick the difficulty of a new battlefield and send
 * `createBattle [bid, level]` (a level above 10 asks once, per `onSubmit`/`confirmSubmit`).
 * The hall opens it with the row of the selected battlefield.
 */
const props = defineProps<{
  battleId: number;
  battleName: string;
  maxLevel: number;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

/** `setData`: one entry per level 1..maxLevel, `Battle_CreateBattleDialogSrc_4` = 级. */
const levels = computed(() =>
  Array.from(
    { length: Math.max(0, props.maxLevel) },
    (_, i) => `${i + 1}${i18n('Battle_CreateBattleDialogSrc_4')}`,
  ),
);
const levelSelect = ref(0);
const visible = ref(true);

/** `onSubmit` / `confirmSubmit`: the reply is handled by BattlePanel (`createBattle`). */
async function submit(): Promise<void> {
  const level = levelSelect.value + 1;
  if (level > 10) {
    const text =
      i18n('Battle_CreateBattleDialogSrc_1') +
      level +
      i18n('Battle_CreateBattleDialogSrc_2') +
      (level - 10) +
      i18n('Battle_CreateBattleDialogSrc_3');
    const answer = await showAlert(text, '', ['yes', 'no']);
    if (answer !== 'yes') return;
  }
  game.sendGlobalCommand('battle', 'createBattle', [props.battleId, level]);
  visible.value = false;
  emit('close');
}
</script>

<template>
  <FxCanvas
    v-if="visible"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="218" :y="101" :w="284" :h="237" style-name="PopupDialog">
      <FxCanvas :x="85" :y="26" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_CreateBattleDialog_1_1')"
        />
      </FxCanvas>
      <!-- 战场名 -->
      <FxCanvas :x="26" :y="76" :w="90" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="74"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_CreateBattleDialog_5_1')"
        />
      </FxCanvas>
      <FxCanvas :x="136" :y="76" :w="120" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="3"
          :y="3"
          :w="114"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="props.battleName"
        />
      </FxCanvas>
      <!-- 难度 -->
      <FxCanvas :x="26" :y="125" :w="90" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="74"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_CreateBattleDialog_4_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="levelSelect"
        :x="136"
        :y="125"
        :w="120"
        :h="26"
        :items="levels"
        @change="() => {}"
      />
      <FxButton
        :x="120"
        :y="181"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="i18n('Battle_CreateBattleDialog_2_1')"
        @click="submit"
      />
      <FxButton
        :x="194"
        :y="181"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="i18n('Battle_CreateBattleDialog_3_1')"
        @click="((visible = false), emit('close'))"
      />
    </FxCanvas>
  </FxCanvas>
</template>
