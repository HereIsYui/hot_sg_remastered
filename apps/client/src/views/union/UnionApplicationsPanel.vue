<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { pagedRows } from '../../game/union';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const game = useGame();
const action = 'union_applications';
const page = ref(0);
const pageCount = ref(0);
const applies = ref<Record<string, unknown>[]>([]);
const invites = ref<Record<string, unknown>[]>([]);
const username = ref('');

function load(): void {
  game.sendGlobalCommand(action, 'getApplyList', [page.value]);
  game.sendGlobalCommand(action, 'getInviteList');
}
const unregister = game.addGlobalReceiver(action, (command, data) => {
  if (command === 'getApplyList') {
    const reply = pagedRows(data);
    page.value = reply.page;
    pageCount.value = reply.pageCount;
    applies.value = reply.rows;
  } else if (command === 'getInviteList') invites.value = Array.isArray(data) ? data : [];
  else if (['acceptApply', 'rejectApply', 'inviteUser', 'cancelInvite'].includes(command)) load();
});
function invite(): void {
  if (!username.value.trim()) return;
  game.sendGlobalCommand(action, 'inviteUser', [username.value.trim()]);
  username.value = '';
}
load();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxLabel :x="10" :y="8" :w="120" text="入盟申请" />
    <FxDataGrid
      :x="5"
      :y="32"
      :w="610"
      :h="125"
      :rows="applies"
      :row-height="25"
      :columns="[
        { header: '玩家', field: 'name', width: 150 },
        { header: '声望', field: 'prestige', width: 110 },
        { header: '排名', field: 'rank', width: 80 },
        { header: '接受', field: 'userid', width: 90 },
        { header: '拒绝', field: 'time', width: 120 },
      ]"
    >
      <template #cell="{ row, column }">
        <FxButton
          v-if="column.field === 'userid'"
          :w="65"
          :h="22"
          style-name="ButtonGreen"
          label="接受"
          @click="game.sendGlobalCommand(action, 'acceptApply', [page, Number(row.userid)])"
        />
        <FxButton
          v-else-if="column.field === 'time'"
          :w="65"
          :h="22"
          style-name="ButtonRed"
          label="拒绝"
          @click="game.sendGlobalCommand(action, 'rejectApply', [page, Number(row.userid)])"
        />
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <FxButton
      :x="500"
      :y="165"
      :w="100"
      style-name="ButtonYellow"
      label="上一页"
      @click="
        page = Math.max(0, page - 1);
        load();
      "
    />
    <FxButton
      :x="500"
      :y="195"
      :w="100"
      style-name="ButtonYellow"
      :label="`下一页 ${page + 1}/${pageCount}`"
      @click="
        page++;
        load();
      "
    />
    <FxLabel :x="10" :y="180" :w="120" text="邀请列表" />
    <FxDataGrid
      :x="5"
      :y="205"
      :w="480"
      :h="145"
      :rows="invites"
      :row-height="25"
      :columns="[
        { header: '玩家', field: 'name', width: 140 },
        { header: '邀请人', field: 'inviter', width: 140 },
        { header: '取消', field: 'userid', width: 100 },
      ]"
    >
      <template #cell="{ row, column }">
        <FxButton
          v-if="column.field === 'userid'"
          :w="65"
          :h="22"
          style-name="ButtonRed"
          label="取消"
          @click="game.sendGlobalCommand(action, 'cancelInvite', [Number(row.userid)])"
        />
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <FxTextInput v-model="username" :x="500" :y="240" :w="100" :h="26" :max-chars="8" />
    <FxButton
      :x="500"
      :y="275"
      :w="100"
      style-name="ButtonGreen"
      label="邀请玩家"
      @click="invite"
    />
  </FxCanvas>
</template>
