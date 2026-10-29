<script setup lang="ts">
import { computed, ref } from 'vue';
import { governActions, governOthersArgs, governPreview, type GovernInfo } from '../../game/govern';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * World/GovernPanel: the 下达政令 pop-up. `_fromFlag == 1` is the WorldActionDialog's 名城-owner
 * branch (`setTarget` / `getGovernInfo`, sends `governOthers`); `_fromFlag == 2` (`setFlag(2)`,
 * opened from LuoYangBelongPanel with `getLuoyangGovernCount`'s used count) shows the coordinate
 * inputs and sends `governLuoyangOthers [type, x, y]` over the LuoYangInitBattle action with the
 * fixed cap of 10 (World/GovernPanel.as:552-592, 697-706). The thrown success text arrives over
 * the global failure path; the 防沉迷 reminder of `onSubmit` is not ported.
 */
const props = defineProps<{
  /** `setTarget` (AS3 419-423): the clicked cell's city id and owner (mode 1). */
  targetCid?: number;
  targetUid?: number;
  /** `setGovernInfo` (AS3 392-411): office name, daily cap and used count (mode 1). */
  info?: GovernInfo | null;
  /** `setFlag` (AS3 680-691): 1 名城政令, 2 洛阳政令. */
  fromFlag?: number;
  /** `setLuoyangGovernInfo`: the already-used count of today (mode 2). */
  luoyangCount?: number;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();

const actions = governActions();
const actionIndex = ref(0);
const targetX = ref('');
const targetY = ref('');
const fromFlag = computed(() => props.fromFlag ?? 1);

/** The 洛阳 king-mode messages (`kingMsg`, World_GovernPanelSrc_30..34). */
const kingMsgs = computed(() => [0, 1, 2, 3, 4].map((i) => i18n(`World_GovernPanelSrc_${30 + i}`)));

/** `onChange` / `onShow` (AS3 693-708, 722-725): the preview under the combo. */
const preview = computed(() => {
  if (fromFlag.value === 2) {
    return (
      kingMsgs.value[actionIndex.value] +
      '\n' +
      i18n('World_GovernPanelSrc_35') +
      i18n('World_GovernPanelSrc_20') +
      '10' +
      i18n('World_GovernPanelSrc_21') +
      i18n('World_GovernPanelSrc_22') +
      String(props.luoyangCount ?? 0) +
      i18n('World_GovernPanelSrc_23')
    );
  }
  return governPreview(city.type, actionIndex.value, props.info!);
});

/** `onSubmit` (AS3 552-592): mode 1 sends governOthers, mode 2 governLuoyangOthers; both hide. */
function onSubmit(): void {
  if (fromFlag.value === 2) {
    const x = parseInt(targetX.value, 10);
    const y = parseInt(targetY.value, 10);
    if (Number.isNaN(x) || Number.isNaN(y) || x < 0 || y < 0 || x > 500 || y > 500) {
      void showAlert(i18n('Goods_ChangeCityPositionDialogSrc_5'));
      return;
    }
    game.sendGlobalCommand('LuoYangInitBattle', 'governLuoyangOthers', [actionIndex.value, x, y]);
    emit('close');
    return;
  }
  game.sendWorldCommand(
    'governOthers',
    governOthersArgs(actionIndex.value, props.targetCid!, props.targetUid!, city.cid, city.name),
  );
  emit('close');
}
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="736"
    :h="556"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="210.5" :y="82" :w="304" :h="313" style-name="PanelGreyGreen">
      <FxButton
        style-name="Close"
        :right="10"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :x="95" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('World_GovernPanel_1_1')"
        />
      </FxCanvas>
      <FxButton
        :right="78"
        :bottom="10"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="i18n('World_GovernPanel_2_1')"
        @click="onSubmit"
      />
      <FxCanvas :x="21" :y="54" :w="90" :h="28" style-name="BoardListUp">
        <FxLabel
          :x="8"
          :y="3"
          :w="74"
          :h="23"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('World_GovernPanel_3_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="actionIndex"
        :x="151"
        :y="54"
        :w="123"
        :h="28"
        :items="actions"
      />
      <!-- `fromLuoYang` (AS3 220): the mode-2 coordinate inputs, label LuoYang_Belong_1_1 城池坐标 -->
      <FxCanvas v-if="fromFlag === 2" :x="15" :y="97" :w="274" :h="40">
        <FxCanvas :x="6" :y="5" :w="90" :h="28" style-name="BoardListUp">
          <FxLabel
            :x="8"
            :y="3"
            :w="74"
            :h="23"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('LuoYang_Belong_1_1')"
          />
        </FxCanvas>
        <FxTextInput
          v-model="targetX"
          :x="104"
          :y="5"
          :w="60"
          :h="28"
          style-name="EmptyTextInput"
        />
        <FxTextInput
          v-model="targetY"
          :x="176"
          :y="5"
          :w="60"
          :h="28"
          style-name="EmptyTextInput"
        />
      </FxCanvas>
      <FxText :x="21" :y="147" :w="253" :h="80" type="TextArea" :text="preview" />
    </FxCanvas>
  </FxCanvas>
</template>
