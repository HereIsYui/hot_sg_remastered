<script setup lang="ts">
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import type { TrickItemRow } from '../../game/trick';

/**
 * Trick/SelectHeroDialog (the 281x304 pop-up of TrickDialog): picks the hero to cast the chosen
 * trick with. `onShow` lists －－ plus the heroes in the city (state < 2 or 7 or 8 — free, chief,
 * general, adviser); `onSubmit` refuses the empty entry and reports the pick to TrickDialog.
 */
defineProps<{ trick: TrickItemRow }>();
const emit = defineEmits<{ use: [hid: number]; close: [] }>();

const city = useCityStore();

const selectedIndex = ref(0);

/** `SelectHeroDialog.onShow`: the free/in-city heroes of the current city. */
const heroes = computed(() => {
  const list: { heroname: string; hid: number }[] = [
    { heroname: i18n('Trick_SelectHeroDialog_6_1'), hid: 0 },
  ];
  for (const hero of city.heroes) {
    const state = parseInt(String(hero.state ?? 0), 10) || 0;
    if (state < 2 || state === 7 || state === 8) {
      list.push({ heroname: String(hero.name ?? ''), hid: parseInt(String(hero.hid), 10) || 0 });
    }
  }
  return list;
});

/** `SelectHeroDialog.onSubmit`. */
async function onSubmit(): Promise<void> {
  if (selectedIndex.value === 0) {
    void showAlert(i18n('Trick_SelectHeroDialog_7_1'));
    return;
  }
  const hid = heroes.value[selectedIndex.value]?.hid ?? 0;
  emit('use', hid);
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="183" :y="67" :w="281" :h="304" style-name="PopupDialog">
      <FxButton
        :right="16"
        :bottom="19"
        :fx="{ fontSize: 16 }"
        style-name="ButtonRed"
        :label="i18n('Trick_SelectHeroDialog_1_1')"
        @click="emit('close')"
      />
      <FxButton
        :right="95"
        :bottom="19"
        :fx="{ fontSize: 16 }"
        style-name="ButtonGreen"
        :label="i18n('Trick_SelectHeroDialog_2_1')"
        @click="onSubmit"
      />
      <FxCanvas :x="84" :y="15" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="4"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="i18n('Trick_SelectHeroDialog_3_1')"
        />
      </FxCanvas>
      <FxCanvas :x="17" :y="53" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="9"
          :y="3"
          :w="49"
          style-name="ItemTitle"
          :fx="{ fontWeight: 'normal', color: 16777215, textAlign: 'center' }"
          :text="i18n('Trick_SelectHeroDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="91" :y="53" :w="174" :h="26" style-name="BoardListDown">
        <FxLabel
          :x="0"
          :y="3"
          :w="164"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="trick.name"
        />
      </FxCanvas>
      <FxCanvas :x="16" :y="93" :w="249" :h="108" style-name="BoardListDown" scroll-y>
        <div class="desc">{{ trick.description }}</div>
      </FxCanvas>
      <FxCanvas :x="16" :y="215" :w="66" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="2"
          :y="3"
          :w="63"
          :fx="{ fontWeight: 'normal', color: 16777215, textAlign: 'center' }"
          :text="i18n('Trick_SelectHeroDialog_5_1')"
        />
      </FxCanvas>
      <FxComboBox
        v-model:selected-index="selectedIndex"
        :x="100"
        :y="215"
        :w="129"
        :h="26"
        :items="heroes.map((h) => h.heroname)"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.desc {
  padding: 4px 2px;
  color: #fff;
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
