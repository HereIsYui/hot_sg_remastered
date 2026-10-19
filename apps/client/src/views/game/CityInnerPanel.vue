<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BUILDING_GOVERNMENT,
  BUILDING_WALL,
  INNER_BUILDING_IMAGES,
  INNER_GRID_COUNT,
  INNER_GRID_LEFT,
  INNER_GRID_OFFX,
  INNER_GRID_OFFY,
  INNER_GRID_TOP,
  innerCellPos,
  innerGridPoint,
  isCityHall,
  isWall,
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

/** CityInnerPanel: the walled city, 6x6 building slots around the government, and the wall. */
const props = defineProps<{ x: number; y: number }>();

const game = useGame();
const city = useCityStore();
const session = useSessionStore();

const ANNOUNCE = { x: 649, y: 403, w: 77, h: 74 };

const hover = ref<string | null>(null);
const announceHover = ref(false);
const tip = ref<{ text: string; x: number; y: number } | null>(null);

const level = (b: BuildingState | undefined) => (session.showLevel && b ? b.level : null);

const innerBuildings = computed(() => {
  const map = new Map<string, BuildingState>();
  for (const b of city.buildings) {
    if (b.inner === 1 && !(b.x === 9 && b.y === 9)) map.set(`${b.x},${b.y}`, b);
  }
  return map;
});

const hallBuilding = computed(() =>
  city.buildings.find((b) => b.inner === 1 && isCityHall(b.x, b.y)),
);
const wallBuilding = computed(() => city.buildings.find((b) => b.x === 9 && b.y === 9));

/** Slots in creation order (row by row), which is also the drawing order. */
const cells = computed(() => {
  const out: { key: string; pos: Point; b: BuildingState | undefined }[] = [];
  for (let gy = 0; gy < INNER_GRID_COUNT; gy++) {
    for (let gx = 0; gx < INNER_GRID_COUNT; gx++) {
      if (isCityHall(gx, gy)) continue;
      out.push({
        key: `${gx},${gy}`,
        pos: innerCellPos(gx, gy),
        b: innerBuildings.value.get(`${gx},${gy}`),
      });
    }
  }
  return out;
});

/** The hall is created when the loop reaches (2, 0), after the first two slots of row 0. */
const hallIndex = 2;
const hallPos = {
  x: INNER_GRID_LEFT + 2 * INNER_GRID_OFFX - 2 * INNER_GRID_OFFX + 12,
  y: INNER_GRID_TOP + 2 * INNER_GRID_OFFY - 2,
};

const hasWallImage = computed(() => {
  const w = wallBuilding.value;
  return !!w && (w.level > 0 || w.state !== 0);
});

function title(key: string): string {
  if (key === 'wall') {
    const w = wallBuilding.value;
    return w
      ? `${w.bname} ${w.level}${i18n('_CityInnerPanelSrc_4')}`
      : i18n('_CityInnerPanelSrc_5');
  }
  if (key === 'hall') {
    const h = hallBuilding.value;
    return h
      ? `${h.bname} ${h.level}${i18n('_CityInnerPanelSrc_2')}`
      : i18n('Building_BuildingGrid_1_1');
  }
  const b = innerBuildings.value.get(key);
  return b ? `${b.bname} ${b.level}${i18n('_CityInnerPanelSrc_3')}` : i18n('_CityInnerPanelSrc_1');
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

/** `CityInnerPanel.onMouseMove`. */
function onMove(e: MouseEvent) {
  const p = localPoint(e);
  const g = innerGridPoint(p);
  let key: string | null = null;
  if (isWall(g)) key = 'wall';
  else if (g.x >= 0 && g.x < INNER_GRID_COUNT && g.y >= 0 && g.y < INNER_GRID_COUNT) {
    key = isCityHall(g.x, g.y) ? 'hall' : `${g.x},${g.y}`;
  }
  hover.value = key;
  tip.value = key ? { text: title(key), x: p.x, y: p.y + 20 } : null;
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

/** `CityInnerPanel.onMouseDown`. */
function onDown(e: MouseEvent) {
  if (e.button !== 0 || session.dialog) return;
  const g = innerGridPoint(localPoint(e));
  if (isCityHall(g.x, g.y)) {
    const gov = city.buildings.find((b) => b.bid === BUILDING_GOVERNMENT);
    game.openBuildingSlot({ inner: true, x: 2, y: 0 }, 1, gov);
  } else if (isWall(g)) {
    const wall = city.buildings.find((b) => b.bid === BUILDING_WALL);
    game.openBuildingSlot({ inner: true, x: 9, y: 9 }, 2, wall);
  } else if (g.x >= 0 && g.x < INNER_GRID_COUNT && g.y >= 0 && g.y < INNER_GRID_COUNT) {
    game.openBuildingSlot(
      { inner: true, x: g.x, y: g.y },
      1,
      innerBuildings.value.get(`${g.x},${g.y}`),
    );
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
    <FxImage
      :source="wallBuilding ? 'images/map_innercity_high.jpg' : 'images/map_innercity_low.jpg'"
      :x="3"
      :y="3"
    />
    <FxImage
      source="swf/announce_entry/images/1.png"
      :x="ANNOUNCE.x"
      :y="ANNOUNCE.y"
      :w="ANNOUNCE.w"
      :h="ANNOUNCE.h"
      :style="{ filter: colorFilter(false, announceHover), cursor: 'pointer' }"
    />
    <template v-for="(c, i) in cells" :key="c.key">
      <BuildingGrid
        v-if="i === hallIndex"
        :x="hallPos.x"
        :y="hallPos.y"
        image="images/building_cityhall.png"
        :image-w="195"
        :image-h="105"
        :level="level(hallBuilding)"
        :level-at="[150, 36]"
        :grey="!!hallBuilding && hallBuilding.state !== 0"
        :hilight="hover === 'hall'"
      />
      <BuildingGrid
        :x="c.pos.x"
        :y="c.pos.y"
        :image="c.b ? INNER_BUILDING_IMAGES[c.b.bid - 5] : undefined"
        :shadow="[2, 20]"
        :level="level(c.b)"
        :level-at="[40, 40]"
        :grey="!!c.b && c.b.state !== 0"
        :hilight="hover === c.key"
      />
    </template>
    <BuildingGrid
      :x="3"
      :y="27"
      :image="hasWallImage ? 'images/building_citywall.png' : 'images/building_townwall.png'"
      :level="session.showLevel ? (wallBuilding?.level ?? 0) : null"
      :level-at="hasWallImage ? [660, 165] : [562, 138]"
      :grey="!!wallBuilding && wallBuilding.state !== 0"
      :hilight="hover === 'wall'"
    />
    <BuildingTip v-if="tip" :text="tip.text" :x="tip.x" :y="tip.y" />
  </FxCanvas>
</template>
