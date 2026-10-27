<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { parseUnionStore, unionPositionName } from '../../game/union';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const props = defineProps<{ unionId: number }>();
const game = useGame();
const action = 'union_city';
const buildings = ref<Record<string, unknown>[]>([]);
const donation = ref<Record<string, unknown>>({});
const nextLevel = ref(0);
const store = ref<Record<string, unknown>[]>([]);
const remaining = ref(0);
const count = ref('1');
const exchangeCount = ref('1');
const rewardOpen = ref(false);
const rewardRanks = ref<Record<string, unknown>[]>([]);
const rewardUser = ref<Record<string, unknown>>({});
const donationLeft = computed(
  () => Number(donation.value.maxNum ?? 0) - Number(donation.value.curnum ?? 0),
);
const canClaimReward = computed(
  () =>
    Number(rewardUser.value.rank ?? 0) > 0 &&
    Number(rewardUser.value.rank ?? 0) <= 10 &&
    Number(rewardUser.value.getrewardtime ?? 0) <= 0,
);

function load(): void {
  game.sendGlobalCommand(action, 'loadUnionChiefCityInfo');
  game.sendGlobalCommand(action, 'donateGoodsInitData');
  game.sendGlobalCommand(action, 'updatePositionInitData');
  game.sendGlobalCommand(action, 'getUnionStoreInfo');
}
function setRewardData(data: unknown): void {
  const d = Array.isArray(data) ? data : [];
  rewardRanks.value = (d[0] as Record<string, unknown>[]) ?? [];
  rewardUser.value = (d[1] as Record<string, unknown>) ?? {};
}
function showRewards(): void {
  rewardOpen.value = true;
  game.sendGlobalCommand(action, 'loadUnionRewardData');
}
const unregister = game.addGlobalReceiver(action, (command, data) => {
  const d = Array.isArray(data) ? data : [];
  if (command === 'loadUnionChiefCityInfo')
    buildings.value = (d[1] as Record<string, unknown>[]) ?? [];
  else if (command === 'donateGoodsInitData')
    donation.value = (d[0] as Record<string, unknown>) ?? {};
  else if (command === 'updatePositionInitData')
    nextLevel.value = Number((d[0] as Record<string, unknown>)?.nextLevel ?? 0);
  else if (command === 'getUnionStoreInfo') {
    const reply = parseUnionStore(data);
    remaining.value = reply.remaining;
    store.value = reply.items;
  } else if (command === 'loadUnionRewardData') setRewardData(data);
  else if (command === 'getUnionReward') {
    setRewardData(d[0]);
    void showAlert(String(d[1] ?? ''));
  } else if (['donateGoods', 'upgradePosition', 'exchangeUnionGoods'].includes(command)) load();
});
function donate(bid: number): void {
  game.sendGlobalCommand(action, 'donateGoods', [bid, Number(count.value) || 1]);
}
function exchange(gid: number): void {
  game.sendGlobalCommand(action, 'exchangeUnionGoods', [
    [gid],
    Number(exchangeCount.value) || 1,
    0,
  ]);
}
function goodCount(row: Record<string, unknown>): unknown {
  return (row.goodInfo as Record<string, unknown> | undefined)?.count ?? 0;
}
load();
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxLabel
      :x="10"
      :y="8"
      :w="300"
      :text="`可捐献物资:${donation.goodsNum ?? 0}  今日剩余:${donationLeft}`"
    />
    <FxTextInput v-model="count" :x="320" :y="5" :w="70" :h="24" restrict="0-9" />
    <FxButton
      :x="400"
      :y="5"
      :w="180"
      style-name="ButtonGreen"
      label="捐献官府/民房/市场"
      @click="[2, 1, 9].forEach(donate)"
    />
    <FxDataGrid
      :x="5"
      :y="38"
      :w="610"
      :h="105"
      :rows="buildings"
      :row-height="24"
      :columns="[
        { header: '建筑', field: 'name', width: 100 },
        { header: '等级', field: 'level', width: 80 },
        { header: '当前数量', field: 'curnum', width: 120 },
        { header: '下一级需求', field: 'nextnum', width: 120 },
      ]"
    />
    <FxLabel
      :x="10"
      :y="150"
      :w="300"
      :text="`当前捐献:${donation.donate ?? 0}  下级要求:${nextLevel}`"
    />
    <FxButton
      :x="400"
      :y="145"
      :w="180"
      style-name="ButtonYellow"
      label="提升职位"
      @click="game.sendGlobalCommand(action, 'upgradePosition', [props.unionId])"
    />
    <FxLabel :x="10" :y="180" :w="200" :text="`今日兑换剩余:${remaining}`" />
    <FxTextInput v-model="exchangeCount" :x="230" :y="175" :w="70" :h="24" restrict="0-9" />
    <FxButton
      :x="400"
      :y="175"
      :w="180"
      style-name="ButtonGreen"
      label="联盟排名奖励"
      @click="showRewards"
    />
    <FxDataGrid
      :x="5"
      :y="207"
      :w="610"
      :h="140"
      :rows="store"
      :row-height="25"
      :columns="[
        { header: '物品', field: 'gid', width: 100 },
        { header: '等级', field: 'level', width: 80 },
        { header: '拥有', field: 'goodInfo', width: 100 },
        { header: '兑换', field: 'action', width: 100 },
      ]"
    >
      <template #cell="{ row, column }">
        <template v-if="column.field === 'goodInfo'">{{ goodCount(row) }}</template>
        <FxButton
          v-else-if="column.field === 'action'"
          :w="65"
          :h="22"
          style-name="ButtonGreen"
          label="兑换"
          @click="exchange(Number(row.gid))"
        />
        <template v-else-if="column.field === 'gid'">{{ row.gid }}</template>
        <template v-else>{{ row[column.field] }}</template>
      </template>
    </FxDataGrid>
    <FxCanvas v-if="rewardOpen" :x="0" :y="0" :w="620" :h="300" style-name="BoardListDown">
      <FxLabel :x="15" :y="12" :w="250" text="联盟排名奖励（前十名）" />
      <FxLabel
        :x="280"
        :y="12"
        :w="320"
        :text="`我的排名:${rewardUser.rank ?? '未上榜'}  职位:${unionPositionName(Number(rewardUser.union_pos ?? 0))}`"
      />
      <FxDataGrid
        :x="10"
        :y="45"
        :w="600"
        :h="190"
        :rows="rewardRanks"
        :row-height="24"
        :columns="[
          { header: '排名', field: 'rank', width: 100 },
          { header: '联盟', field: 'name', width: 300 },
        ]"
      />
      <FxLabel
        :x="15"
        :y="250"
        :w="350"
        :text="
          canClaimReward
            ? '奖励可领取'
            : Number(rewardUser.getrewardtime ?? 0) > 0
              ? '奖励已领取'
              : '当前没有可领取奖励'
        "
      />
      <FxButton
        v-if="canClaimReward"
        :x="390"
        :y="242"
        :w="90"
        style-name="ButtonGreen"
        label="领取奖励"
        @click="game.sendGlobalCommand(action, 'getUnionReward', [props.unionId])"
      />
      <FxButton
        :x="500"
        :y="242"
        :w="90"
        style-name="ButtonYellow"
        label="返回主城"
        @click="rewardOpen = false"
      />
    </FxCanvas>
  </FxCanvas>
</template>
