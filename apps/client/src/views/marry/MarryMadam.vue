<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { favorStage, FAVOR_STAGES, parseMadams, type Madam } from '../../game/marry';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * MarrySystem.MarryMadam: the 天降麟儿 tab. `loadMarryMadam` lists the wives with their rooms,
 * favour and pregnancy state; 送礼 adds favour (`addMadamFavor [type, hid]`, type 2 夫人), a full favour and a
 * free room start the pregnancy (`checkRoomCount [hid]`), 催产 speeds it (`doSpeedFeta [hid]`),
 * and 接生 lands the child (`getMadamChild [sex, hid]`, MarrySystemFunc.php:319).
 */
const game = useGame();

const madams = ref<Madam[]>([]);
const page = ref(1);
const selectIndex = ref(0);
/** the newborn's sex checkbox of the delivery (`_curSelectedType`, AS3:2216). */
const deliverSex = ref(1);

const PAGE_SIZE = 9;
const curMadams = computed(() =>
  madams.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
const totalPage = computed(() => Math.max(1, Math.ceil(madams.value.length / PAGE_SIZE)));
const selected = computed(
  () => madams.value[(page.value - 1) * PAGE_SIZE + selectIndex.value] ?? null,
);
const stages = computed(() => FAVOR_STAGES.map((k) => i18n(k)));
const stageColors = [7699268, 5409106, 1863876, 6710937];

const unregister = game.addGlobalReceiver('MarrySystem', (command, data) => {
  if (command === 'loadMarryMadam') {
    madams.value = parseMadams(data);
    selectIndex.value = 0;
  } else if (
    command === 'addMadamFavor' ||
    command === 'doSpeedFeta' ||
    command === 'openChildRoom'
  ) {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) gameAlert(String(d.shift() ?? ''));
    game.sendGlobalCommand('MarrySystem', 'loadMarryMadam');
  } else if (command === 'checkRoomCount') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) gameAlert(String(d.shift() ?? ''));
    game.sendGlobalCommand('MarrySystem', 'loadMarryMadam');
  }
});
onUnmounted(unregister);

/** `MarryMadam.sendGift`: favour gift of the madam's next tier (`addMadamFavor [type, hid]`). */
function sendGift(): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'addMadamFavor', [2, selected.value.hid]);
}

/** `checkRoomCount` (AS3:2379): start the pregnancy when the favour is full. */
function startPregnancy(): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'checkRoomCount', [selected.value.hid]);
}

/** `doSpeedFeta [hid]`: 金牌稳婆 (500 元宝, -30% pregnancy time). */
function speedFeta(): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'doSpeedFeta', [selected.value.hid]);
}

/** `getMadamChild [sex, hid]` (AS3:2216): the delivery asks the newborn's sex first. */
function deliver(sex: number): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'getMadamChild', [sex, selected.value.hid]);
}

function onPrev(): void {
  if (page.value > 1) page.value--;
}
function onNext(): void {
  if (page.value < totalPage.value) page.value--;
}

const sexName = (m: Madam) =>
  Number(m.sex) === 0 ? i18n('Marry_System_madam_type_1') : i18n('Marry_System_madam_type_2');
const stateName = (m: Madam): string => {
  const state = Number(m.state);
  if (state === 1) return i18n('Marry_System_culture_function_1');
  if (state === 2) return i18n('Marry_System_during_1');
  if (state === 3) return i18n('Marry_System_accouche_type_tip_1');
  return '';
};
const canDeliver = (m: Madam): boolean => Number(m.state) === 3;
const leftDuring = (m: Madam): string =>
  Number(m.leaveDuringTime) > 0 ? String(m.leaveDuringTime) : '--';
</script>

<template>
  <FxCanvas :w="625" :h="353" style-name="BoardListDown" :fx="{ fontSize: 12 }">
    <FxCanvas :x="13" :y="15" :w="117" :h="299" style-name="BoardListDown">
      <FxCanvas
        v-for="(madam, i) in curMadams"
        :key="madam.hid"
        :x="4"
        :y="3 + i * 29"
        :w="110"
        :h="28"
        :fx="{
          backgroundColor: i === selectIndex ? 5409106 : 0,
          backgroundAlpha: i === selectIndex ? 0.6 : 0,
        }"
        hand
        @click="selectIndex = i"
      >
        <FxLabel
          :x="4"
          :y="5"
          :w="100"
          :fx="{ color: 16777215 }"
          :text="String(madam.name ?? '')"
        />
      </FxCanvas>
      <FxCanvas v-if="totalPage > 1" :x="5" :y="314" :w="140" :h="35">
        <FxButton :y="1" :w="65" :h="33" :label="i18n('Shop_ShopDialog_2_1')" @click="onPrev" />
        <FxButton
          :x="70"
          :y="1"
          :w="65"
          :h="33"
          :label="i18n('Shop_ShopDialog_3_1')"
          @click="onNext"
        />
      </FxCanvas>
    </FxCanvas>
    <FxCanvas :x="158" :y="18" :w="73" :h="88" style-name="BoardListDown">
      <FxImage
        :x="4"
        :y="3"
        :w="64"
        :h="80"
        :source="selected?.heroImage ?? null"
        :tip="String(selected?.name ?? '')"
      />
    </FxCanvas>
    <FxText
      :x="235"
      :y="17"
      :w="79"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Hero_HeroDetailDialog_6_1')"
    />
    <FxCanvas :x="314" :y="17" :w="120" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="120"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(selected?.name ?? '')"
      />
    </FxCanvas>
    <FxText
      :x="235"
      :y="49"
      :w="79"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Marry_System_madam_child_count')"
    />
    <FxCanvas :x="314" :y="49" :w="120" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="120"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(selected?.count ?? '')"
      />
    </FxCanvas>
    <FxText
      :x="235"
      :y="81"
      :w="79"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Marry_System_culture_good_5')"
    />
    <FxCanvas :x="314" :y="81" :w="90" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="90"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(selected?.nextGidName ?? '')"
      />
    </FxCanvas>
    <FxText
      :x="407"
      :y="81"
      :w="79"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Marry_System_culture_good_6')"
    />
    <FxCanvas :x="484" :y="81" :w="60" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="60"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(selected?.nextGidCount ?? '')"
      />
    </FxCanvas>
    <!-- favour + actions -->
    <FxCanvas v-if="selected" :x="151" :y="110" :w="470" :h="233" style-name="BoardListDown">
      <FxCanvas :x="4" :y="16" :w="60" :h="50">
        <FxImage :w="55" :h="50" source="images/madam_favor_frame.png" />
        <FxLabel
          :x="6"
          :y="2"
          :w="45"
          :fx="{ color: 7915430, fontSize: 12, textAlign: 'center' }"
          :text="i18n('Hotel_JiejiaoHeroDialog_6_1')"
        />
        <FxLabel
          :x="7"
          :y="18"
          :w="45"
          :fx="{ color: 16777215, fontSize: 12, textAlign: 'center' }"
          :text="String(selected.favor)"
        />
      </FxCanvas>
      <FxCanvas
        v-for="i in 4"
        :key="i"
        :x="[26, 106, 226, 346][i - 1]"
        :y="61"
        :w="[80, 120, 120, 80][i - 1]"
        :h="40"
        style-name="BoardListUp"
        :fx="{ backgroundAlpha: 0.8 }"
      >
        <FxCanvas
          :x="3"
          :y="3"
          :w="[75, 115, 115, 75][i - 1]"
          :h="27"
          :fx="{
            backgroundColor: stageColors[i - 1]!,
            backgroundAlpha: favorStage(selected.favor) >= i - 1 ? 1 : 0.4,
          }"
        >
          <FxLabel
            :w="[75, 115, 115, 75][i - 1]"
            :h="27"
            :fx="{ textAlign: 'center', fontSize: 13, color: 15660323, paddingTop: 3 }"
            :text="stages[i - 1]"
          />
        </FxCanvas>
      </FxCanvas>
      <FxLabel
        :x="26"
        :y="110"
        :w="120"
        :fx="{ color: 16777215 }"
        :text="`${i18n('Marry_System_attri_sex')}: ${sexName(selected)}`"
      />
      <FxLabel
        :x="160"
        :y="110"
        :w="120"
        :fx="{ color: 16777215 }"
        :text="`${i18n('World_WorldActionDialogSrc_1')}: ${stateName(selected)}`"
      />
      <FxLabel
        v-if="Number(selected.state) === 2"
        :x="300"
        :y="110"
        :w="160"
        :fx="{ color: 16777215 }"
        :text="`${i18n('LuoYang_Battle_leaving_time')}${leftDuring(selected)}`"
      />
      <FxButton
        :x="26"
        :y="150"
        :w="90"
        :h="36"
        style-name="ButtonYellow"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_System_add_good')"
        :enabled="Number(selected.favor) < 100"
        @click="sendGift"
      />
      <FxButton
        :x="136"
        :y="150"
        :w="110"
        :h="36"
        style-name="ButtonYellow"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_System_culture_function_2')"
        :enabled="Number(selected.favor) >= 100 && selected.roomIsEnough"
        @click="startPregnancy"
      />
      <FxButton
        :x="266"
        :y="150"
        :w="90"
        :h="36"
        style-name="ButtonYellow"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_System_accouche_speed')"
        :enabled="Number(selected.state) === 2 && Number(selected.isSpeed) === 0"
        :tip="i18n('Marry_System_accouche_speed')"
        @click="speedFeta"
      />
      <!-- the delivery asks the newborn's sex (checkbox1/checkbox2, Marry_System_accouche_type_tip) -->
      <FxToggle
        type="RadioButton"
        :x="376"
        :y="140"
        :w="80"
        :label="i18n('Marry_System_accouche_type_tip_1')"
        :selected="deliverSex === 1"
        @change="(v: boolean) => v && (deliverSex = 1)"
      />
      <FxToggle
        type="RadioButton"
        :x="376"
        :y="165"
        :w="80"
        :label="i18n('Marry_System_accouche_type_tip_2')"
        :selected="deliverSex === 2"
        @change="(v: boolean) => v && (deliverSex = 2)"
      />
      <FxButton
        :x="470"
        :y="150"
        :w="80"
        :h="36"
        style-name="ButtonYellow"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_System_madam_type_2')"
        :enabled="canDeliver(selected)"
        @click="deliver(deliverSex)"
      />
    </FxCanvas>
  </FxCanvas>
</template>
