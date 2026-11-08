<script setup lang="ts">
import { ref } from 'vue';
import type { BattleInforState, BattleNewsItem } from '../../game/battleInfor';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleInfor: the 战场说明 dialog — the 战场介绍 detail panel (tab 0 / the 胜利条件
 * variant, both over mBattleInfoCanvas) and the 战场讯息 log pager (getBattleNews).
 */
const props = defineProps<{
  infor: BattleInforState;
  news: BattleNewsItem[];
  newsPage: number;
  newsPageCount: number;
}>();
const emit = defineEmits<{
  close: [];
  news: [];
  prevPage: [];
  nextPage: [];
}>();

/** `mCurrentTab`: 0 战场介绍, 1 战场讯息 (mBattleNewsCanvas), 2 胜利条件 (same info canvas). */
const tab = ref(0);

const tabs: Array<[0 | 1 | 2, string]> = [
  [0, i18n('Battle_BattleInfor_3_1')],
  [2, i18n('Battle_BattleInfor_3_1_1')],
  [1, i18n('Battle_BattleInfor_4_1')],
];

function show(next: 0 | 1 | 2): void {
  tab.value = next;
  if (next === 1 && props.news.length === 0) emit('news');
}

const newsColumns: { header: string; field: keyof BattleNewsItem; width: number }[] = [
  { header: i18n('Battle_BattleInfor_11_1'), field: 'time', width: 120 },
  { header: i18n('Battle_BattleInfor_12_1'), field: 'evtContent', width: 380 },
];
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxCanvas :x="70" :y="44" :w="543" :h="404" style-name="PopupDialog">
      <FxLabel
        :x="199.5"
        :y="15"
        :w="151"
        :h="18"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', fontWeight: 'normal' }"
        :text="i18n('Battle_BattleInfor_2_1')"
      />
      <!-- tab row (canvas1); the pager shows only on the 讯息 tab -->
      <FxButton
        v-for="([t, label], i) in tabs"
        :key="t"
        :x="19 + i * 83"
        :y="50"
        :w="75"
        :style-name="t === 1 ? 'ButtonRed' : 'ButtonGreen'"
        :label="label"
        @click="show(t)"
      />
      <template v-if="tab === 1">
        <FxCanvas :x="296" :y="54" :w="85" :h="25" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="3"
            :w="85"
            style-name="ItemValue"
            :fx="{ textAlign: 'center', fontWeight: 'bold' }"
            :text="`${props.newsPage + 1}/${props.newsPageCount}`"
          />
        </FxCanvas>
        <FxButton
          :x="367"
          :y="50"
          :w="56"
          style-name="ButtonRed"
          :label="i18n('Battle_BattleInfor_5_1')"
          @click="emit('prevPage')"
        />
        <FxButton
          :x="440"
          :y="50"
          :w="56"
          style-name="ButtonRed"
          :label="i18n('Battle_BattleInfor_6_1')"
          @click="emit('nextPage')"
        />
      </template>

      <!-- mBattleInfoCanvas: tabs 0 and 2 -->
      <FxCanvas v-if="tab !== 1" :x="0" :y="88" :w="543" :h="260">
        <FxCanvas :x="20" :y="1" :w="250" :h="150" style-name="BattleInterFrame">
          <FxImage :x="0" :y="0" :w="250" :h="150" :source="props.infor.image" />
        </FxCanvas>
        <FxCanvas :x="273" :y="0" :w="250" :h="151" style-name="BoardListUp">
          <FxLabel
            :x="20"
            :y="20"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="i18n('Battle_BattleInfor_7_1')"
          />
          <FxLabel
            :x="100"
            :y="20"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="props.infor.name"
          />
          <FxLabel
            :x="20"
            :y="50"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="i18n('Battle_BattleInfor_8_1')"
          />
          <FxLabel
            :x="100"
            :y="50"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="props.infor.difficulty"
          />
          <FxLabel
            :x="20"
            :y="80"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="i18n('Battle_BattleInfor_9_1')"
          />
          <FxLabel
            :x="100"
            :y="80"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="props.infor.people"
          />
          <FxLabel
            :x="20"
            :y="110"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="i18n('Battle_BattleInfor_10_1')"
          />
          <FxLabel
            :x="100"
            :y="110"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center', fontSize: 15 }"
            :text="props.infor.attend"
          />
        </FxCanvas>
        <FxLabel
          :x="21"
          :y="163"
          :w="502"
          :h="100"
          :fx="{ textAlign: 'left' }"
          :text="props.infor.content"
        />
      </FxCanvas>

      <!-- the win / lose block the 胜利条件 tab shows -->
      <FxLabel
        :x="21"
        :y="251"
        :w="90"
        :h="20"
        :fx="{ color: 55295, fontSize: 14, fontWeight: 'bold' }"
        :text="i18n('Battle_BattleInfor_13_1')"
      />
      <FxLabel :x="21" :y="271" :w="370" :h="36" :text="props.infor.winCondition" />
      <FxLabel
        :x="21"
        :y="300"
        :w="90"
        :h="20"
        :fx="{ color: 55295, fontSize: 14, fontWeight: 'bold' }"
        :text="i18n('Battle_BattleInfor_14_1')"
      />
      <FxLabel :x="21" :y="321" :w="370" :h="36" :text="props.infor.loseCondition" />

      <!-- mBattleNewsCanvas: tab 1 -->
      <FxCanvas v-if="tab === 1" :x="19" :y="88" :w="506" :h="270" style-name="BoardListDown">
        <FxDataGrid
          :x="2"
          :y="2"
          :w="504"
          :h="270"
          :columns="newsColumns"
          :rows="props.news"
          :row-height="22"
        >
          <template #cell="{ row, column }">
            <span :style="{ color: `#${(row.color as number).toString(16).padStart(6, '0')}` }">
              {{ row[column.field as 'time' | 'evtContent'] }}
            </span>
          </template>
        </FxDataGrid>
      </FxCanvas>

      <FxButton
        :x="466"
        :y="359"
        :h="36"
        style-name="ButtonRed"
        :label="i18n('Battle_BattleInfor_1_1')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
