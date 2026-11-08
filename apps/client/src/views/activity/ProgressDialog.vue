<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { parseProgress, PROGRESS_COMMANDS, type ProgressRow } from '../../game/loginActivity';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
const props = defineProps<{ kind: keyof typeof PROGRESS_COMMANDS }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const config = PROGRESS_COMMANDS[props.kind];
const page = ref(0);
const pending = ref(false);
const rows = shallowRef<ProgressRow[]>([]);
const columns = computed(
  () =>
    [
      { header: i18n(`${config.locale}_7_1`), field: 'name', width: 232 },
      { header: i18n(`${config.locale}_8_1`), field: 'maxvalue', width: 105 },
      { header: i18n(`${config.locale}_9_1`), field: 'curvalue', width: 105 },
      { header: i18n(`${config.locale}_10_1`), field: 'remainvalue', width: 105 },
      { header: i18n(`${config.locale}_11_1`), field: 'percent', width: 100 },
    ] satisfies { header: string; field: keyof ProgressRow; width: number }[],
);
const unregister = game.addGlobalReceiver(config.action, (command, data) => {
  if (command === config.command) rows.value = parseProgress(data);
});
async function load(index: number) {
  if (pending.value) return;
  page.value = index;
  rows.value = [];
  pending.value = true;
  try {
    await game.cmd.sendGlobalCommand(config.action, config.command, [index]);
  } finally {
    pending.value = false;
  }
}
onMounted(() => void load(0));
onUnmounted(unregister);
</script>
<template>
  <FxCanvas :w="1000" :h="600" :fx="{ backgroundColor: 0, backgroundAlpha: 0.55 }">
    <FxCanvas :x="165" :y="95" :w="670" :h="410" style-name="PopupDialog">
      <FxLabel
        :x="20"
        :y="15"
        :w="580"
        style-name="ItemTitle"
        :text="i18n(`${config.locale}_1_1`)"
      />
      <FxButton :right="8" :y="8" style-name="Close" @click="emit('close')" />
      <FxButton
        v-for="(key, index) in config.tabs"
        :key="key"
        :x="12 + index * 108"
        :y="52"
        :w="104"
        :h="27"
        style-name="ButtonRed"
        :label="i18n(`${config.locale}_${key}_1`)"
        :selected="page === index"
        :enabled="!pending"
        @click="load(index)"
      />
      <FxDataGrid :x="12" :y="90" :w="647" :h="270" :columns="columns" :rows="rows" />
      <FxButton
        :x="510"
        :y="372"
        :w="145"
        :h="26"
        style-name="ButtonRed"
        :enabled="!pending"
        :label="i18n(`${config.locale}_${config.tabs[page]}_1`)"
        @click="load(page)"
      />
    </FxCanvas>
  </FxCanvas>
</template>
