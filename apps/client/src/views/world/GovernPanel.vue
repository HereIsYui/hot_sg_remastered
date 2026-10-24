<script setup lang="ts">
import { computed, ref } from 'vue';
import { governActions, governOthersArgs, governPreview, type GovernInfo } from '../../game/govern';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * World/GovernPanel: the 下达政令 pop-up the WorldActionDialog embeds for a 名城 owner
 * (`createChildren`, AS3 2654-2665). The combo picks the 政令 (0 征税 .. 4 裁军), the preview
 * shows the per-政令 line plus the office / daily counts from `getGovernInfo`, and 确定 sends
 * `governOthers [type, tcid, tuid, cid, cityname]`. The `_fromFlag == 2` 洛阳 branch
 * (`fromLuoYang` coordinate inputs, `governLuoyangOthers`) is a later phase and not ported; so is
 * the 防沉迷 reminder `onSubmit` shows to minors first (AdultSrc). The thrown success text of
 * `governOthers` arrives over the global failure path and the original refreshes nothing after
 * it (the 15 s resource poll picks the gain up), so neither does this port.
 */
const props = defineProps<{
  /** `setTarget` (AS3 419-423): the clicked cell's city id and owner. */
  targetCid: number;
  targetUid: number;
  /** `setGovernInfo` (AS3 392-411): office name, daily cap and used count. */
  info: GovernInfo;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();

const actions = governActions();
const actionIndex = ref(0);

/** `onChange` / `onShow` (AS3 693-708, 722-725): the preview under the combo. */
const preview = computed(() => governPreview(city.type, actionIndex.value, props.info));

/** `onSubmit` (AS3 552-589, `_fromFlag == 1`): send the 政令, then hide (`onClose`). */
function onSubmit(): void {
  game.sendWorldCommand(
    'governOthers',
    governOthersArgs(actionIndex.value, props.targetCid, props.targetUid, city.cid, city.name),
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
      <FxText :x="21" :y="147" :w="253" :h="80" type="TextArea" :text="preview" />
    </FxCanvas>
  </FxCanvas>
</template>
