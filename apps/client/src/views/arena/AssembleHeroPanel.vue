<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { parseAllHeroByUid, type PickerHero } from '../../game/campaign-pk';
import { parseBattleHeroInfos } from '../../game/arena';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import HeroItem from '../guoguanzhuanjiang/HeroItem.vue';

/**
 * Arena.AssembleHeroPanel: the arena's 将领配置. `loadUserBattleHero` fills the three slots
 * (`mem_assemble_hero.hid1-3`), clicking one opens the hero picker (the 过关斩将 SelectHeroPanel
 * over the `ArenaBattle` action), and assembling sends
 * `holdBattleHeroInfo [hid1, hid2, hid3]` — the reply's message toasts and the panel closes.
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const slots = ref<(PickerHero | null)[]>([null, null, null]);
const page = ref(1);
const rows = ref<PickerHero[]>([]);
const king = ref<PickerHero | null>(null);
const openSlot = ref(-1);

const powerOf = (hero: PickerHero | null): number =>
  hero ? Math.trunc(Number(hero.attack ?? 0) + Number(hero.blood ?? 0) / 10) : 0;
const ownPower = computed(() => slots.value.reduce((sum, h) => sum + powerOf(h), 0));

/** `loadUserBattleHero` fills the slots on open. */
onMounted(() => game.sendGlobalCommand('ArenaBattle', 'loadUserBattleHero'));

const unregister = game.addGlobalReceiver('ArenaBattle', (command, data) => {
  if (command === 'loadUserBattleHero') {
    const heroes = parseBattleHeroInfos(data);
    slots.value = [0, 1, 2].map((i) => {
      const row = heroes[i];
      return row
        ? {
            ...(row as Record<string, unknown>),
            heroImage: `images/hero/hero_${Number(row.sex) === 0 ? 'girl_' : 'boy_'}${Number(row.face ?? 0)}.jpg`,
          }
        : null;
    }) as (PickerHero | null)[];
  } else if (command === 'getAllHeroByUid') {
    const parsed = parseAllHeroByUid(data);
    rows.value = parsed.list;
    king.value = parsed.king;
    page.value = parsed.page;
  } else if (command === 'holdBattleHeroInfo') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    gameAlert(String(d.shift() ?? ''));
    emit('close');
  }
});
onUnmounted(unregister);

/** `doShowHeroDialog(slot)`. */
function showHeroDialog(slot: number): void {
  openSlot.value = slot;
  const selected = slots.value.filter((h): h is PickerHero => !!h);
  game.sendGlobalCommand('ArenaBattle', 'getAllHeroByUid', [selected.map((h) => Number(h.hid)), 1]);
}

/** `AssembleHeroPanel.doDropHero` / SelectHeroPanel pick. */
function onPick(slot: number, hero: PickerHero): void {
  slots.value[slot] = hero;
  openSlot.value = -1;
}
function onDrop(slot: number): void {
  slots.value[slot] = null;
  openSlot.value = -1;
}

/** `AssembleHeroPanel.doSendHero`: `[hid1, hid2, hid3]`. */
function sendHeroInfo(): void {
  const hids = slots.value.map((h) => Number(h?.hid ?? 0));
  if (hids.some((hid) => hid <= 0)) {
    void showAlert(i18n('Hero_Battle_Dialog_battle_hero_must_three'));
    return;
  }
  game.sendGlobalCommand('ArenaBattle', 'holdBattleHeroInfo', hids);
}
</script>

<template>
  <FxCanvas :w="733" :h="525">
    <FxImage source="images/assemble_select_hero.jpg" />
    <FxCanvas
      :x="111"
      :y="168"
      :w="530"
      :h="229"
      style-name="PanelGreyGreen"
      :fx="{ fontSize: 12 }"
    >
      <FxImage :x="139" :y="12" source="images/title.png" />
      <FxLabel
        :y="17"
        :w="530"
        :h="18"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461 }"
        :text="i18n('Arena_Battle_first_title')"
      />
      <FxCanvas :w="508" :h="162" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
        <FxCanvas :x="8" :y="124" :w="150" :h="30" style-name="BoardListDown">
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
        <template v-for="i in 3" :key="i">
          <FxCanvas :x="7 + (i - 1) * 92" :y="7" :w="70" :h="85" style-name="BoardListDown">
            <FxImage
              :w="64"
              :h="80"
              :source="slots[i - 1]?.heroImage ?? 'images/select_hero_bg.png'"
              :tip="slots[i - 1]?.name ?? ''"
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
          <FxCanvas :x="7 + (i - 1) * 92" :y="92" :w="70" :h="25" style-name="BoardListDown">
            <FxLabel
              :w="70"
              :h="25"
              style-name="ItemValue"
              :fx="{ textAlign: 'center', paddingTop: 3 }"
              :text="String(slots[i - 1]?.name ?? '')"
            />
          </FxCanvas>
        </template>
      </FxCanvas>
      <FxButton
        :x="120"
        :y="190"
        :w="90"
        :h="34"
        style-name="ButtonYellow"
        :label="i18n('Arena_Battle_title_4')"
        @click="sendHeroInfo"
      />
      <FxButton :x="330" :y="190" :w="70" :h="34" style-name="Close" @click="emit('close')" />
    </FxCanvas>
    <FxCanvas v-if="openSlot >= 0" :x="190" :y="38" :w="290" :h="400" style-name="PanelGreyGreen">
      <FxCanvas :x="17" :y="54" :w="260" :h="238" style-name="BoardListUp" scroll-y>
        <div class="rows">
          <HeroItem
            v-for="(hero, i) in rows"
            :key="hero.hid"
            :item="hero"
            :hero-image="hero.heroImage"
            :tip="hero.heroImage"
            :style="{
              position: 'absolute',
              left: `${5 + (i % 2) * 128}px`,
              top: `${8 + Math.floor(i / 2) * 45}px`,
            }"
            @select="(hero) => onPick(openSlot, hero)"
          />
          <HeroItem
            v-if="king"
            :item="king"
            :hero-image="king.heroImage"
            :tip="king.heroImage"
            :style="{
              position: 'absolute',
              left: '5px',
              top: `${8 + Math.ceil(rows.length / 2) * 45}px`,
            }"
            @select="(hero) => onPick(openSlot, hero)"
          />
        </div>
      </FxCanvas>
      <FxCanvas :x="44" :y="290" :w="216" :h="40">
        <FxButton
          :x="1"
          :y="3"
          :w="73"
          style-name="ButtonRed"
          :label="i18n('new_shop_button_14_1')"
          @click="
            page > 1 &&
            game.sendGlobalCommand('ArenaBattle', 'getAllHeroByUid', [
              slots.filter((h): h is PickerHero => !!h).map((h) => Number(h.hid)),
              page - 1,
            ])
          "
        />
        <FxButton
          :x="140"
          :y="3"
          :w="73"
          style-name="ButtonRed"
          :label="i18n('new_shop_button_14_2')"
          @click="
            game.sendGlobalCommand('ArenaBattle', 'getAllHeroByUid', [
              slots.filter((h): h is PickerHero => !!h).map((h) => Number(h.hid)),
              page + 1,
            ])
          "
        />
      </FxCanvas>
      <FxButton :x="173" :y="351" :w="72" style-name="Close" @click="onDrop(openSlot)" />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.rows {
  position: relative;
  min-height: 238px;
}
</style>
