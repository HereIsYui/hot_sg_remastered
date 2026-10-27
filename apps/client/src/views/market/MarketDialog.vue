<script setup lang="ts">
import { ref } from 'vue';
import type { BuildingState } from '../../stores/city';
import UpgradeBuildingDialog from '../building/UpgradeBuildingDialog.vue';
import AutoTransDialog from './AutoTransDialog.vue';
import MarketMerchantBuyDialog from './MarketMerchantBuyDialog.vue';
import MarketMerchantSellDialog from './MarketMerchantSellDialog.vue';
import MarketPanel from './MarketPanel.vue';
import MarketUserBuyDialog from './MarketUserBuyDialog.vue';
import MarketUserSellDialog from './MarketUserSellDialog.vue';

/** Market.MarketDialog: merchant, player trades and automatic transport. */
const props = defineProps<{ x: number; y: number; building: BuildingState }>();
const emit = defineEmits<{ destroyPanel: [handlers: { all: () => void; level: () => void }] }>();
const view = ref<'main' | 'auto' | 'merchantBuy' | 'merchantSell' | 'userBuy' | 'userSell'>('main');
const auto = ref<InstanceType<typeof AutoTransDialog>>();
const userBuy = ref<InstanceType<typeof MarketUserBuyDialog>>();
const userSell = ref<InstanceType<typeof MarketUserSellDialog>>();

function onReply(data: unknown[], ttype: number): void {
  if (ttype === 1) userSell.value?.onReply(data);
  else if (ttype === 2) userBuy.value?.onReply(data);
  else if (ttype >= 3 && ttype <= 6) auto.value?.onReply(data, ttype);
}
</script>

<template>
  <UpgradeBuildingDialog
    :x="x"
    :y="y"
    :h="492"
    :building="building"
    @destroy-panel="emit('destroyPanel', $event)"
    @reply-ttype="onReply"
  >
    <template #default="{ extra, send, reload }">
      <MarketPanel v-show="view === 'main'" :extra="extra" :send="send" @open="view = $event" />
      <AutoTransDialog ref="auto" :open="view === 'auto'" :send="send" @close="view = 'main'" />
      <MarketMerchantBuyDialog
        v-if="view === 'merchantBuy'"
        :level="props.building.level"
        :send="send"
        @close="view = 'main'"
        @submitted="
          view = 'main';
          reload();
        "
      />
      <MarketMerchantSellDialog
        v-if="view === 'merchantSell'"
        :level="props.building.level"
        :send="send"
        @close="view = 'main'"
        @submitted="
          view = 'main';
          reload();
        "
      />
      <MarketUserBuyDialog
        v-if="view === 'userBuy'"
        ref="userBuy"
        :send="send"
        @close="view = 'main'"
      />
      <MarketUserSellDialog
        v-if="view === 'userSell'"
        ref="userSell"
        :send="send"
        @close="view = 'main'"
      />
    </template>
  </UpgradeBuildingDialog>
</template>
