<script lang="ts">
export interface Field {
  wid: number;
  type: number;
  level: number;
  province: number;
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { serverTime, timeLeftText } from '../../core/clock';
import { BUILDING_GROUND } from '../../game/cityGrid';
import { canCreateCityOnField, fieldDescription, fieldTitle, wid2cid } from '../../game/field';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useGlobalStore } from '../../stores/global';
import { cityPosition, useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Government.FieldDetailDialog: one field's stationed troops, which can be recalled (the
 * player's) or sent away (others'). 派遣 opens the 校场's campaign dialog on this field, 筑城 sends
 * `createCityFromLand`. 采集 / 收获 (`gatherFieldStart` / `gatherFieldEnd`) are city commands the
 * server has not ported, so those two buttons stay disabled.
 */
const props = defineProps<{ field: Field; data: unknown[] | null }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const user = useUserStore();
const global = useGlobalStore();
const t = (n: number) => i18n(`Government_FieldDetailDialog_${n}_1`);

interface Troop {
  id: number;
  heroname: string;
  username: string;
  position: string;
  myTroop: boolean;
}

const cid = computed(() => wid2cid(props.field.wid));
const title = computed(() => fieldTitle(props.field.type, props.field.wid));
const description = computed(() =>
  fieldDescription(props.field.type, props.field.level, props.field.province, global.yysType),
);
const canCreateCity = computed(() => canCreateCityOnField(props.field.type));

/** `loadData`: `[troops, gathering or false]`. */
const troops = computed<Troop[]>(() => {
  const list = Array.isArray(props.data?.[0]) ? (props.data[0] as Record<string, unknown>[]) : [];
  return list.map((tr) => {
    const hero = tr.heroname;
    return {
      id: parseInt(String(tr.id), 10) || 0,
      heroname: hero == null || hero === 'NULL' ? t(34) : String(hero),
      username: String(tr.username ?? ''),
      position: cityPosition(parseInt(String(tr.cid), 10) || 0),
      myTroop: String(tr.uid) === String(user.uid),
    };
  });
});
const gatherStart = computed(() => {
  const g = props.data?.[1];
  return g && typeof g === 'object'
    ? parseInt(String((g as Record<string, unknown>).starttime), 10) || 0
    : null;
});

const now = ref(serverTime());
const gatherTime = computed(() =>
  gatherStart.value === null ? '' : timeLeftText(now.value - gatherStart.value, i18n),
);

const columns: { header: string; field: keyof Troop & string; width: number }[] = [
  { header: t(2), field: 'heroname', width: 120 },
  { header: t(3), field: 'username', width: 120 },
  { header: t(4), field: 'position', width: 100 },
  { header: '', field: 'id', width: 84 },
];

function onTroop(troop: Troop) {
  if (troop.myTroop) {
    game.sendGlobalCommand('city', 'callBackFieldTroop', [troop.id, props.field.wid]);
  } else {
    game.sendGlobalCommand('city', 'kickBackFieldTroop', [city.cid, troop.id, props.field.wid]);
  }
}

/** `onDiscardField` / `onDiscardAlert`. */
async function onDiscard() {
  if ((await showAlert(t(35), '', ['yes', 'no'])) !== 'yes') return;
  game.sendGlobalCommand('city', 'discardField', [city.cid, props.field.wid]);
  emit('close');
}

/**
 * `onDispatch` (AS3 847-875): open the 校场's campaign dialog with this field as the target and
 * the 派遣 task preselected (`setCampaignTarget(wid2cid(mWid), 1)` — combo index 1 = 派遣).
 * Without a 校场 the original alerts `Government_FieldDetailDialog_13_1`.
 */
function onDispatch() {
  const ground = city.buildings.find((b) => b.bid === BUILDING_GROUND && b.level > 0);
  if (!ground) {
    void showAlert(t(13));
    return;
  }
  game.closeDialog();
  game.showCampaign(ground.bid, ground.y * 10 + ground.x, cid.value, 1);
}

/** `onCreateCity` / `onCreateCityAlert` (AS3 771-781, 1084-1087): confirm, then 筑城. */
async function onCreateCity() {
  if ((await showAlert(t(36), '', ['yes', 'no'])) !== 'yes') return;
  game.sendWorldCommand('createCityFromLand', [props.field.wid]);
  emit('close');
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = serverTime()), 1000)));
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="106" :y="78" :w="470" :h="357" style-name="PopupDialog">
      <FxButton
        style-name="Close"
        :right="18"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
      <FxCanvas :x="110" :y="16" :w="250" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="10.5"
          :y="3"
          :w="229"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="title"
        />
      </FxCanvas>
      <FxButton
        :w="65"
        :h="36"
        style-name="ButtonGreen"
        :right="91"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(1)"
        @click="onDispatch"
      />
      <FxCanvas :x="20" :y="84" :w="430" :h="212" style-name="BoardListUp">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="424"
          :h="206"
          :row-height="30"
          :columns="columns"
          :rows="troops"
        >
          <template #cell="{ row, column }">
            <div v-if="column.field === 'id'" class="actions">
              <FxButton
                :x="15"
                :y="2"
                :w="52"
                :h="26"
                style-name="ButtonRed"
                :label="row.myTroop ? t(5) : t(6)"
                @click="onTroop(row)"
              />
            </div>
            <template v-else>{{ row[column.field] }}</template>
          </template>
        </FxDataGrid>
      </FxCanvas>
      <FxButton
        :x="14"
        style-name="ButtonRed"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(7)"
        @click="onDiscard"
      />
      <FxCanvas :x="20" :y="50" :w="45" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="4"
          :w="45"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="t(8)"
        />
      </FxCanvas>
      <FxCanvas :x="76" :y="50" :w="39" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="0"
          :y="4"
          :w="39"
          style-name="ItemValue"
          :fx="{ textAlign: 'center' }"
          :text="field.level"
        />
      </FxCanvas>
      <FxLabel
        :x="120"
        :y="55"
        :w="121"
        :h="18"
        style-name="ItemValue"
        :text="description"
        :tip="description"
      />
      <!-- 采集 / 收获: gatherFieldStart / gatherFieldEnd are not ported on the server yet. -->
      <FxButton
        v-if="gatherStart === null && !canCreateCity"
        :w="65"
        :h="36"
        style-name="ButtonGreen"
        :right="164"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(9)"
        :enabled="false"
      />
      <FxButton
        v-if="gatherStart !== null && !canCreateCity"
        :w="65"
        :h="36"
        style-name="ButtonGreen"
        :right="164"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(10)"
        :enabled="false"
      />
      <template v-if="gatherStart !== null">
        <FxCanvas :x="240" :y="50" :w="64" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="0"
            :y="4"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="t(11)"
          />
        </FxCanvas>
        <FxCanvas :x="312" :y="50" :w="138" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="4"
            :w="135"
            style-name="ItemValue"
            :fx="{ textAlign: 'left' }"
            :text="gatherTime"
          />
        </FxCanvas>
      </template>
      <FxButton
        v-if="canCreateCity"
        :w="65"
        :h="36"
        style-name="ButtonGreen"
        :right="237"
        :bottom="15"
        :fx="{ fontSize: 16 }"
        :label="t(12)"
        @click="onCreateCity"
      />
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
