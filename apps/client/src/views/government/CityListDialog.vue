<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { BUILDING_GOVERNMENT } from '../../game/cityGrid';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { cityPosition } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Government.CityListDialog: every city of the player; another city may be discarded. */
const game = useGame();
const city = useCityStore();
const t = (n: number) => i18n(`Government_CityListDialog_${n}_1`);

interface Row {
  cid: number;
  type: number;
  name: string;
  position: string;
  chiefname: string;
  people: string;
  morale: string;
}

const rows = ref<Row[]>([]);
/** `inputPasswordPanel.visible` with `mLastCid`. */
const discarding = ref<number | null>(null);

/** The columns' 610px stretched over the 636px grid, as the DataGrid does. */
const columns: { header: string; field: keyof Row & string; width: number }[] = [
  { header: t(2), field: 'name', width: 125 },
  { header: t(3), field: 'position', width: 104 },
  { header: t(4), field: 'chiefname', width: 125 },
  { header: t(5), field: 'people', width: 125 },
  { header: t(6), field: 'morale', width: 83 },
  { header: t(7), field: 'cid', width: 74 },
];

function onGetCityList(data: unknown) {
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  rows.value = list.map((c) => {
    const cid = parseInt(String(c.cid), 10) || 0;
    return {
      cid,
      type: parseInt(String(c.type), 10) || 0,
      name: String(c.name ?? ''),
      position: cityPosition(cid),
      chiefname: String(c.chiefname ?? ''),
      people: String(c.people ?? ''),
      morale: String(c.morale ?? ''),
    };
  });
}

/** `discardCity`: the city being managed cannot discard itself. */
function onDiscard(row: Row) {
  if (row.cid === city.cid) {
    void showAlert(t(14));
    return;
  }
  discarding.value = row.cid;
}

/** `onSubmit` / `doDiscardCity`: confirmation, then the 2级密码, then the command. */
async function onSubmit() {
  const cid = discarding.value;
  if (cid === null || (await showAlert(t(15), '', ['yes', 'no'])) !== 'yes') return;
  game.requestUnlock('discardCityType', () => {
    game.sendGlobalCommand('city', 'discardCity', [cid]);
    game.showDialog('cityList');
  });
}

/** `onReturn`: back to the 官府. */
function onReturn() {
  const government = city.buildings.find((b) => b.bid === BUILDING_GOVERNMENT);
  if (government) game.showBuildingDialog(government);
  else game.closeDialog();
}

const unregister = game.addGlobalReceiver('city', (command, data) => {
  if (command === 'getCityList') onGetCityList(data);
  else if (command === 'discardCity') onGetCityList((data as unknown[] | undefined)?.[0]);
});
onMounted(() => game.sendGlobalCommand('city', 'getCityList', [city.cid]));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxButton
      style-name="Close"
      :right="20"
      :bottom="15"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <FxCanvas :x="284" :y="20" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="114"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="t(1)"
      />
    </FxCanvas>
    <FxButton
      :w="65"
      :h="36"
      style-name="Return"
      :right="109"
      :bottom="15"
      :fx="{ fontSize: 16 }"
      @click="onReturn"
    />
    <FxCanvas :x="20" :y="63" :w="642" :h="364" style-name="BoardListUp">
      <FxDataGrid :x="3" :y="3" :w="636" :h="358" :row-height="30" :columns="columns" :rows="rows">
        <template #cell="{ row, column }">
          <div v-if="column.field === 'cid'" class="actions">
            <FxButton
              :x="10"
              :y="1"
              :w="50"
              :h="28"
              style-name="ButtonRed"
              :label="t(8)"
              :enabled="row.type !== 5"
              @click="onDiscard(row)"
            />
          </div>
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FxCanvas
      v-if="discarding !== null"
      :x="0"
      :y="0"
      :w="682"
      :h="492"
      :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }"
    >
      <FxCanvas :x="218" :y="101" :w="246" :h="228" style-name="PopupDialog">
        <FxButton
          style-name="ButtonRed"
          :right="10"
          :bottom="10"
          :fx="{ fontSize: 16 }"
          :label="t(9)"
          @click="discarding = null"
        />
        <FxButton
          style-name="ButtonGreen"
          :right="78"
          :bottom="10"
          :fx="{ fontSize: 16 }"
          :label="t(10)"
          @click="onSubmit"
        />
        <FxCanvas :x="66" :y="8" :w="114" :h="26" style-name="PopupTitle">
          <FxLabel
            :x="0"
            :y="4"
            :w="114"
            style-name="PopupDialogTitle"
            :fx="{ textAlign: 'center' }"
            :text="t(11)"
          />
        </FxCanvas>
        <FxCanvas :x="16" :y="42" :w="214" :h="96" style-name="BoardListDown">
          <FxText
            :x="2"
            :y="2"
            :w="210"
            :h="92"
            :fx="{ color: 16777215, fontWeight: 'normal' }"
            :text="t(13)"
          />
        </FxCanvas>
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.actions {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
