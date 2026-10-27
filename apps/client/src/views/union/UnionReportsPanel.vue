<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { pagedRows, unionReportPageLabel } from '../../game/union';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

const game = useGame();
const action = 'union_reports';
const page = ref(0);
const pageCount = ref(0);
const rows = ref<Record<string, unknown>[]>([]);
const detail = ref<Record<string, unknown> | null>(null);

function load(): void {
  game.sendGlobalCommand(action, 'getUnionReport', [page.value]);
}
const unregister = game.addGlobalReceiver(action, (command, data) => {
  const d = Array.isArray(data) ? data : [];
  if (command === 'getUnionReport') {
    const reply = pagedRows(data);
    page.value = reply.page;
    pageCount.value = reply.pageCount;
    rows.value = reply.rows;
    detail.value = null;
  } else if (command === 'getUnionReportDetail') {
    detail.value = (d[0] as Record<string, unknown>) ?? null;
  }
});
load();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxDataGrid
      v-if="!detail"
      :x="5"
      :y="5"
      :w="610"
      :h="300"
      :rows="rows"
      :row-height="28"
      :columns="[
        { header: '类型', field: 'type', width: 70 },
        { header: '敌情', field: 'enemy', width: 120 },
        { header: '时间', field: 'time', width: 150 },
        { header: '查看', field: 'id', width: 100 },
      ]"
    >
      <template #cell="{ row, column }">
        <FxButton
          v-if="column.field === 'id'"
          :w="70"
          :h="23"
          style-name="ButtonGreen"
          label="详情"
          @click="game.sendGlobalCommand(action, 'getUnionReportDetail', [Number(row.id)])"
        />
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <template v-else>
      <FxLabel
        :x="15"
        :y="15"
        :w="580"
        :text="`${detail.origincity ?? ''} → ${detail.happencity ?? ''}`"
      />
      <FxText :x="15" :y="50" :w="580" :h="220" :text="String(detail.description ?? '')" scroll />
      <FxButton
        :x="15"
        :y="285"
        :w="80"
        style-name="ButtonYellow"
        label="返回"
        @click="detail = null"
      />
    </template>
    <FxButton
      :x="15"
      :y="325"
      :w="85"
      style-name="ButtonYellow"
      label="上一页"
      @click="
        page = Math.max(0, page - 1);
        load();
      "
    />
    <FxButton
      :x="110"
      :y="325"
      :w="85"
      style-name="ButtonYellow"
      label="下一页"
      @click="
        page++;
        load();
      "
    />
    <FxLabel :x="230" :y="330" :w="100" :text="unionReportPageLabel(pageCount, page)" />
  </FxCanvas>
</template>
