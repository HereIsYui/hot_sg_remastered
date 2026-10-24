<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { wid2cid, worldTypeName } from '../../game/field';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { cityPosition } from '../../stores/user';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FieldDetailDialog, { type Field } from './FieldDetailDialog.vue';

/** Government.CityFieldDialog: the wild fields the city holds. */
const props = defineProps<{ wid?: number }>();
const game = useGame();
const city = useCityStore();
const t = (n: number) => i18n(`Government_CityFieldDialog_${n}_1`);

interface Row extends Field {
  typeName: string;
  position: string;
  stateName: string;
}

const rows = ref<Row[]>([]);
const detail = ref<Field | null>(null);
const detailData = ref<unknown[] | null>(null);

const columns: { header: string; field: keyof Row & string; width: number }[] = [
  { header: t(2), field: 'typeName', width: 127 },
  { header: t(3), field: 'position', width: 127 },
  { header: t(4), field: 'level', width: 127 },
  { header: t(5), field: 'stateName', width: 127 },
  { header: '', field: 'wid', width: 128 },
];

const int = (v: unknown) => parseInt(String(v), 10) || 0;

/** `getFieldState`. */
function stateName(f: Record<string, unknown>): string {
  if (int(f.state) !== 0) return t(7);
  return int(f.troopid) > 0 ? t(8) : t(9);
}

function onGetCityField(data: unknown) {
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  rows.value = list.map((f) => ({
    wid: int(f.wid),
    type: int(f.type),
    level: int(f.level),
    province: int(f.province),
    typeName: worldTypeName(int(f.type)),
    position: cityPosition(wid2cid(int(f.wid))),
    stateName: stateName(f),
  }));
  // `onGetCityField` (AS3 283-297): a wid from `setAutoLoad` opens that field's detail right away.
  if (props.wid && props.wid > 0) {
    const row = rows.value.find((r) => r.wid === props.wid);
    if (row) onView(row);
  }
}

/** `viewFieldDetail`. */
function onView(row: Row) {
  detailData.value = null;
  detail.value = row;
  game.sendGlobalCommand('city', 'getFieldDetail', [row.wid]);
}

const unregister = game.addGlobalReceiver('city', (command, data) => {
  if (command === 'getCityField' || command === 'discardField') onGetCityField(data);
  else if (
    command === 'getFieldDetail' ||
    command === 'callBackFieldTroop' ||
    command === 'kickBackFieldTroop'
  ) {
    detailData.value = Array.isArray(data) ? [...(data as unknown[])] : [];
  }
});
onMounted(() => game.sendGlobalCommand('city', 'getCityField', [city.cid]));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxButton
      style-name="Close"
      :right="20"
      :bottom="20"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <FxCanvas :x="284" :y="19" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="3"
        :w="114"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="t(1)"
      />
    </FxCanvas>
    <FxCanvas :x="20" :y="60" :w="642" :h="364" style-name="BoardListUp">
      <FxDataGrid :x="3" :y="3" :w="636" :h="358" :row-height="30" :columns="columns" :rows="rows">
        <template #cell="{ row, column }">
          <div v-if="column.field === 'wid'" class="actions">
            <FxButton
              :x="25"
              :y="1"
              :w="52"
              :h="27"
              style-name="ButtonRed"
              :label="t(6)"
              @click="onView(row)"
            />
          </div>
          <template v-else>{{ row[column.field] }}</template>
        </template>
      </FxDataGrid>
    </FxCanvas>
    <FieldDetailDialog
      v-if="detail"
      :key="detail.wid"
      :field="detail"
      :data="detailData"
      @close="detail = null"
    />
  </FxCanvas>
</template>

<style scoped>
.actions {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
