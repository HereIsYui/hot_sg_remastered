<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { parseAllHeroByUid, type PickerHero } from '../../game/campaign-pk';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import HeroItem from './HeroItem.vue';

/**
 * GuoGuanZhanJiang.SelectHeroPanel: the shared own-hero picker of the ladder panels (also the
 * arena's, via the `ArenaBattle` action). `getAllHeroByUid [selectedHids, page]` fills ten rows
 * per page by 勇气; page 1 appends the king hero when it is free. Confirming hands the hero to
 * the opener through `select`; 卸下 clears the slot instead (`doDropHero`).
 */
const props = defineProps<{ slotIndex: number; selected: PickerHero[] }>();
const emit = defineEmits<{
  select: [slot: number, hero: PickerHero];
  drop: [slot: number];
  close: [];
}>();

const game = useGame();
const page = ref(1);
const rows = ref<PickerHero[]>([]);
const king = ref<PickerHero | null>(null);

const selectedHids = computed(() => props.selected.map((h) => Number(h.hid)));

/** `SelectHeroPanel.onPrev` / `onNext`: `[selectedHids, page]` (`getAllHeroByUid`). */
function load(p: number): void {
  game.sendGlobalCommand('campaign', 'getAllHeroByUid', [selectedHids.value, p]);
}

onMounted(() => load(1));

const unregister = game.addGlobalReceiver('campaign', (command, data) => {
  if (command !== 'getAllHeroByUid') return;
  const parsed = parseAllHeroByUid(data);
  rows.value = parsed.list;
  king.value = parsed.king;
  page.value = parsed.page;
});
onUnmounted(unregister);

/** `onPrev`. */
function onPrev(): void {
  if (page.value > 1) load(page.value - 1);
}
/** `onNext`. */
function onNext(): void {
  load(page.value + 1);
}

/** `HeroItem.doSelectHero`: an already picked hero is dropped instead. */
function onPick(hero: PickerHero): void {
  if (selectedHids.value.includes(Number(hero.hid))) {
    dropHero(hero);
    return;
  }
  emit('select', props.slotIndex, hero);
  emit('close');
}

/** `doDropHero`: clears the slot this panel was opened for. */
function dropHero(hero?: PickerHero): void {
  if (props.selected.length > 0 || hero) emit('drop', props.slotIndex);
  else void showAlert(i18n('Hero_Battle_Dialog_selectHero_no_drop'));
  emit('close');
}
</script>

<template>
  <FxCanvas :x="190" :y="38" :w="290" :h="400" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="19" :y="14" source="images/title.png" />
    <FxLabel
      :y="19"
      :w="290"
      :h="18"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Hero_Battle_Dialog_selectHero_title')"
    />
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
          @select="onPick"
        />
        <!-- the king hero loads onto the first page (PKFunc.php:545) -->
        <HeroItem
          v-if="king && !selectedHids.includes(Number(king.hid))"
          :item="king"
          :hero-image="king.heroImage"
          :tip="king.heroImage"
          :style="{
            position: 'absolute',
            left: '5px',
            top: `${8 + Math.ceil(rows.length / 2) * 45}px`,
          }"
          @select="onPick"
        />
      </div>
    </FxCanvas>
    <FxCanvas :x="44" :y="290" :w="216" :h="40" :fx="{ fontSize: 13 }">
      <FxButton
        :x="1"
        :y="3"
        :w="73"
        style-name="ButtonRed"
        :label="i18n('new_shop_button_14_1')"
        @click="onPrev"
      />
      <FxCanvas :x="72" :y="8" :w="70" :h="25" style-name="BoardListDown">
        <FxLabel
          :w="70"
          :h="25"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold', paddingTop: 3 }"
          :text="`${i18n('Hero_Battle_Dialog_select_hero_1')}${page}${i18n('Hero_Battle_Dialog_select_hero_2')}`"
        />
      </FxCanvas>
      <FxButton
        :x="140"
        :y="3"
        :w="73"
        style-name="ButtonRed"
        :label="i18n('new_shop_button_14_2')"
        @click="onNext"
      />
    </FxCanvas>
    <FxButton
      :x="62"
      :y="350"
      :w="72"
      style-name="ButtonGreen"
      :label="i18n('Hero_Battle_Dialog_selectHero_drop_btn')"
      @click="dropHero()"
    />
    <FxButton :x="173" :y="351" :w="72" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>

<style scoped>
.rows {
  position: relative;
  min-height: 238px;
}
</style>
