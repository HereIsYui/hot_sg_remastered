<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { unionPositionName } from '../../game/union';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';

const game = useGame();
const action = 'union_members';
const members = ref<Record<string, unknown>[]>([]);
const kicks = ref<Record<string, unknown>[]>([]);
const positions = [0, 2, 3, 4];
const selected = ref<Record<string, number>>({});

function load(): void {
  game.sendGlobalCommand(action, 'loadUnionMemberList');
  game.sendGlobalCommand(action, 'getKickLeavingTime');
}
const unregister = game.addGlobalReceiver(action, (command, data) => {
  if (command === 'loadUnionMemberList') members.value = Array.isArray(data) ? data : [];
  else if (command === 'getKickLeavingTime') kicks.value = Array.isArray(data) ? data : [];
  else if (['setUnionProvicy', 'cancelKickMember', 'kickMember'].includes(command)) load();
});
function position(uid: number, index: number): void {
  game.sendGlobalCommand(action, 'setUnionProvicy', [uid, positions[index]!]);
}
function kick(name: string): void {
  game.sendGlobalCommand(action, 'kickMember', [name]);
}
function cancel(uid: number): void {
  game.sendGlobalCommand(action, 'cancelKickMember', [uid]);
}
load();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxDataGrid
      :x="5"
      :y="5"
      :w="610"
      :h="265"
      :rows="members"
      :row-height="28"
      :columns="[
        { header: '玩家', field: 'name', width: 120 },
        { header: '职位', field: 'union_pos', width: 80 },
        { header: '捐献', field: 'donate', width: 100 },
        { header: '城池', field: 'cityCount', width: 70 },
        { header: '操作', field: 'uid', width: 220 },
      ]"
    >
      <template #cell="{ row, column }">
        <template v-if="column.field === 'union_pos'">{{
          unionPositionName(Number(row.union_pos))
        }}</template>
        <template v-else-if="column.field === 'uid'">
          <FxComboBox
            :items="['成员', '副盟主', '长老', '官员']"
            :selected-index="
              positions.indexOf(Number(row.union_pos)) < 0
                ? 0
                : positions.indexOf(Number(row.union_pos))
            "
            :x="0"
            :w="90"
            :h="24"
            @change="
              selected[Number(row.uid)] = $event;
              position(Number(row.uid), $event);
            "
          />
          <FxButton
            :x="100"
            :w="100"
            :h="24"
            style-name="ButtonRed"
            label="踢出"
            @click="kick(String(row.name))"
          />
        </template>
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <FxDataGrid
      :x="5"
      :y="280"
      :w="610"
      :h="75"
      :rows="kicks"
      :row-height="24"
      :columns="[
        { header: '踢出人', field: 'doName', width: 120 },
        { header: '成员', field: 'name', width: 120 },
        { header: '剩余秒数', field: 'lefttime', width: 120 },
        { header: '撤销', field: 'kickuid', width: 100 },
      ]"
    >
      <template #cell="{ row, column }">
        <FxButton
          v-if="column.field === 'kickuid'"
          :w="70"
          :h="22"
          style-name="ButtonGreen"
          label="撤销"
          @click="cancel(Number(row.kickuid))"
        />
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
  </FxCanvas>
</template>
