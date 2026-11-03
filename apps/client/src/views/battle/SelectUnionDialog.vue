<script setup lang="ts">
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.SelectUnionDialog: the camp picker over the JoinBattleDialog row. `onSubmit` resolves
 * `mUnions[unionSelect.selectedIndex].unionid` and the caller sends `joinToPVPBattle`.
 */
const props = defineProps<{
  battleName: string;
  stateText: string;
  unions: Record<string, unknown>[];
}>();
const emit = defineEmits<{ submit: [unionid: number]; close: [] }>();

const unionNames = computed(() => props.unions.map((u) => String(u.name ?? '')));
const unionSelect = ref(0);

/** `onSubmit`. */
function submit(): void {
  const union = props.unions[unionSelect.value];
  emit('submit', union ? Number(union.unionid) : 0);
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="205" :y="82" :w="271" :h="339" style-name="PanelGreyGreen">
      <FxCanvas :x="78" :y="10" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_SelectUnionDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="19" :y="53" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_SelectUnionDialog_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="128" :y="53" :w="123" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="111"
          :h="20"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_SelectUnionDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="19" :y="92" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_SelectUnionDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="128" :y="93" :w="123" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="111"
          :h="20"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="props.battleName"
        />
      </FxCanvas>
      <FxCanvas :x="19" :y="126" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_SelectUnionDialog_7_1')"
        />
      </FxCanvas>
      <FxCanvas :x="128" :y="127" :w="123" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="111"
          :h="20"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="props.stateText"
        />
      </FxCanvas>
      <FxCanvas :x="19" :y="160" :w="100" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="6"
          :y="3"
          :w="88"
          :h="20"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_SelectUnionDialog_8_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="unionSelect"
        :x="128"
        :y="160"
        :w="123"
        :h="26"
        :items="unionNames"
      />
      <FxButton
        :x="106"
        :y="284"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="i18n('Battle_SelectUnionDialog_2_1')"
        @click="submit"
      />
      <FxButton
        :x="187"
        :y="284"
        :w="65"
        :h="36"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
