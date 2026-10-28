<script setup lang="ts">
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * UserInfo/ChangeDesignationDialog (246x171 pop-up): wear or take off one of the earned 称号.
 * The combo lists `请选择称号` plus User.designations; `switchDesignation` stages the pick,
 * `onSubmit` sends `user/changeUserDesignation [newId, oldId]` unless nothing changed
 * (AS3 369-382, 449-461, 505-521).
 */
const emit = defineEmits<{ submit: [designationId: number, previousId: number]; close: [] }>();

const user = useUserStore();

/** `ChangeDesignationDialog.show`: the rows of User.designations with the 请选择称号 entry. */
const items = computed(() => [
  { name: i18n('DesignationsFirst'), did: -1 },
  ...user.designations.map((d) => ({
    name: String(d.name ?? ''),
    did: parseInt(String(d.did ?? 0), 10) || 0,
  })),
]);

const selectedIndex = ref(0);
/** `curDesigId` / `preDesigId` of the original. */
const chosenId = ref(-1);

/** `switchDesignation` (AS3 369-382). */
function onChange(index: number): void {
  selectedIndex.value = index;
  const row = items.value[index];
  if (index === 0) {
    chosenId.value = -1;
  } else {
    chosenId.value = row?.did ?? -1;
  }
}

/** `onSubmit` (AS3 449-461): no-op when the designation did not change. */
function onSubmit(): void {
  const previous = user.curDesigId || 0;
  if (chosenId.value === previous) return;
  emit('submit', chosenId.value, previous);
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="218" :y="161" :w="246" :h="171" style-name="PopupDialog">
      <FxButton
        :right="15"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        style-name="ButtonRed"
        :label="i18n('UserInfo_ChangeNameDialog_1_1')"
        @click="emit('close')"
      />
      <FxButton
        :right="85"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        style-name="ButtonGreen"
        :label="i18n('UserInfo_ChangeNameDialog_2_1')"
        @click="onSubmit"
      />
      <FxCanvas :x="66" :y="16" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="4"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('UserInfo_ChangeDesignationDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="17" :y="53" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="7"
          :y="3"
          style-name="LabelText"
          :fx="{ fontWeight: 'normal' }"
          :text="i18n('UserInfo_ChangeDesignationDialog_2_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="selectedIndex"
        :x="91"
        :y="53"
        :w="139"
        :h="26"
        :row-count="21"
        :items="items.map((d) => d.name)"
        :fx="{ fontSize: 12, textAlign: 'center' }"
        @change="onChange"
      />
      <FxCanvas :x="17" :y="87" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="7"
          :y="3"
          style-name="LabelText"
          :text="i18n('UserInfo_ChangeDesignationDialog_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="91" :y="87" :w="140" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="2"
          :y="3"
          :w="137"
          :fx="{ textAlign: 'center' }"
          :text="selectedIndex === 0 ? '' : (items[selectedIndex]?.name ?? '')"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
