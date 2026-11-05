<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import ArmorPickGrid from '../armor/ArmorPickGrid.vue';

/**
 * Barn.UnActiveHorseDialog: the player's untamed mounts (loadUnActiveHorseArmor); clicking one
 * puts it in the 驯服 slot.
 */
const emit = defineEmits<{ close: []; pick: [a: Armor] }>();

const game = useGame();
const armors = shallowRef<Armor[]>([]);

const unregister = game.addGlobalReceiver('barn', (command, data) => {
  if (command !== 'loadUnActiveHorseArmor' || !Array.isArray(data)) return;
  const d = [...(data as unknown[])];
  armors.value = (Array.isArray(d[0]) ? (d.shift() as Record<string, unknown>[]) : []).map(
    parseArmor,
  );
  dealWithOtherInfoOfArmor(armorInfo, d);
});

onMounted(() => game.sendGlobalCommand('barn', 'loadUnActiveHorseArmor', []));
onUnmounted(unregister);

function pick(a: Armor) {
  emit('pick', a);
  emit('close');
}
</script>

<template>
  <FxCanvas :x="4" :y="4" :w="642" :h="362" style-name="PopupDialog">
    <FxButton :right="6" :y="6" style-name="Close" @click="emit('close')" />
    <FxLabel :x="12" :y="10" :w="200" style-name="ItemTitle" :text="i18n('Barn_HorseSelect')" />
    <ArmorPickGrid :x="3" :y="30" :armors="armors" @pick="pick" />
  </FxCanvas>
</template>
