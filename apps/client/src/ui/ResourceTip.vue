<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../assets/registry';
import { i18n } from '../i18n';
import { skinStyle, styleString } from './skin';
import type { ResourceTip } from './tooltip';

/** Tooltip.ResourceRelatedToolTip: 312 wide, growing by one 20px line per condition. */
const props = defineProps<{ tip: ResourceTip; x: number; y: number }>();

const WIDTH = 312;
const LINE = 20;
const ROWS_TOP = 120;

const height = computed(() => 170 + props.tip.rows.length * LINE);
const headers = computed(
  () =>
    props.tip.headers ?? {
      type: i18n('Tooltip_ResourceRelatedToolTip_1_1'),
      need: i18n('Tooltip_ResourceRelatedToolTip_2_1'),
      current: i18n('Tooltip_ResourceRelatedToolTip_3_1'),
      time: i18n('Tooltip_ResourceRelatedToolTip_4_1'),
    },
);
const board = computed(() =>
  skinStyle(styleString(assets.style('Canvas', 'BoardFloat'), 'borderSkin')),
);
/** Flex keeps tooltips on the stage. */
const left = computed(() => Math.max(0, Math.min(props.x, 1000 - WIDTH)));
const top = computed(() => Math.max(0, Math.min(props.y, 600 - height.value)));
</script>

<template>
  <div
    class="resource-tip"
    :style="{ left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, height: `${height}px` }"
  >
    <div class="fill" :style="board" />
    <div class="title" :style="{ left: '10px', top: '10px' }">{{ tip.title }}</div>
    <div class="description">{{ tip.description }}</div>
    <div class="line" :style="{ left: '10px', top: '95px' }">{{ headers.type }}</div>
    <div class="line" :style="{ left: '105px', top: '95px' }">{{ headers.need }}</div>
    <div class="line" :style="{ left: '209px', top: '95px' }">{{ headers.current }}</div>
    <div class="rule" :style="{ left: '10px', top: '116px', width: '292px' }" />
    <template v-for="(row, i) in tip.rows" :key="i">
      <div class="line" :style="{ left: '10px', top: `${ROWS_TOP + i * LINE}px` }">
        {{ row.type }}
      </div>
      <div
        class="line"
        :style="{ left: '105px', top: `${ROWS_TOP + i * LINE}px`, color: row.ok ? '' : '#ff0000' }"
      >
        {{ row.need }}
      </div>
      <div class="line" :style="{ left: '210px', top: `${ROWS_TOP + i * LINE}px` }">
        {{ row.current }}
      </div>
    </template>
    <div v-if="tip.time !== null" class="bottom">
      <div class="rule" :style="{ left: '1px', top: '5px', width: '290px' }" />
      <div class="line" :style="{ left: '0', top: '10px' }">{{ headers.time }}</div>
      <div class="line" :style="{ left: '94.5px', top: '10px' }">{{ tip.time }}</div>
    </div>
  </div>
</template>

<style scoped>
.resource-tip {
  position: absolute;
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.fill {
  position: absolute;
  inset: 0;
}

.title {
  position: absolute;
  font-size: 16px;
  font-weight: bold;
  white-space: nowrap;
}

.description {
  position: absolute;
  left: 10px;
  top: 42px;
  width: 290px;
  height: 50px;
  padding: 2px;
  box-sizing: border-box;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
}

.line {
  position: absolute;
  padding: 2px 3px;
  line-height: 14px;
  white-space: nowrap;
}

.rule {
  position: absolute;
  height: 1px;
  background: #fff;
}

.bottom {
  position: absolute;
  left: 10px;
  bottom: 8px;
  width: 292px;
  height: 31px;
}
</style>
