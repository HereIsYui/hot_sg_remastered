<script setup lang="ts">
import { computed } from 'vue';
import type { PkRankRow, Row } from '../../game/campaign-pk';
import { i18n } from '../../i18n';
import type { TipValue } from '../../ui/tooltip';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * GuoGuanZhanJiang.ZhanJiangRewardDialog: the 榜首奖励 popup of the ladder dialog — each
 * difficulty's first-pass top three (`loadPKRewardRank [battleid, flag]`), with the claim button
 * for a rank the player holds (`getPkFirstReward [battleid, flag, rankid]`).
 */
const props = defineProps<{ battleName: string; ranks: PkRankRow[]; uid: number }>();
const emit = defineEmits<{ claim: [rankid: number]; close: [] }>();

const ofRank = (rankid: number): PkRankRow | undefined =>
  props.ranks.find((r) => r.rankid === rankid);
const nameOf = (rankid: number): string => ofRank(rankid)?.userName ?? '';
const goodOf = (rankid: number): Row | null => ofRank(rankid)?.rewardGood ?? null;
const countOf = (rankid: number): string => ofRank(rankid)?.rewardCount ?? '';

const goodImage = (good: Row | null): string | null => {
  if (!good) return null;
  const image = Number(good.image ?? 0);
  return image === 0 ? `images/item_${Number(good.gid ?? 0)}.png` : `images/pack_${image}.png`;
};
const tipOf = (rankid: number): TipValue | undefined => {
  const good = goodOf(rankid);
  return good
    ? { goods: { title: String(good.name ?? ''), text: String(good.description ?? '') } }
    : undefined;
};

/** `doCheckIsOn`: the claim button lights only on the player's own unclaimed rank. */
const canClaim = (rankid: number): boolean => {
  const rank = ofRank(rankid);
  return !!rank && rank.uid === props.uid && rank.uid > 0;
};

const title = computed(
  () => `${props.battleName}${i18n('Hero_Battle_Dialog_battle_startPanel_1_5')}`,
);
</script>

<template>
  <FxCanvas :x="130" :y="70" :w="552" :h="404" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxLabel
      :x="0"
      :y="12"
      :w="552"
      :h="20"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="title"
    />
    <template v-for="rankid in [1, 2, 3]" :key="rankid">
      <FxCanvas :x="26 + (rankid - 1) * 165" :y="60" :w="142" :h="190" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="142"
          :h="27"
          :fx="{ textAlign: 'center', fontSize: 15, color: 16247152, fontWeight: 'bold' }"
          :text="i18n(`Hero_Battle_Dialog_battle_reward_${rankid}`)"
        />
        <FxCanvas :x="37" :y="33" :w="75" :h="75" style-name="BoardListDown">
          <FxImage
            :x="5"
            :y="5"
            :w="64"
            :h="64"
            :source="goodImage(goodOf(rankid))"
            :tip="tipOf(rankid)"
          />
          <FxLabel
            :x="40"
            :y="47"
            :w="28"
            :fx="{ fontSize: 12, color: 16777215, textAlign: 'right', paddingTop: 3 }"
            :text="countOf(rankid)"
          />
        </FxCanvas>
        <FxText
          :y="112"
          :w="142"
          :h="23"
          :html="nameOf(rankid)"
          :fx="{ fontSize: 13, color: 16777215, textAlign: 'center', paddingTop: 5 }"
        />
        <FxLabel
          :y="138"
          :w="142"
          :h="20"
          :fx="{ fontSize: 11, color: 16247152, textAlign: 'center' }"
          :text="ofRank(rankid)?.formatTime ?? ''"
        />
        <FxButton
          v-if="canClaim(rankid)"
          :x="28"
          :y="158"
          :w="86"
          :h="28"
          style-name="ButtonYellow"
          :fx="{ fontSize: 12 }"
          :label="i18n('Hero_Battle_Dialog_battle_reward_btn')"
          @click="emit('claim', rankid)"
        />
      </FxCanvas>
    </template>
    <FxButton :x="450" :y="350" :w="70" :h="36" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
