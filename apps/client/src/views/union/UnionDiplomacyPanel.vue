<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const game = useGame();
const action = 'union_diplomacy';
const type = ref(0);
const rows = ref<Record<string, unknown>[]>([]);
const requests = ref<Record<string, unknown>[]>([]);
const targetName = ref('');
const detail = ref<Record<string, unknown>>({});

function load(): void {
  game.sendGlobalCommand(action, 'getUnionRelation', [type.value]);
  game.sendGlobalCommand(action, 'getRequestList');
}
const unregister = game.addGlobalReceiver(action, (command, data) => {
  const d = Array.isArray(data) ? data : [];
  if (command === 'getUnionRelation') rows.value = (d[1] as Record<string, unknown>[]) ?? [];
  else if (command === 'getRequestList') requests.value = (d[1] as Record<string, unknown>[]) ?? [];
  else if (command === 'loadUnionDetail') detail.value = (d[1] as Record<string, unknown>) ?? {};
  else if (['pendingFriendly', 'removeUnionRelation', 'addUnionRelationByName'].includes(command))
    load();
});
function add(type: number): void {
  if (targetName.value.trim())
    game.sendGlobalCommand(action, 'addUnionRelationByName', [type, targetName.value.trim()]);
}
function pending(accept: number, unionid: number): void {
  game.sendGlobalCommand(action, 'pendingFriendly', [accept, unionid]);
}
load();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxButton
      v-for="(name, i) in ['友好', '中立', '敌对']"
      :key="i"
      :x="10 + i * 100"
      :y="8"
      :w="90"
      style-name="ButtonYellow"
      :label="name"
      @click="
        type = i;
        load();
      "
    />
    <FxTextInput v-model="targetName" :x="320" :y="8" :w="130" :h="24" :max-chars="8" />
    <FxButton :x="460" :y="8" :w="65" style-name="ButtonGreen" label="结交" @click="add(0)" />
    <FxButton :x="535" :y="8" :w="65" style-name="ButtonRed" label="宣战" @click="add(2)" />
    <FxDataGrid
      :x="5"
      :y="45"
      :w="610"
      :h="130"
      :rows="rows"
      :row-height="25"
      :columns="[
        { header: '联盟', field: 'name', width: 140 },
        { header: '盟主', field: 'leader', width: 110 },
        { header: '成员', field: 'member', width: 70 },
        { header: '声望', field: 'prestige', width: 100 },
        { header: '操作', field: 'unionid', width: 130 },
      ]"
    >
      <template #cell="{ row, column }">
        <template v-if="column.field === 'unionid'">
          <FxButton
            :w="55"
            :h="22"
            style-name="ButtonGreen"
            label="详情"
            @click="game.sendGlobalCommand(action, 'loadUnionDetail', [Number(row.unionid)])"
          />
          <FxButton
            :x="60"
            :w="65"
            :h="22"
            style-name="ButtonRed"
            label="解除"
            @click="
              game.sendGlobalCommand(action, 'removeUnionRelation', [type, Number(row.unionid)])
            "
          />
        </template>
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <FxLabel :x="10" :y="185" :w="120" text="待处理结交" />
    <FxDataGrid
      :x="5"
      :y="210"
      :w="610"
      :h="135"
      :rows="requests"
      :row-height="25"
      :columns="[
        { header: '联盟', field: 'name', width: 150 },
        { header: '盟主', field: 'leader', width: 120 },
        { header: '接受', field: 'unionid', width: 100 },
        { header: '拒绝', field: 'time', width: 120 },
      ]"
    >
      <template #cell="{ row, column }">
        <FxButton
          v-if="column.field === 'unionid'"
          :w="65"
          :h="22"
          style-name="ButtonGreen"
          label="接受"
          @click="pending(1, Number(Number(row.unionid)))"
        />
        <FxButton
          v-else-if="column.field === 'time'"
          :w="65"
          :h="22"
          style-name="ButtonRed"
          label="拒绝"
          @click="pending(0, Number(Number(row.unionid)))"
        />
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <FxLabel :x="10" :y="350" :w="600" :text="`${detail.name ?? ''} ${detail.intro ?? ''}`" />
  </FxCanvas>
</template>
