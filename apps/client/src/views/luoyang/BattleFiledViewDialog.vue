<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { parseCityTroops, type LuoyangCity } from '../../game/luoyang';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * LuoYang.BattleFiledViewDialog: the troop list of a clicked city (`luoyangCityTroops [cid, hid]`).
 * A row of another union offers 攻击 (`luoyangAttack [attackHid, resistHid, battleCid]`), a row's
 * 详情 opens the BattleTroopViewDialog (`doClickHandle`); the own union's rows can neither.
 */
const props = defineProps<{ city: LuoyangCity | null; selectedHid: number }>();
const emit = defineEmits<{
  attack: [resistHid: number, cid: number];
  detail: [troop: Record<string, unknown>];
  close: [];
}>();

const game = useGame();

type Row = Record<string, unknown>;
const troops = ref<Row[]>([]);

const COLUMNS = [
  { header: i18n('Battle_BattleFiledViewDialog_2_1'), field: 'name', width: 110 },
  { header: i18n('LuoYang_Battle_BattleFiledViewDialog_1'), field: 'unionName', width: 130 },
  { header: i18n('Battle_BattleFiledViewDialog_4_1'), field: 'heroName', width: 110 },
  { header: i18n('Battle_BattleFiledViewDialog_5_1'), field: 'heroLevel', width: 90 },
  { header: i18n('Battle_BattleFiledViewDialog_6_1'), field: 'op', width: 100 },
];

/** `BattleFiledViewDialog.onLoadTroopData`: the reply of luoyangCityTroops. */
const unregister = game.addGlobalReceiver('LuoYangBattle', (command, data) => {
  if (command === 'luoyangCityTroops') troops.value = parseCityTroops(data);
});
onUnmounted(unregister);

/** `doClickHandle(row, 1)` → `luoyangAttack [attackHid, resistHid, battleCid]`. */
function attack(row: Row): void {
  if (props.selectedHid <= 0 || !props.city) return;
  emit('attack', Number(row.hid), props.city.cid);
}

/** `doClickHandle(row, 2)`: the troop detail dialog. */
function detail(row: Row): void {
  emit('detail', row);
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="40" :y="34" :w="602" :h="431" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
      <FxCanvas :x="232" :y="21" :w="138" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="14"
          :y="4"
          :w="112"
          :h="18"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="String(props.city?.name ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="26" :y="64" :w="550" :h="315" style-name="BoardListDown">
        <FxDataGrid :x="3" :y="3" :w="544" :h="308" :columns="COLUMNS" :rows="troops" selectable>
          <template #cell="{ row, column }">
            <template v-if="column.field === 'op'">
              <FxButton
                v-if="Number(row.unionid) !== game.user.unionid"
                :w="44"
                :h="22"
                style-name="ButtonYellow"
                :fx="{ fontSize: 11 }"
                :label="i18n('Arena_Battle_3_6')"
                @click="attack(row)"
              />
              <FxButton
                :w="44"
                :h="22"
                style-name="ButtonYellow"
                :fx="{ fontSize: 11 }"
                :label="i18n('Battle_BattleTroopItem_3_1')"
                @click="detail(row)"
              />
            </template>
            <template v-else>{{ row[column.field] ?? '' }}</template>
          </template>
        </FxDataGrid>
      </FxCanvas>
      <FxButton
        :x="527"
        :y="387"
        :w="65"
        :h="36"
        style-name="Close"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
