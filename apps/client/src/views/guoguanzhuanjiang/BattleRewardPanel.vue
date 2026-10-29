<script setup lang="ts">
import { computed } from 'vue';
import type { Row } from '../../game/campaign-pk';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * GuoGuanZhanJiang.BattleRewardPanel (`setItem`, AS3:336): the result overlay of the PK playback
 * — the win/lose line, the reward items of a won fight (`doParseReward`), and a confirm that
 * refreshes the ladder (`regetCampaignMaxData` is sent by the opener's `doQuit`).
 */
const props = defineProps<{ win: boolean; rewards: Row[] }>();
const emit = defineEmits<{ confirm: []; close: [] }>();

/** `doParseReward`: `info.name*count` per granted row,物品 or 装备. */
const lines = computed(() =>
  props.rewards
    .filter((r) => r.info && typeof r.info === 'object')
    .map((r) => {
      const info = r.info as Row;
      return `${String(info.name ?? '')}*${String(r.count ?? 1)}`;
    }),
);
const text = computed(() =>
  lines.value.length > 0
    ? i18n('Hero_Battle_Dialog_battle_reward_text')
    : i18n('Hero_Battle_Dialog_battle_result_1'),
);

const imageName = (info: Row): string => {
  const image = Number(info.image ?? 0);
  return image === 0 ? `images/item_${Number(info.gid ?? 0)}.png` : `images/pack_${image}.png`;
};
</script>

<template>
  <FxCanvas :x="216" :y="132" :w="300" :h="220" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxLabel
      :x="0"
      :y="14"
      :w="300"
      :h="20"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="
        props.win
          ? i18n('Hero_Battle_Dialog_battle_report_result_1')
          : i18n('Hero_Battle_Dialog_battle_report_result_2')
      "
    />
    <FxCanvas :x="20" :y="48" :w="260" :h="110" style-name="BoardListDown">
      <FxText :x="8" :y="6" :w="244" :h="40" :text="text" :fx="{ color: 16777215 }" />
      <FxCanvas
        v-for="(line, i) in lines"
        :key="i"
        :x="8 + i * 84"
        :y="48"
        :w="75"
        :h="55"
        style-name="BoardListDown"
      >
        <FxImage :x="5" :y="4" :w="46" :h="46" :source="imageName(props.rewards[i]!.info as Row)" />
        <FxLabel
          :x="0"
          :y="34"
          :w="75"
          :fx="{ textAlign: 'center', color: 16777215 }"
          :text="line"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton :x="60" :y="170" :w="80" :h="36" style-name="Confirm" @click="emit('confirm')" />
    <FxButton :x="170" :y="170" :w="70" :h="36" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
