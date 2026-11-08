<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { activityPage, parseActivities, type Activity } from '../../game/loginActivity';
import { escapeHtml, flexHtml } from '../../core/flexHtml';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxText from '../../ui/FxText.vue';
withDefaults(defineProps<{ x?: number; y?: number; w?: number; h?: number }>(), { x: 624, y: 82 });
const game = useGame();
const rows = shallowRef<Activity[]>([]);
const page = ref(0);
const visible = computed(() => activityPage(rows.value, page.value));
// The announcements carry Flash htmlText (`<font color=…>公告</font>`), so render them through
// flexHtml like every other htmlText surface — escaping alone showed the raw tags (W8 走查).
const html = computed(() =>
  visible.value
    .map((row) =>
      row.link
        ? `<a href="${escapeHtml(row.link)}">${flexHtml(row.content)}</a>`
        : flexHtml(row.content),
    )
    .join('<br/>'),
);
let scrollLeft = 0;
let refreshLeft = 1800;
let timer: ReturnType<typeof setInterval> | undefined;
const unregister = game.addGlobalReceiver('activity', (command, data) => {
  if (command !== 'getActivityList') return;
  rows.value = parseActivities(data);
  page.value = 0;
  scrollLeft = visible.value.at(-1)?.interval ?? 1;
});
function refresh() {
  void game.cmd.sendGlobalCommand('activity', 'getActivityList', [], false);
}
onMounted(() => {
  refresh();
  timer = setInterval(() => {
    if (--scrollLeft <= 0) {
      page.value++;
      scrollLeft = visible.value.at(-1)?.interval ?? 1;
    }
    if (--refreshLeft <= 0) {
      refreshLeft = 1800;
      refresh();
    }
  }, 1000);
});
onUnmounted(() => {
  unregister();
  clearInterval(timer);
});
</script>
<template>
  <FxCanvas
    v-if="rows.length"
    :x="x"
    :y="y"
    :w="w ?? 364"
    :h="h ?? Math.min(6, rows.length) * 22 + 4"
    style-name="ChatPanel"
  >
    <FxText
      :x="4"
      :y="0"
      :w="(w ?? 364) - 8"
      :h="h ?? Math.min(6, rows.length) * 22 + 4"
      :html="html"
      :scroll="h !== undefined"
      :fx="{ fontSize: 13 }"
    />
  </FxCanvas>
</template>
