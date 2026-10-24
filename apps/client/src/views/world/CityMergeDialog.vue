<script setup lang="ts">
import { computed, ref } from 'vue';
import { mergeArgs, mergeLists, positionParts } from '../../game/cityMerge';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * World/CityMergeDialog: 合并城池. `onShow` (AS3 967-1014) fills the two combos from
 * `user.cities` — the main combo accepts ordinary and merged (type 5) cities, the sub combo only
 * ordinary ones, a type-5 city locks the main pick, and a maxed (官府 15) one refuses the dialog
 * (`CityMergeDialog_tile_10`). `selectCity` (AS3 525-536, from the world-map entry) preselects
 * the clicked city as the sub city. 确定 (`onMergeCity`, AS3 643-658) sends
 * `('CityMerge', 'mergeCity', [mainCid, subCid])`; the success reply (BloodWar.as:5913-5921 —
 * close, 合并成功, refresh the city list) is handled in game.ts's 'CityMerge' branch, error
 * texts thrown by the server arrive over the global failure path.
 */
const props = defineProps<{ selectCid: number }>();

const game = useGame();
const user = useUserStore();

/** `onShow` (AS3 967-1014): the two lists and the locked main pick. */
const lists = computed(() => mergeLists(user.cities));
const mainIndex = ref(0);
const subIndex = ref(0);
if (lists.value.lockedMain) {
  mainIndex.value = Math.max(0, lists.value.main.indexOf(lists.value.lockedMain));
}
if (props.selectCid > 0) {
  const i = lists.value.sub.findIndex((c) => c.cid === props.selectCid);
  if (i >= 0) subIndex.value = i;
}
if (lists.value.blocked) {
  void showAlert(i18n('CityMergeDialog_tile_10'));
  game.closeDialog();
}

const mainItems = computed(() => lists.value.main.map((c) => c.name));
const subItems = computed(() => lists.value.sub.map((c) => c.name));

/** `updateMainList` / `updateSubList` (AS3 914-960): the picked city's position and 官府 level. */
const main = computed(() => {
  const c = lists.value.main[mainIndex.value];
  const p = c ? positionParts(String(c.position)) : { x: '', y: '' };
  return { x: p.x, y: p.y, level: c ? String(c.level ?? '') : '' };
});
const sub = computed(() => {
  const c = lists.value.sub[subIndex.value];
  const p = c ? positionParts(String(c.position)) : { x: '', y: '' };
  return { x: p.x, y: p.y, level: c ? String(c.level ?? '') : '' };
});

/** `onMergeCity` (AS3 643-658). */
function onMergeCity(): void {
  const r = mergeArgs(lists.value.main, mainIndex.value, lists.value.sub, subIndex.value);
  if ('error' in r) {
    void showAlert(i18n(r.error === 'empty' ? 'City_Merge_Dialog_3' : 'City_Merge_Dialog_1'));
    return;
  }
  game.sendGlobalCommand('CityMerge', 'mergeCity', r.args);
}

/** `onClose` (AS3 758-761). */
function onClose(): void {
  game.closeDialog();
}
</script>

<template>
  <FxCanvas
    :x="21"
    :y="58"
    :w="380"
    :h="375"
    style-name="PanelGreyGreen"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <!-- title (合并城池) -->
    <FxCanvas :x="90" :y="15" :w="200" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="24.5"
        :y="2"
        :w="151"
        :h="18"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', fontWeight: 'normal' }"
        :text="i18n('CityMergeDialog_tile_8')"
      />
    </FxCanvas>

    <!-- main / sub city pickers -->
    <FxCanvas :x="15" :y="46" :w="350" :h="125" style-name="BoardListUp">
      <!-- 主城 -->
      <FxCanvas :x="8" :y="8" :w="150" :h="110" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="14"
          :w="52"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('CityMergeDialog_tile_4')"
        />
        <FxComboBox
          v-model:selected-index="mainIndex"
          :x="42"
          :y="11"
          :w="97"
          :row-count="16"
          :items="mainItems"
          :enabled="!lists.lockedMain"
        />
        <FxLabel
          :x="0"
          :y="42"
          :w="52"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('CityMergeDialog_tile_5')"
        />
        <FxTextInput :x="42" :y="43" :w="45" :editable="false" v-model="main.x" />
        <FxTextInput :x="95" :y="44" :w="45" :editable="false" v-model="main.y" />
        <FxLabel
          :x="0"
          :y="73"
          :w="52"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('CityMergeDialog_tile_6')"
        />
        <FxTextInput
          :x="43"
          :y="75"
          :w="97"
          :editable="false"
          :fx="{ textAlign: 'center' }"
          v-model="main.level"
        />
      </FxCanvas>
      <!-- 分城 -->
      <FxCanvas :x="166" :y="7" :w="159" :h="110" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="13"
          :w="52"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('CityMergeDialog_tile_1')"
        />
        <FxComboBox
          v-model:selected-index="subIndex"
          :x="50"
          :y="10"
          :w="98"
          :row-count="16"
          :items="subItems"
        />
        <FxLabel
          :x="0"
          :y="42"
          :w="52"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('CityMergeDialog_tile_2')"
        />
        <FxTextInput :x="50" :y="42" :w="45" :editable="false" v-model="sub.x" />
        <FxTextInput :x="103" :y="42" :w="45" :editable="false" v-model="sub.y" />
        <FxLabel
          :x="0"
          :y="75"
          :w="52"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('CityMergeDialog_tile_3')"
        />
        <FxTextInput
          :x="50"
          :y="78"
          :w="98"
          :editable="false"
          :fx="{ textAlign: 'center' }"
          v-model="sub.level"
        />
      </FxCanvas>
    </FxCanvas>

    <!-- the merge description -->
    <FxCanvas :x="15" :y="178" :w="350" :h="143" style-name="BoardListDown">
      <FxText
        :x="10"
        :y="10"
        :w="330"
        :h="122"
        type="TextArea"
        style-name="orangeColor"
        :text="i18n('CityMergeDialog_tile_7')"
      />
    </FxCanvas>

    <!-- 确定 / cancel -->
    <FxButton
      :right="88"
      :bottom="10"
      :w="65"
      :h="36"
      style-name="ButtonGreen"
      :fx="{ fontSize: 14 }"
      :label="i18n('CityMergeDialog_tile_9')"
      @click="onMergeCity"
    />
    <FxButton :x="295" :bottom="10" style-name="Cancel" :fx="{ fontSize: 16 }" @click="onClose" />
  </FxCanvas>
</template>
