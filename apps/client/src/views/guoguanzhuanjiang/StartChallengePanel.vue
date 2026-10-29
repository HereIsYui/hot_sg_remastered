<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LadderHero, PickerHero } from '../../game/campaign-pk';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import SelectHeroPanel from './SelectHeroPanel.vue';

/**
 * GuoGuanZhanJiang.StartChallengePanel (`showEnterBattlePanel`): the floor chosen on the ladder
 * — three NPC heroes of the level against three own slots. Clicking a slot opens the
 * SelectHeroPanel (`doShowHeroDialog` sends getAllHeroByUid); 出战 sends
 * `campaign/getOneBattleRet [battleid, flag, levelid, [hid1, hid2, hid3]]` and the reply's battle
 * is played by the shared HeroBattlePanel.
 */
const props = defineProps<{
  chapter: number;
  flag: number;
  levelid: number;
  battleName: string;
  intro: string;
  totalFloors: number;
  passedFloors: number;
  enemyHeroes: (LadderHero | null)[];
}>();
const emit = defineEmits<{
  battle: [hids: number[], names: Record<number, string>];
  back: [];
  close: [];
}>();

const slots = ref<(PickerHero | null)[]>([null, null, null]);
const openSlot = ref(0);

const powerOf = (hero: LadderHero | PickerHero | null): number => {
  if (!hero) return 0;
  return Math.trunc(Number(hero.attack ?? 0) + Number(hero.blood ?? 0) / 10);
};
const enemyPower = computed(() => props.enemyHeroes.reduce((sum, h) => sum + powerOf(h), 0));
const ownPower = computed(() => slots.value.reduce((sum, h) => sum + powerOf(h as PickerHero), 0));

/** `doShowHeroDialog(slot)`: the picker opens for that slot. */
function showHeroDialog(slot: number): void {
  openSlot.value = slot;
}

/** `onShowBattleDialog`: all three slots filled, the level gate checked on the server side too. */
function startBattle(): void {
  const hids = slots.value.map((h) => Number(h?.hid ?? 0));
  if (hids.some((hid) => hid <= 0)) {
    void showAlert(i18n('Hero_Battle_Dialog_battle_hero_must_three'));
    return;
  }
  const names: Record<number, string> = {};
  props.enemyHeroes.forEach((h) => {
    if (h) names[Number(h.hid)] = String(h.name ?? '');
  });
  slots.value.forEach((h) => {
    if (h) names[Number(h.hid)] = String(h.name ?? '');
  });
  emit('battle', hids, names);
}
</script>

<template>
  <FxCanvas :w="733" :h="525" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="240" :y="14" source="images/title.png" />
    <FxLabel
      :y="20"
      :w="733"
      :h="18"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Hero_Battle_Dialog_title')"
    />
    <!-- 挑战将领 -->
    <FxCanvas :x="10" :y="48" :w="518" :h="196" style-name="BoardListUp" :fx="{ color: 16777215 }">
      <FxCanvas :x="20" :y="11" :w="100" :h="30" style-name="BoardListDown" :fx="{ fontSize: 13 }">
        <FxLabel
          :w="100"
          style-name="ItemValue"
          :fx="{ paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
          :text="i18n('Hero_Battle_Dialog_battle_startPanel_hero_1')"
        />
      </FxCanvas>
      <FxCanvas :x="130" :y="12" :w="150" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :w="70"
          style-name="ItemValue"
          :fx="{ paddingTop: 7, textAlign: 'right' }"
          :text="i18n('Hero_Battle_Dialog_battle_startPanel_battle_1')"
        />
        <FxLabel
          :x="70"
          :w="80"
          style-name="ItemValue"
          :fx="{ paddingTop: 7, textAlign: 'left' }"
          :text="String(enemyPower)"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="61" :w="500" :h="118" style-name="BoardListDown">
        <template v-for="(hero, i) in props.enemyHeroes" :key="i">
          <FxCanvas :x="5 + i * 165" :y="5" :w="64" :h="80" style-name="BoardListDown">
            <FxImage
              :w="64"
              :h="80"
              :source="hero?.heroImage ?? null"
              :tip="String(hero?.name ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="5 + i * 165" :y="87" :w="64" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="64"
              :h="25"
              style-name="ItemValue"
              :fx="{ textAlign: 'center', paddingTop: 3 }"
              :text="String(hero?.name ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + i * 165" :y="6" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              style-name="ItemTitle"
              :fx="{ color: 16005176, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_HeroDetailDialog_23_1')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :fx="{ paddingTop: 5, textAlign: 'right', fontWeight: 'bold' }"
              :text="String(hero?.attack ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + i * 165" :y="33" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              style-name="ItemTitle"
              :fx="{ color: 15057438, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_HeroDetailDialog_25_1')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :fx="{ paddingTop: 5, textAlign: 'right', fontWeight: 'bold' }"
              :text="String(hero?.defence ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + i * 165" :y="61" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              style-name="ItemTitle"
              :fx="{ color: 2227243, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_HeroDetailDialog_21_1')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :fx="{ paddingTop: 5, textAlign: 'right', fontWeight: 'bold' }"
              :text="String(hero?.speed ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + i * 165" :y="88" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              :fx="{ color: 16777215, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_7')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :text="String(i + 1)"
              :fx="{ color: 16777215, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
            />
          </FxCanvas>
        </template>
      </FxCanvas>
    </FxCanvas>
    <!-- 我方将领 -->
    <FxCanvas :x="10" :y="252" :w="518" :h="229" style-name="BoardListUp" :fx="{ color: 16777215 }">
      <FxCanvas :x="20" :y="16" :w="100" :h="30" style-name="BoardListDown" :fx="{ fontSize: 13 }">
        <FxLabel
          :w="100"
          style-name="ItemValue"
          :fx="{ paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
          :text="i18n('Hero_Battle_Dialog_battle_startPanel_hero_2')"
        />
      </FxCanvas>
      <FxCanvas :x="130" :y="16" :w="150" :h="30" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :w="70"
          style-name="ItemValue"
          :fx="{ paddingTop: 7, textAlign: 'right' }"
          :text="i18n('Hero_Battle_Dialog_battle_startPanel_battle_1')"
        />
        <FxLabel
          :x="70"
          :w="80"
          style-name="ItemValue"
          :fx="{ paddingTop: 7, textAlign: 'left' }"
          :text="String(ownPower)"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="58" :w="500" :h="118" style-name="BoardListDown">
        <template v-for="i in 3" :key="i">
          <FxCanvas :x="5 + (i - 1) * 165" :y="5" :w="64" :h="80" style-name="BoardListDown">
            <FxImage
              :w="64"
              :h="80"
              :source="slots[i - 1]?.heroImage ?? 'images/select_hero_bg.png'"
              :tip="String(slots[i - 1]?.name ?? '')"
              hand
              @click="showHeroDialog(i - 1)"
            />
            <FxText
              v-if="!slots[i - 1]"
              :w="64"
              :h="80"
              :fx="{ textAlign: 'center', paddingTop: 25, color: 16777215 }"
              :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_6')"
            />
          </FxCanvas>
          <FxCanvas :x="5 + (i - 1) * 165" :y="87" :w="64" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="64"
              :h="25"
              style-name="ItemValue"
              :fx="{ textAlign: 'center', paddingTop: 3 }"
              :text="String(slots[i - 1]?.name ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + (i - 1) * 165" :y="6" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              style-name="ItemTitle"
              :fx="{ color: 16005176, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_HeroDetailDialog_23_1')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :fx="{ paddingTop: 5, textAlign: 'right', fontWeight: 'bold' }"
              :text="String(slots[i - 1]?.attack ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + (i - 1) * 165" :y="33" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              style-name="ItemTitle"
              :fx="{ color: 15057438, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_HeroDetailDialog_25_1')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :fx="{ paddingTop: 5, textAlign: 'right', fontWeight: 'bold' }"
              :text="String(slots[i - 1]?.defence ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + (i - 1) * 165" :y="61" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              style-name="ItemTitle"
              :fx="{ color: 2227243, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_HeroDetailDialog_21_1')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :fx="{ paddingTop: 5, textAlign: 'right', fontWeight: 'bold' }"
              :text="String(slots[i - 1]?.speed ?? '')"
            />
          </FxCanvas>
          <FxCanvas :x="73 + (i - 1) * 165" :y="88" :w="90" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="40"
              :h="25"
              :fx="{ color: 16777215, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
              :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_7')"
            />
            <FxLabel
              :x="39"
              :w="50"
              :h="25"
              :text="String(i)"
              :fx="{ color: 16777215, paddingTop: 5, textAlign: 'center', fontWeight: 'bold' }"
            />
          </FxCanvas>
        </template>
      </FxCanvas>
      <FxLabel
        :x="9"
        :y="192"
        :w="178"
        :h="29"
        :fx="{ textAlign: 'left', paddingTop: 11, fontWeight: 'bold', color: 16711680 }"
        :tip="i18n('Hero_Battle_Dialog_battle_startPanel_hint_tips')"
        :text="i18n('Hero_Battle_Dialog_battle_startPanel_hint')"
      />
      <FxButton :x="391" :y="177" style-name="startBattle" @click="startBattle" />
    </FxCanvas>
    <!-- chapter info -->
    <FxCanvas :x="536" :y="48" :w="189" :h="433" style-name="BoardListUp" :fx="{ color: 16777215 }">
      <FxCanvas :x="29" :y="32" :w="130" :h="37" style-name="BoardListDown" :fx="{ fontSize: 14 }">
        <FxLabel
          :w="130"
          style-name="ItemValue"
          :fx="{ paddingTop: 7, textAlign: 'center', fontWeight: 'bold' }"
          :text="props.battleName"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="77" :w="169" :h="99" style-name="BoardListDown" :fx="{ fontSize: 14 }">
        <FxCanvas :x="5" :y="10" :w="149" :h="35" :fx="{ fontSize: 12 }">
          <FxLabel
            :x="3"
            :w="70"
            :fx="{ textAlign: 'right', paddingTop: 5 }"
            :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_1')"
          />
          <FxLabel
            :x="93"
            :w="26"
            :fx="{ textAlign: 'center', paddingTop: 5 }"
            :text="String(props.totalFloors)"
          />
          <FxLabel
            :x="118"
            :w="28"
            :fx="{ textAlign: 'left', paddingTop: 5 }"
            :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_2')"
          />
        </FxCanvas>
        <FxCanvas :x="5" :y="50" :w="149" :h="35" :fx="{ fontSize: 12 }">
          <FxLabel
            :x="3"
            :w="70"
            :fx="{ textAlign: 'right', paddingTop: 5 }"
            :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_3')"
          />
          <FxLabel
            :x="73"
            :w="30"
            :fx="{ textAlign: 'center', paddingTop: 5 }"
            :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_4')"
          />
          <FxLabel
            :x="95"
            :w="26"
            :fx="{ textAlign: 'center', paddingTop: 5 }"
            :text="String(props.passedFloors)"
          />
          <FxLabel
            :x="118"
            :w="28"
            :fx="{ textAlign: 'left', paddingTop: 5 }"
            :text="i18n('Hero_Battle_Dialog_battle_startPanel_1_2')"
          />
        </FxCanvas>
      </FxCanvas>
      <FxCanvas
        :x="10"
        :y="184"
        :w="169"
        :h="239"
        style-name="BoardListDown"
        :fx="{ fontSize: 13 }"
      >
        <FxText :x="7" :y="6" :w="154" :h="223" :text="props.intro" />
      </FxCanvas>
    </FxCanvas>
    <FxButton :x="658" :y="481" :w="65" style-name="Close" @click="emit('close')" />
    <FxButton
      :x="585"
      :y="482"
      :w="65"
      style-name="ButtonGreen"
      :label="i18n('Hero_Battle_Dialog_StartChalleng_return')"
      @click="emit('back')"
    />
    <SelectHeroPanel
      v-if="openSlot >= 0"
      :slot-index="openSlot"
      :selected="slots.filter((h): h is PickerHero => !!h)"
      @select="(slot, hero) => (slots[slot] = hero)"
      @drop="(slot) => (slots[slot] = null)"
      @close="openSlot = -1"
    />
  </FxCanvas>
</template>
