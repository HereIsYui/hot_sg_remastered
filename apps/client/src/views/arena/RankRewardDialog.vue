<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { parseRankRewardInfo } from '../../game/arena';
import { treasureItems } from '../../game/goods';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import TreasureGetDialog from '../goods/TreasureGetDialog.vue';

/**
 * Arena.RankRewardDialog: the 每日排行奖励 popup. `getArenaRankRewardInfo` shows the top three
 * winners and the cfg_activity_rank_reward windows; `getArenaRankReward` claims the own rank's
 * prize, whose items surface in the existing TreasureGetDialog (`mGoodsGetDlg.loadGoods`).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();

const top3 = ref<Row[]>([]);
const confs = ref<{ minrank: number; maxrank: number; reward: string }[]>([]);
const userRank = ref<Row | null>(null);
const claimed = ref(false);
const treasure = ref<ReturnType<typeof treasureItems>>([]);

type Row = Record<string, unknown>;

const RANGES = [
  'Arena_Battle_reward_1_4',
  'Arena_Battle_reward_1_5',
  'Arena_Battle_reward_1_6',
  'Arena_Battle_reward_1_7',
  'Arena_Battle_reward_1_8',
  'Arena_Battle_reward_1_9',
  'Arena_Battle_reward_1_10',
  'Arena_Battle_reward_1_11',
];

const nameOf = (rank: number): string => {
  const row = top3.value.find((r) => Number(r.rank) === rank);
  return row
    ? `${String(row.name ?? '')}(${i18n('Arena_Battle_3_2')}Lv.${Number(row.level ?? 0)})`
    : '';
};
const rangeText = (index: number): string => {
  const conf = confs.value[index];
  return conf ? conf.reward : '';
};

onMounted(() => game.sendGlobalCommand('ArenaBattle', 'getArenaRankRewardInfo'));

const unregister = game.addGlobalReceiver('ArenaBattle', (command, data) => {
  if (command === 'getArenaRankRewardInfo') {
    const parsed = parseRankRewardInfo(data);
    top3.value = parsed.top3;
    confs.value = parsed.confs;
    userRank.value = parsed.userRank;
  } else if (command === 'getArenaRankReward') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    d.shift(); // rank
    treasure.value = treasureItems(d.shift());
    claimed.value = true;
  }
});
onUnmounted(unregister);

/** `RankRewardDialog.Button2`: claim the own rank's reward. */
function claim(): void {
  game.sendGlobalCommand('ArenaBattle', 'getArenaRankReward');
}

const rewardTitle = computed(() =>
  claimed.value
    ? i18n('Arena_Battle_reward_1_20')
    : userRank.value
      ? `${i18n('Arena_Battle_2_1')}${Number(userRank.value.rank)}`
      : i18n('Arena_Battle_title_5'),
);
const myReward = computed(() => {
  const rank = Number(userRank.value?.rank ?? 0);
  const conf = confs.value.find((c) => rank >= c.minrank && rank <= c.maxrank);
  return conf ? conf.reward : '';
});
</script>

<template>
  <FxCanvas :x="104" :y="28" :w="524" :h="468" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="139" :y="12" source="images/title.png" />
    <FxLabel
      :y="17"
      :w="524"
      :h="18"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('Arena_Battle_title_5')"
    />
    <template v-for="rank in [1, 2, 3]" :key="rank">
      <FxCanvas :x="26 + (rank - 1) * 165" :y="68" :w="142" :h="132" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="142"
          :h="27"
          :fx="{ textAlign: 'center', fontSize: 15, color: 16247152, fontWeight: 'bold' }"
          :text="i18n(`Arena_Battle_reward_1_${rank}`)"
        />
        <FxCanvas :x="37" :y="33" :w="75" :h="75" style-name="BoardListDown">
          <FxImage :x="5" :y="5" :w="64" :h="64" :tip="rangeText(rank - 1)" />
          <FxLabel
            :x="40"
            :y="47"
            :w="28"
            :fx="{ fontSize: 12, color: 16777215, textAlign: 'right', paddingTop: 3 }"
            :text="rangeText(rank - 1)"
          />
        </FxCanvas>
        <FxText
          :y="112"
          :w="142"
          :h="23"
          :html="nameOf(rank)"
          :fx="{ fontSize: 13, color: 16777215, textAlign: 'center', paddingTop: 5 }"
        />
      </FxCanvas>
    </template>
    <FxCanvas :x="25" :y="216" :w="254" :h="205" style-name="BoardListDown">
      <template v-for="(label, i) in RANGES" :key="label">
        <FxLabel
          :x="3"
          :y="3 + i * 24"
          :w="90"
          :h="25"
          :fx="{ color: 16247152, textAlign: 'right', fontSize: 13, paddingTop: 2 }"
          :text="i18n(label)"
        />
        <FxLabel
          :x="95"
          :y="3 + i * 24"
          :w="150"
          :h="25"
          :fx="{ color: 16777215, fontSize: 12, textAlign: 'center', paddingTop: 2 }"
          :text="rangeText(i)"
        />
      </template>
    </FxCanvas>
    <FxCanvas :x="295" :y="216" :w="210" :h="130" style-name="BoardListDown">
      <FxLabel :x="8" :y="10" :w="194" :fx="{ color: 16777215 }" :text="rewardTitle" />
      <FxLabel v-if="myReward" :x="8" :y="34" :w="194" :fx="{ color: 16777215 }" :text="myReward" />
      <FxButton
        v-if="userRank && !claimed"
        :x="55"
        :y="80"
        :w="100"
        :h="34"
        style-name="ButtonYellow"
        :label="i18n('Arena_Battle_3_5')"
        @click="claim"
      />
    </FxCanvas>
    <FxButton :x="440" :y="420" :w="70" :h="36" style-name="Close" @click="emit('close')" />
    <TreasureGetDialog v-if="treasure.length > 0" :items="treasure" @close="treasure = []" />
  </FxCanvas>
</template>
