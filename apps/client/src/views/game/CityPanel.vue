<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BUILDING_WALL,
  OUTER_BUILDING_IMAGES,
  OUTER_GRID_COUNT_X,
  OUTER_GRID_COUNT_Y,
  OUTER_GRID_LEFT,
  OUTER_GRID_OFFX,
  OUTER_GRID_OFFY,
  OUTER_GRID_TOP,
  isCityWall,
  isValidOuterGrid,
  outerCellPos,
  outerGridPoint,
  type Point,
} from '../../game/cityGrid';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore, type BuildingState } from '../../stores/city';
import { useSessionStore } from '../../stores/session';
import { colorFilter } from '../../ui/colorFilters';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import { stagePoint } from '../../ui/tooltip';
import BuildingGrid from './BuildingGrid.vue';
import BuildingTip from './BuildingTip.vue';

/** CityPanel: the fields outside the walls (farms, lumber camps, quarries, mines). */
const props = defineProps<{ x: number; y: number }>();

const game = useGame();
const city = useCityStore();
const session = useSessionStore();

const ANNOUNCE = { x: 635, y: 230, w: 77, h: 74 };

const hover = ref<string | null>(null);
const announceHover = ref(false);
const tip = ref<{ text: string; x: number; y: number } | null>(null);

const fields = computed(() => {
  const map = new Map<string, BuildingState>();
  for (const b of city.buildings) if (b.inner === 0) map.set(`${b.x},${b.y}`, b);
  return map;
});
const hasWall = computed(() => city.buildings.some((b) => b.bid === BUILDING_WALL));

/** Slots in creation order; the walled city takes the place of the row-0 slots it covers. */
const cells = computed(() => {
  const out: { key: string; pos: Point; b: BuildingState | undefined; wall: boolean }[] = [];
  for (let gy = 0; gy < OUTER_GRID_COUNT_Y; gy++) {
    for (let gx = 0; gx < OUTER_GRID_COUNT_X; gx++) {
      if (isCityWall(gx, gy)) {
        if (gx === 2 && gy === 0) {
          const pos = {
            x: OUTER_GRID_LEFT + 2 * OUTER_GRID_OFFX,
            y: OUTER_GRID_TOP + 2 * OUTER_GRID_OFFY - 100,
          };
          out.push({ key: 'wall', pos, b: undefined, wall: true });
        }
      } else if (isValidOuterGrid(gx, gy, city.governmentLevel)) {
        const key = `${gx},${gy}`;
        out.push({ key, pos: outerCellPos(gx, gy), b: fields.value.get(key), wall: false });
      }
    }
  }
  return out;
});

function title(key: string): string {
  if (key === 'wall') return i18n('_CityPanelSrc_3');
  const b = fields.value.get(key);
  return b ? `${b.bname} ${b.level}${i18n('_CityPanelSrc_2')}` : i18n('_CityPanelSrc_1');
}

function localPoint(e: MouseEvent): Point {
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  return { x: p.x - props.x, y: p.y - props.y };
}

function inAnnounce(p: Point): boolean {
  return (
    p.x >= ANNOUNCE.x &&
    p.x < ANNOUNCE.x + ANNOUNCE.w &&
    p.y >= ANNOUNCE.y &&
    p.y < ANNOUNCE.y + ANNOUNCE.h
  );
}

/** `CityPanel.onMouseMove`. */
function onMove(e: MouseEvent) {
  const p = localPoint(e);
  const g = outerGridPoint(p);
  let key: string | null = null;
  if (isCityWall(g.x, g.y)) key = 'wall';
  else if (isValidOuterGrid(g.x, g.y, city.governmentLevel)) key = `${g.x},${g.y}`;
  hover.value = key;
  tip.value = key ? { text: title(key), x: p.x + 20, y: p.y } : null;
  announceHover.value = inAnnounce(p);
  if (announceHover.value) {
    tip.value = { text: i18n('_CityInnerPanelSrc_6'), x: p.x - 70, y: p.y + 20 };
  }
}

function onLeave() {
  hover.value = null;
  announceHover.value = false;
  tip.value = null;
}

/** `CityPanel.onMouseDown`: the walled city leads inside, fields open their dialogs. */
function onDown(e: MouseEvent) {
  if (e.button !== 0 || session.dialog) return;
  const g = outerGridPoint(localPoint(e));
  if (isCityWall(g.x, g.y)) {
    game.gotoView('cityInner');
  } else if (isValidOuterGrid(g.x, g.y, city.governmentLevel)) {
    game.openBuildingSlot({ inner: false, x: g.x, y: g.y }, 0, fields.value.get(`${g.x},${g.y}`));
  }
}
</script>

<template>
  <FxCanvas
    :x="x"
    :y="y"
    :w="736"
    :h="556"
    style-name="FrameScreenBoard"
    @mousemove="onMove"
    @mouseleave="onLeave"
    @mousedown="onDown"
  >
    <FxImage source="images/map_outercity.jpg" :x="3" :y="3" />
    <FxImage
      source="swf/announce_entry/images/1.png"
      :x="ANNOUNCE.x"
      :y="ANNOUNCE.y"
      :w="ANNOUNCE.w"
      :h="ANNOUNCE.h"
      :style="{ filter: colorFilter(false, announceHover), cursor: 'pointer' }"
    />
    <template v-for="c in cells" :key="c.key">
      <BuildingGrid
        v-if="c.wall"
        :x="c.pos.x"
        :y="c.pos.y"
        :image="hasWall ? 'images/building_outercity.png' : 'images/building_outertown.png'"
        :image-w="356"
        :image-h="222"
        :hilight="hover === 'wall'"
      />
      <BuildingGrid
        v-else
        :x="c.pos.x"
        :y="c.pos.y"
        :image="c.b ? OUTER_BUILDING_IMAGES[c.b.bid - 1] : undefined"
        :shadow="[6, 4]"
        :level="session.showLevel && c.b ? c.b.level : null"
        :level-at="[46, 30]"
        :grey="!!c.b && c.b.state !== 0"
        :hilight="hover === c.key"
      />
    </template>
    <BuildingTip v-if="tip" :text="tip.text" :x="tip.x" :y="tip.y" />
  </FxCanvas>
</template>
