<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * LuoYang.BattleTroopViewDialog: the 军队详情 of one troop row — lord, union, hero, level and the
 * soldier table parsed from the `soldiers` string (`parseSoldier`, AS3:616: `sid,count` pairs).
 */
const props = defineProps<{ troop: Record<string, unknown> | null }>();
const emit = defineEmits<{ close: [] }>();

/** `parseSoldier`: `"sid,count,sid,count"` (+ a leading kind digit some writers add). */
function parseSoldiers(raw: string): { sid: number; count: number }[] {
  const parts = raw.split(',').map((p) => parseInt(p, 10) || 0);
  const start = parts.length % 2 === 1 ? 1 : 0;
  const pairs: { sid: number; count: number }[] = [];
  for (let i = start; i + 1 < parts.length; i += 2) {
    if (parts[i]! > 0) pairs.push({ sid: parts[i]!, count: parts[i + 1]! });
  }
  return pairs;
}

const soldiers = computed(() =>
  props.troop ? parseSoldiers(String(props.troop.soldiers ?? '')) : [],
);

const COLUMNS: { header: string; field: 'sid' | 'count'; width: number }[] = [
  { header: i18n('Arena_Battle_3_1'), field: 'sid', width: 160 },
  { header: i18n('Arena_Battle_3_3'), field: 'count', width: 160 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="159" :y="38" :w="364" :h="407" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
      <FxCanvas :x="97" :y="15" :w="169" :h="24" style-name="PopupTitle">
        <FxLabel
          :x="4"
          :y="3"
          :w="160"
          :h="18"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_BattleTroopViewDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="15" :y="57" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopViewDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="68" :y="57" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ color: 16777215, textAlign: 'center' }"
          :text="String(props.troop?.name ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="186" :y="57" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopViewDialog_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="239" :y="57" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ color: 16777215, textAlign: 'center' }"
          :text="String(props.troop?.unionName ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="15" :y="91" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopViewDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="68" :y="90" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ color: 16777215, textAlign: 'center' }"
          :text="String(props.troop?.heroName ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="186" :y="91" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="3"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleTroopViewDialog_5_1')"
        />
      </FxCanvas>
      <FxCanvas :x="239" :y="90" :w="110" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="110"
          style-name="ItemValue"
          :fx="{ color: 16777215, textAlign: 'center' }"
          :text="String(props.troop?.heroLevel ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="15" :y="125" :w="334" :h="209" style-name="BoardListDown">
        <FxDataGrid :x="3" :y="3" :w="328" :h="203" :columns="COLUMNS" :rows="soldiers" />
      </FxCanvas>
      <FxButton
        :x="289"
        :y="351"
        :w="65"
        :h="36"
        :label="i18n('Battle_BattleTroopViewDialog_8_1')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
