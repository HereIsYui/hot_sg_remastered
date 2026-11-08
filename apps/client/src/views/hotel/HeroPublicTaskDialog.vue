<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { parsePublicHeroTasks, type PublicHeroTask } from '../../game/famousTasks';
import { ID_BUILDING_HOTEL } from '../../game/hotelLionize';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
const props = defineProps<{ param: number; hid: number; friendship: number }>();
const emit = defineEmits<{ close: []; accepted: [] }>();
const game = useGame();
const tasks = ref<PublicHeroTask[]>([]);
const t = (n: number) => i18n(`Hotel_HeroPublicTaskDialog_${n}_1`);
const columns = [
  { header: t(2), field: 'name' as const, width: 100 },
  { header: t(3), field: 'todo' as const, width: 280 },
  { header: t(4), field: 'reward' as const, width: 100 },
  { header: '', field: 'id' as const, width: 90 },
];
function reload() {
  game.sendDialogCommand(
    'getHeroPublicTask',
    ID_BUILDING_HOTEL,
    props.param,
    [props.hid, props.friendship],
    15,
  );
}
function accept(task: PublicHeroTask) {
  game.sendDialogCommand('getTheTask', ID_BUILDING_HOTEL, props.param, [task.id, task.group], 16);
}
const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === ID_BUILDING_HOTEL && p === props.param,
  onData(data, ttype) {
    if (ttype === 15) tasks.value = parsePublicHeroTasks(data);
    else if (ttype === 16 && Array.isArray(data)) {
      void showAlert(String(data[2] ?? ''));
      emit('accepted');
      reload();
    }
  },
});
onMounted(reload);
onUnmounted(unregister);
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5, fontSize: 12 }">
    <FxCanvas :x="35" :y="65" :w="612" :h="380" style-name="PopupDialog">
      <FxLabel :x="20" :y="15" :w="572" :text="t(1)" :fx="{ textAlign: 'center' }" />
      <FxDataGrid
        :x="20"
        :y="50"
        :w="572"
        :h="265"
        :rows="tasks"
        :columns="columns"
        :row-height="56"
      >
        <template #cell="{ row, column }">
          <FxButton v-if="column.field === 'id'" :w="85" :label="t(5)" @click="accept(row)" />
          <FxText v-else :w="column.width - 6" :h="50" :text="String(row[column.field])" />
        </template>
      </FxDataGrid>
      <FxLabel
        v-if="tasks.length === 0"
        :x="25"
        :y="90"
        :w="550"
        :text="i18n('Task_TaskDialogSrc_33')"
      />
      <FxButton :right="20" :bottom="15" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
