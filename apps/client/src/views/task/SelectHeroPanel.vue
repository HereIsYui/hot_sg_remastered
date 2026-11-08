<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { useUserStore } from '../../stores/user';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
const props = defineProps<{ tid: number; type: number; level: number }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const user = useUserStore();
const heroes = ref<{ hid: number; name: string }[]>([]);
const selectedIndex = ref(0);
const t = (n: number) => i18n(`Task_SelectHero_1_${n}`);
const items = computed(() => [t(3), ...heroes.value.map((h) => h.name)]);
const unregister = game.addGlobalReceiver('task', (cmd, data) => {
  if (cmd !== 'getHerosByLevel' || !Array.isArray(data)) return;
  heroes.value = (data as Record<string, unknown>[]).map((h) => ({
    hid: Number(h.hid),
    name: String(h.name),
  }));
  selectedIndex.value = 0;
});
onMounted(() =>
  game.sendGlobalCommand('task', 'getHerosByLevel', [user.cid, props.type, props.level]),
);
onUnmounted(unregister);
function submit() {
  const hero = heroes.value[selectedIndex.value - 1];
  if (!hero || hero.hid <= 0) {
    void showAlert(t(5));
    return;
  }
  game.sendGlobalCommand('task', 'getReward', [props.tid, hero.hid]);
  emit('close');
}
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="150" :y="120" :w="382" :h="250" style-name="PopupDialog">
      <FxLabel :x="20" :y="20" :w="342" :text="t(1)" :fx="{ textAlign: 'center' }" />
      <FxLabel :x="20" :y="70" :w="100" :text="t(2)" />
      <FxComboBox v-model:selected-index="selectedIndex" :x="130" :y="70" :w="220" :items="items" />
      <FxButton :x="180" :bottom="20" :label="t(4)" @click="submit" />
      <FxButton :right="15" :bottom="20" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
