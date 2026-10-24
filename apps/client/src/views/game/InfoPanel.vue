<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useGame } from '../../game/game';
import { defenceTip, heroFace, heroStateName, heroTip, soldierTip } from '../../game/units';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/** UserInfo.InfoPanel: lord info, current city summary, resources and the city list. */
const game = useGame();
const user = game.user;
const city = game.city;

const ROW_LABEL = { fontSize: 12, fontWeight: 'bold' } as const;
const ROW_VALUE = { fontSize: 12, color: 16777215, textAlign: 'left' } as const;

const rows = computed(() => [
  {
    y: 12,
    key: 'UserInfo_InfoPanel_2_1',
    color: 16247152,
    value: user.username,
    plus: 'UserInfo_InfoPanel_36_1',
  },
  { y: 39, key: 'UserInfo_InfoPanel_3_1', color: 3730432, value: user.prestige },
  { y: 66, key: 'UserInfo_InfoPanel_4_1', color: 3730432, value: user.rank },
  { y: 93, key: 'UserInfo_InfoPanel_5_1', color: 55551, value: user.officepos },
  {
    y: 120,
    key: 'UserInfo_InfoPanel_6_1',
    color: 55551,
    value: user.nobility,
    plus: 'UserInfo_InfoPanel_37_1',
  },
  { y: 147, key: 'UserInfo_InfoPanel_7_1', color: 11309055, value: user.unionname },
  { y: 174, key: 'UserInfo_InfoPanel_8_1', color: 11309055, value: user.unionPosName },
]);

const GREEN = 65280;
const RED = 16711680;
/** `mFoodAddColorRed`: zero keeps the last color. */
const foodColor = ref(GREEN);
watchEffect(() => {
  const net = city.food_add - city.food_army_use;
  if (net > 0) foodColor.value = GREEN;
  else if (net < 0) foodColor.value = RED;
});

const resources = computed(() => [
  {
    icon: 'images/resource_food.png',
    amount: Math.floor(city.food_real),
    add: Math.floor(city.food_add - city.food_army_use),
    color: foodColor.value,
    tips: ['UserInfo_InfoPanel_23_1', 'UserInfo_InfoPanel_30_1', 'UserInfo_InfoPanel_31_1'],
  },
  {
    icon: 'images/resource_wood.png',
    amount: Math.floor(city.wood_real),
    add: Math.floor(city.wood_add),
    color: GREEN,
    tips: ['UserInfo_InfoPanel_25_1', 'UserInfo_InfoPanel_28_1', 'UserInfo_InfoPanel_32_1'],
  },
  {
    icon: 'images/resource_rock.png',
    amount: Math.floor(city.rock_real),
    add: Math.floor(city.rock_add),
    color: GREEN,
    tips: ['UserInfo_InfoPanel_24_1', 'UserInfo_InfoPanel_29_1', 'UserInfo_InfoPanel_33_1'],
  },
  {
    icon: 'images/resource_iron.png',
    amount: Math.floor(city.iron_real),
    add: Math.floor(city.iron_add),
    color: GREEN,
    tips: ['UserInfo_InfoPanel_26_1', 'UserInfo_InfoPanel_27_1', 'UserInfo_InfoPanel_34_1'],
  },
]);

const TABS = ['ButtonResource', 'ButtonCommander', 'ButtonArmy', 'ButtonDefence'] as const;
const tab = ref(0);
/** `onChangeViewStack`: the unit tabs refresh their list on open. */
function selectTab(i: number): void {
  tab.value = i;
  if (i > 0) void game.cmd.sendCityCommand(i);
}

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const grid = (i: number, xs: [number, number], rowH: number) => ({
  x: (i & 1) === 0 ? xs[0] : xs[1],
  y: Math.floor(i / 2) * rowH + 8,
});

const heroes = computed(() =>
  city.heroes.map((h, i) => ({
    key: String(h.hid ?? i),
    ...grid(i, [8, 125], 47),
    name: String(h.name ?? ''),
    level: `${String(h.level ?? '')}${i18n('Hero_InfoHeroItem_1_1')}`,
    state: heroStateName(h),
    face: heroFace(h, user.usersex, user.userface),
    tip: heroTip(h),
  })),
);

const soldiers = computed(() =>
  game.global.soldiers
    .filter((s) => String(s.fromcity) === '1')
    .map((s, i) => ({
      key: int(s.sid),
      ...grid(i, [6, 124], 40),
      icon: `images/army_${int(s.sid)}.png`,
      name: String(s.name ?? ''),
      count: city.soldierCounts[int(s.sid)] ?? 0,
      tip: soldierTip(s),
    })),
);

const defences = computed(() =>
  game.global.defences.slice(0, 5).map((d, i) => ({
    key: int(d.did),
    ...grid(i, [6, 124], 40),
    icon: `images/defence_${int(d.did)}.png`,
    name: String(d.name ?? ''),
    count: city.defenceCounts[int(d.did)] ?? 0,
    tip: defenceTip(d),
  })),
);

const units = computed(() => (tab.value === 2 ? soldiers.value : defences.value));

/** `selectCityLabel`: name followed by the (x,y) position. */
const cityLabels = computed(() => user.cities.map((c) => c.name + c.position));
const cityIndex = computed({
  get: () => Math.max(0, user.cityIndex),
  set: (i: number) => {
    const target = user.cities[i];
    if (target) game.switchCity(target.cid);
  },
});
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="264" :h="600">
    <FxImage :x="1" :y="0" source="images/leftboard_new.jpg" />
    <FxCanvas :left="2" :right="8" :top="2" :h="210">
      <FxCanvas :x="11" :y="13" :w="68" :h="84" style-name="FramePicture">
        <FxImage :x="2" :y="2" :w="64" :h="80" :source="user.faceImage" hand />
        <FxLabel
          class="glow"
          :x="0"
          :y="-1"
          :w="68"
          :fx="{ color: 16777215, textAlign: 'left', fontSize: 13, fontWeight: 'bold' }"
          :text="user.kingHeroLevel"
          :tip="i18n('King_Info_level')"
        />
        <FxImage
          :x="57"
          :y="71"
          source="images/small_star.png"
          :tip="i18n('UserInfo_king_level_tip') + user.kingLevel"
        />
      </FxCanvas>
      <FxCanvas
        v-for="row in rows"
        :key="row.key"
        :x="84"
        :y="row.y"
        :w="161"
        :h="24"
        style-name="BoardListDown"
      >
        <FxLabel
          :x="5"
          :y="2"
          hand
          :fx="{ ...ROW_LABEL, color: row.color }"
          :text="i18n(row.key)"
        />
        <FxLabel :x="50" :y="3" :w="105" :fx="ROW_VALUE" :text="row.value" />
        <FxButton v-if="row.plus" :x="150" :y="8" style-name="Plus" :tip="i18n(row.plus)" />
      </FxCanvas>
      <FxButton :x="13" :y="102" style-name="King" />
      <FxButton :x="13" :y="135" style-name="Armor" />
      <FxButton :x="13" :y="168" style-name="Inventory" @click="game.showDialog('myGoods')" />
    </FxCanvas>

    <FxCanvas :y="210" :h="102" :left="6" :right="6" style-name="PanelGreyBlue">
      <FxLabel
        :x="38"
        :y="31"
        :w="30"
        :fx="{ fontSize: 12, color: 15793920 }"
        :text="city.morale"
        :tip="i18n('UserInfo_InfoPanel_9_1')"
      />
      <FxLabel :x="65" :y="31" :fx="{ fontSize: 12, color: 16777215 }" text="/" />
      <FxLabel
        :x="74"
        :y="31"
        :w="29"
        :fx="{ fontSize: 12, color: 16762368 }"
        :text="city.complaint"
        :tip="i18n('UserInfo_InfoPanel_10_1')"
      />
      <FxLabel
        :x="149"
        :y="31"
        :w="50"
        :fx="{ fontSize: 12, color: 16777215 }"
        :text="`${city.tax}%`"
        :tip="i18n('UserInfo_InfoPanel_11_1')"
      />
      <FxLabel
        :x="38"
        :y="52"
        :w="80"
        :fx="{ fontSize: 12, color: 16777215 }"
        :text="Math.round(city.gold)"
        :tip="i18n('UserInfo_InfoPanel_12_1')"
      />
      <FxLabel
        :x="38"
        :y="73"
        :w="80"
        :fx="{ fontSize: 12, color: 16777215 }"
        :text="city.people_all"
        :tip="i18n('UserInfo_InfoPanel_13_1')"
      />
      <FxLabel
        :x="118"
        :y="52"
        :w="65"
        :fx="{ fontSize: 12, textAlign: 'center', color: city.gold_add < 0 ? RED : GREEN }"
        :text="city.gold_add"
        :tip="i18n('UserInfo_InfoPanel_14_1')"
      />
      <FxLabel
        :x="118"
        :y="73"
        :w="65"
        :fx="{ fontSize: 12, textAlign: 'center', color: city.people_free < 0 ? RED : GREEN }"
        :text="city.people_free"
        :tip="i18n('UserInfo_InfoPanel_15_1')"
      />
      <FxImage :x="14" :y="30" :w="20" :h="19" source="images/city_popularity.png" hand />
      <FxImage
        :x="125"
        :y="32"
        :w="20"
        :h="19"
        source="images/city_tax.png"
        hand
        :tip="i18n('UserInfo_InfoPanel_16_1')"
      />
      <FxImage :x="14" :y="51" :w="20" :h="19" source="images/city_gold.png" hand />
      <FxImage :x="14" :y="71" :w="20" :h="19" source="images/city_population.png" hand />
      <FxButton :x="190" :y="58" style-name="Plus" :tip="i18n('UserInfo_InfoPanel_17_1')" />
      <FxButton :x="101" :y="37" style-name="Plus" :tip="i18n('UserInfo_InfoPanel_18_1')" />
      <FxButton :x="190" :y="78" style-name="Plus" :tip="i18n('UserInfo_InfoPanel_19_1')" />
      <FxButton
        :x="218"
        :y="31"
        style-name="MyCityBuilding"
        :tip="i18n('UserInfo_InfoPanel_20_1')"
        @click="game.showDialog('buildingList')"
      />
      <FxButton
        :x="218"
        :y="52"
        style-name="MyCityLabor"
        :tip="i18n('UserInfo_InfoPanel_21_1')"
        @click="game.showDialog('resourceProduct')"
      />
      <FxButton
        :x="218"
        :y="73"
        style-name="MyCityField"
        :tip="i18n('UserInfo_InfoPanel_22_1')"
        @click="game.showCityFieldDialog()"
      />
    </FxCanvas>

    <FxCanvas style-name="PanelGreyGrey" :top="312" :bottom="6" :left="6" :right="6">
      <FxCanvas v-if="tab === 0" :y="32" :h="250" :left="0" :right="0">
        <template v-for="(r, i) in resources" :key="r.icon">
          <FxCanvas :x="11" :y="8 + 30 * i" :w="35" :h="25" style-name="BoardListUp">
            <FxImage :x="5" :y="-1" :w="30" :h="27" :source="r.icon" hand />
          </FxCanvas>
          <FxCanvas :x="49" :y="8 + 30 * i" :w="102" :h="25" style-name="BoardListDown">
            <FxLabel
              :left="0"
              :right="2"
              :y="3"
              :fx="{ color: 16777215, textAlign: 'right' }"
              :text="r.amount"
              :tip="i18n(r.tips[0]!)"
            />
          </FxCanvas>
          <FxCanvas :x="155" :y="8 + 30 * i" :w="75" :h="25" style-name="BoardListDown">
            <FxLabel
              :left="0"
              :right="2"
              :y="3"
              :fx="{ color: r.color, textAlign: 'right' }"
              :text="r.add"
              :tip="i18n(r.tips[1]!)"
            />
          </FxCanvas>
          <FxButton :x="232" :y="[16, 47, 77, 106][i]" style-name="Plus" :tip="i18n(r.tips[2]!)" />
        </template>
        <FxImage :x="6" :y="126" source="images/line_leftboard.png" />
      </FxCanvas>
      <FxCanvas v-else-if="tab === 1" :y="32" :h="250" :left="0" :right="0" scroll-y>
        <FxCanvas v-for="h in heroes" :key="h.key" :x="h.x" :y="h.y" :w="122" :h="40">
          <FxCanvas :x="4" :y="0" :w="33" :h="40" style-name="FramePicture">
            <FxImage :x="2" :y="2" :w="29" :h="36" :source="h.face" :tip="h.tip" />
          </FxCanvas>
          <FxCanvas :x="40" :y="0" :w="80" :h="40" style-name="BoardListDown">
            <FxLabel
              :x="4"
              :y="2"
              :w="75"
              :fx="{ fontSize: 12, color: 12368744, fontWeight: 'bold' }"
              :text="h.name"
            />
            <FxLabel
              :x="4"
              :y="20"
              :w="45"
              :fx="{ fontSize: 12, color: 16777215 }"
              :text="h.level"
            />
            <FxLabel
              :x="44"
              :y="20"
              :w="32"
              :fx="{ fontSize: 12, color: 4179426, textAlign: 'center' }"
              :text="h.state"
            />
          </FxCanvas>
        </FxCanvas>
      </FxCanvas>
      <FxCanvas v-else :y="32" :h="250" :left="0" :right="0" scroll-y>
        <FxCanvas v-for="u in units" :key="u.key" :x="u.x" :y="u.y" :w="122" :h="39">
          <FxCanvas :x="4" :y="0" :w="47" :h="38" style-name="BoardListUp">
            <FxImage :x="3" :y="2" :w="40" :h="32" :source="u.icon" :tip="u.tip" />
          </FxCanvas>
          <FxCanvas :x="53" :y="0" :w="66" :h="37" style-name="BoardListDown">
            <FxLabel
              :x="0"
              :y="0"
              :fx="{ fontSize: 12, color: 13549421, fontWeight: 'bold' }"
              :text="u.name"
            />
            <FxLabel
              :x="0"
              :y="14"
              :w="57"
              :fx="{ fontSize: 12, textAlign: 'right' }"
              :text="u.count"
            />
          </FxCanvas>
        </FxCanvas>
      </FxCanvas>
      <FxButton
        v-for="(name, i) in TABS"
        :key="name"
        :x="6 + 60 * i"
        :y="9"
        :w="60"
        :h="26"
        :style-name="name"
        :selected="tab === i"
        @button-down="selectTab(i)"
      />
    </FxCanvas>

    <FxCanvas :y="203" :left="7" :right="5">
      <FxImage :x="0" :y="3" :w="252" source="images/title.png" />
      <FxComboBox
        v-model:selected-index="cityIndex"
        :items="cityLabels"
        :x="47"
        :y="8"
        :w="171"
        :h="18"
        :row-count="16"
        style-name="InfoComboBox"
        :fx="{ fontSize: 12, textAlign: 'center', fontWeight: 'normal' }"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.glow {
  text-shadow:
    0 0 2px #000,
    0 0 2px #000,
    0 0 2px #000;
}
</style>
