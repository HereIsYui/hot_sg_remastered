<script setup lang="ts">
import { computed } from 'vue';
import { parseSoldierPairs } from '../../game/battlefield';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleTroopViewDialog: the read-only 军队详情 of one row in the 据点's troop list
 * (`getCityBattleTroopDetail [troopid]` answers the card without the march fields).
 */
const props = defineProps<{ troop: Record<string, unknown> }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const heroinfo = computed(() => (props.troop.heroinfo ?? {}) as Record<string, unknown>);
const soldiers = computed(() => parseSoldierPairs(String(props.troop.soldiers ?? '')));

const COLUMNS: { header: string; field: 'sid' | 'count'; width: number }[] = [
  { header: i18n('Battle_BattleTroopDetailDialog_6_1'), field: 'sid', width: 160 },
  { header: i18n('Battle_BattleTroopDetailDialog_7_1'), field: 'count', width: 160 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="159" :y="38" :w="364" :h="407" style-name="PanelGreyGreen">
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
          :text="String(props.troop.name ?? '')"
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
          :text="String(props.troop.unionname ?? '')"
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
          :text="String(heroinfo.name ?? '')"
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
          :text="String(heroinfo.level ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="15" :y="125" :w="334" :h="209" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="328"
          :h="203"
          :columns="COLUMNS"
          :rows="
            soldiers.map((p) => ({ sid: game.global.soldierNames[p.sid] ?? p.sid, count: p.count }))
          "
        />
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
