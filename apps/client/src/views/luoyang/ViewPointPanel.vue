<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { parseRankPoints, parseUserInfoPoint } from '../../game/luoyang';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * LuoYang.ViewPointPanel: the 查看积分 popup of LuoYangBattlePanel — 联盟排名 / 玩家排名 /
 * 个人信息 (`getUnionRankPoint` / `getUserRankPoint` / `getUserInfoPoint` on the LuoYangBattle
 * action; in single-player the C++ writer never fills the boards, so they stay empty).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();

type Row = Record<string, unknown>;
const tab = ref(1);
const rankRows = ref<Row[]>([]);
const userScore = ref('');
const userInfoRows = ref<Row[]>([]);

const RANK_COLUMNS = [
  { header: i18n('LuoYang_Battle_Point_rank_type_1'), field: 'name', width: 160 },
  { header: i18n('LuoYang_Battle_Point_total'), field: 'score', width: 120 },
];
const INFO_COLUMNS = [
  { header: i18n('LuoYang_Battle_Point_rank_type_1'), field: 'name', width: 190 },
  { header: i18n('LuoYang_Battle_Point_total'), field: 'value', width: 90 },
];

/** `ViewPointPanel.Button1..3`: switch the three boards and refetch. */
function open(kind: 1 | 2 | 3): void {
  tab.value = kind;
  if (kind === 1) game.sendGlobalCommand('LuoYangBattle', 'getUnionRankPoint');
  else if (kind === 2) game.sendGlobalCommand('LuoYangBattle', 'getUserRankPoint');
  else game.sendGlobalCommand('LuoYangBattle', 'getUserInfoPoint');
}

const unregister = game.addGlobalReceiver('LuoYangBattle', (command, data) => {
  if (command === 'getUnionRankPoint' || command === 'getUserRankPoint') {
    rankRows.value = parseRankPoints(data);
  } else if (command === 'getUserInfoPoint') {
    const parsed = parseUserInfoPoint(data);
    userScore.value = parsed.score;
    userInfoRows.value = parsed.rows;
  }
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="40" :y="20" :w="420" :h="360" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxLabel
      :x="0"
      :y="12"
      :w="420"
      :h="20"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center', color: 15192461 }"
      :text="i18n('LuoYang_Battle_Point_title')"
    />
    <FxButton
      :x="20"
      :y="44"
      :w="110"
      :h="30"
      style-name="ButtonRed"
      :selected="tab === 1"
      :label="i18n('LuoYang_Battle_Point_1')"
      @click="open(1)"
    />
    <FxButton
      :x="150"
      :y="44"
      :w="110"
      :h="30"
      style-name="ButtonRed"
      :selected="tab === 2"
      :label="i18n('LuoYang_Battle_Point_2')"
      @click="open(2)"
    />
    <FxButton
      :x="280"
      :y="44"
      :w="110"
      :h="30"
      style-name="ButtonRed"
      :selected="tab === 3"
      :label="i18n('LuoYang_Battle_Point_3')"
      @click="open(3)"
    />
    <FxCanvas :x="20" :y="86" :w="380" :h="230" style-name="BoardListDown">
      <FxDataGrid
        v-if="tab <= 2"
        :x="4"
        :y="4"
        :w="372"
        :h="222"
        :columns="RANK_COLUMNS"
        :rows="rankRows"
      />
      <template v-else>
        <FxLabel
          :x="8"
          :y="10"
          :w="360"
          :fx="{ color: 16777215 }"
          :text="`${i18n('LuoYang_Battle_Point_total')}: ${userScore}`"
        />
        <FxDataGrid :x="4" :y="36" :w="372" :h="190" :columns="INFO_COLUMNS" :rows="userInfoRows" />
      </template>
    </FxCanvas>
    <FxButton :x="340" :y="320" :w="60" :h="32" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
