<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import ArmorPickGrid from '../armor/ArmorPickGrid.vue';

/**
 * BlackSmith.UnActiveArmorDialog (装备激活): the unworn pieces whose holes are not open yet, by
 * part and quality (loadUnActivePartArmor). Clicking one activates it for 黄金 (initHoles).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const int = (v: unknown) => parseInt(String(v), 10) || 0;

const PART_FILTERS = Array.from({ length: 11 }, (_, i) => i18n(`BlackSmith_ArmorPart_${i + 1}`));
const QUALITY_FILTERS = Array.from({ length: 7 }, (_, i) => i18n(`ArmorDialog_ArmorType_${i}`));

const part = ref(0);
const quality = ref(0);
const armors = shallowRef<Armor[]>([]);

const unregister = game.addGlobalReceiver('blacksmith', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadUnActivePartArmor') {
    armors.value = (Array.isArray(d[0]) ? (d.shift() as Record<string, unknown>[]) : []).map(
      parseArmor,
    );
    dealWithOtherInfoOfArmor(armorInfo, d);
  } else if (command === 'initHoles') {
    void showAlert(i18n('BlackSmith_ActiveArmorSucc') + int(d[0]));
    load();
  }
});

function load() {
  game.sendGlobalCommand('blacksmith', 'loadUnActivePartArmor', [part.value + 1, quality.value]);
}

watch([part, quality], load);
onMounted(load);
onUnmounted(unregister);

function activate(a: Armor) {
  game.sendGlobalCommand('blacksmith', 'initHoles', [city.cid, a.sid]);
}
</script>

<template>
  <FxCanvas :x="4" :y="4" :w="642" :h="362" style-name="PopupDialog">
    <FxButton :right="6" :y="6" style-name="Close" @click="emit('close')" />
    <FxLabel :x="12" :y="10" :w="120" style-name="ItemTitle" :text="i18n('BS_UnActiveArmor')" />
    <FxLabel
      :x="140"
      :y="10"
      :w="60"
      style-name="ItemTitle"
      :text="i18n('Armor_ArmorDialog_17_1')"
    />
    <FxComboBox
      v-model:selected-index="part"
      :x="200"
      :y="8"
      :w="90"
      :row-count="11"
      :items="PART_FILTERS"
    />
    <FxComboBox
      v-model:selected-index="quality"
      :x="296"
      :y="8"
      :w="90"
      :row-count="7"
      :items="QUALITY_FILTERS"
    />
    <ArmorPickGrid :x="3" :y="30" :armors="armors" @pick="activate" />
  </FxCanvas>
</template>
