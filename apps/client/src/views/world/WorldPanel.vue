<script setup lang="ts">
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from 'pixi.js';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { assets } from '../../assets/registry';
import { useGame } from '../../game/game';
import {
  blocksForWindow,
  cidToXY,
  cellToScreen,
  GRID_IMAGE_HEIGHT,
  GRID_OFFSET_X,
  GRID_OFFSET_Y,
  inRange,
  MAX_RANGE,
  MIN_RANGE,
  MOVE_GRID_HORI_STRAIGHT,
  MOVE_GRID_VERT_STRAIGHT,
  parseActionField,
  parseBlockData,
  parseMapCity,
  parseUserFields,
  parseWorldCityInfo,
  screenToCell,
  terrainImageName,
  worldTypeName,
  xyToCid,
  type MapCity,
  type Point,
} from '../../game/world';
import { i18n } from '../../i18n';
import { useWorldStore } from '../../stores/world';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * World/WorldPanel: the 500x500 map, rendered in 10x10 blocks with PixiJS. Only the cells inside
 * the view window are drawn (one terrain bitmap sprite + optional label each, the original
 * `showGridImage` blit), blocks already loaded are cached in the world store, and the detailed
 * city info for nearby cities is fetched lazily. Drag pans the view, the 位置 inputs jump to a
 * coordinate and 查找 searches a city by name.
 */
const PANEL_W = 736;
const PANEL_H = 556;
/** The drawable area (leaves room for the control bar on the right). */
const VIEW_W = 560;
const VIEW_H = 540;

/** Fill for cells whose block data (or bitmap) is still missing. */
const PLACEHOLDER_COLOR = 0x2b2b2b;
/** City tint by relationship flag (0 self .. 8 war-pending), translucent over the city bitmap. */
const FLAG_COLOR: Record<number, number> = {
  0: 0x2e8b57, // self — green
  1: 0x1e90ff, // ally — blue
  2: 0x87cefa,
  3: 0xdddddd, // neutral — grey
  4: 0xff4500, // enemy — red
  5: 0xffa500, // occupiable — orange
  6: 0xff6347,
  7: 0xdaa520, // no flag — gold
  8: 0xdc143c,
};

// ---- terrain bitmaps (`WorldPanel.terrainImages`) ----

/** Textures keyed by cell type, built once (Pixi caches by URL via Assets + Texture.from). */
let terrainTextures: Map<number, Texture> | undefined;
let terrainTexturesLoading: Promise<void> | undefined;

/** Load every `terrainImages[type]` bitmap once (`WorldPanel.as:19768-19775`). */
function ensureTerrainTextures(): Promise<void> {
  terrainTexturesLoading ??= (async () => {
    const types = [0, 1, 2, 3, 4, 5, 6, 7];
    const entries = await Promise.all(
      types.map(async (type) => {
        const url = assets.url(`images/terrain_${terrainImageName(type)}.png`);
        await Assets.load(url);
        return [type, Texture.from(url)] as const;
      }),
    );
    terrainTextures = new Map(entries);
  })();
  return terrainTexturesLoading;
}

const game = useGame();
const world = useWorldStore();

const host = ref<HTMLDivElement>();
const jumpX = ref('');
const jumpY = ref('');
const searchName = ref('');
/** Search results (getOtherCityByName), shown as a small jump list. */
const results = ref<{ cid: number; name: string; username: string }[]>([]);
/** Famous cities for the minimap (getMapCity). */
const mapCities = ref<MapCity[]>([]);
const hoverTip = ref<{ text: string; x: number; y: number } | null>(null);

let app: Application | undefined;
let gridLayer: Container | undefined;
const labelStyle = new TextStyle({ fontSize: 10, fill: 0xffffff });

/** Pending drag state. */
const drag = { active: false, startX: 0, startY: 0, startCentre: { x: 250, y: 250 } };

// ---- block loading ----

/** `WorldPanel.loadGridData`: request the blocks covering the current view window. */
function loadBlocks(): void {
  const c = world.centre;
  const half = Math.ceil(VIEW_W / (GRID_OFFSET_X * 2)) + 2;
  const gxmin = Math.max(c.x - half, MIN_RANGE);
  const gxmax = Math.min(c.x + half, MAX_RANGE);
  const gymin = Math.max(c.y - half, MIN_RANGE);
  const gymax = Math.min(c.y + half, MAX_RANGE);
  const blocks = blocksForWindow(gxmin, gxmax, gymin, gymax);
  game.sendWorldCommand('getBlockData', [blocks]);
}

/** `onGetBlockData`: merge the new cells, then load nearby city detail + fields + events. */
function onGetBlockData(data: unknown): void {
  const parsed = parseBlockData(data, world.centre);
  for (const [cid, cell] of parsed.cells) world.cells.set(cid, cell);
  world.marks = parsed.marks;
  world.loaded = true;
  if (parsed.cityIdsToLoad.length > 0) {
    game.sendWorldCommand('getWorldCityInfo', [
      parsed.cityIdsToLoad.length,
      ...parsed.cityIdsToLoad,
    ]);
  }
  game.sendWorldCommand('getUserFields');
  game.sendWorldCommand('getActionField', [0]);
  redraw();
}

function onGetWorldCityInfo(data: unknown): void {
  for (const info of parseWorldCityInfo(data)) world.cityInfo.set(info.cid, info);
  redraw();
}

// ---- rendering (only the visible cells) ----

/**
 * Traces the playable diamond of a cell whose 107x75 terrain bitmap has its top-left at (sx, sy).
 * The bitmap's top-left is the `cellToScreen` spot the original blits it at (showGridImage,
 * WorldPanel.as:21533/21609, `Matrix(1,0,0,1,_loc29_,_loc30_)`), and the diamond centre sits where
 * the original hit test expects it (getCidByMousePosition, WorldPanel.as:17748-17751):
 * bitmap top-left + (GRID_OFFSET_X, GRID_IMAGE_HEIGHT - GRID_OFFSET_X + GRID_OFFSET_Y).
 */
function traceCellDiamond(g: Graphics, sx: number, sy: number): Graphics {
  const cx = sx + GRID_OFFSET_X;
  const cy = sy + GRID_IMAGE_HEIGHT - GRID_OFFSET_X + GRID_OFFSET_Y;
  return g
    .moveTo(cx, cy - GRID_OFFSET_Y)
    .lineTo(cx + GRID_OFFSET_X, cy)
    .lineTo(cx, cy + GRID_OFFSET_Y)
    .lineTo(cx - GRID_OFFSET_X, cy)
    .lineTo(cx, cy - GRID_OFFSET_Y);
}

/** `showGridImage` + `showFlagImage`: redraw the visible window from the cached cells. */
function redraw(): void {
  if (!app || !gridLayer) return;
  gridLayer.removeChildren();
  const c = world.centre;
  const spanX = Math.ceil(VIEW_W / (GRID_OFFSET_X * 2)) + 2;
  const spanY = Math.ceil(VIEW_H / (GRID_OFFSET_Y * 2)) + 2;
  // sprites first, then the tint/placeholder diamonds above them, then dots and labels
  const tints = new Graphics();
  const dots: Graphics[] = [];
  const labels: Text[] = [];

  for (let my = c.y - spanY; my <= c.y + spanY; my++) {
    for (let mx = c.x - spanX; mx <= c.x + spanX; mx++) {
      if (!inRange(mx, my)) continue;
      const screen = cellToScreen(mx, my, c.x, c.y);
      if (
        screen.x < -GRID_OFFSET_X * 2 ||
        screen.x > VIEW_W ||
        screen.y < -GRID_OFFSET_Y * 2 ||
        screen.y > VIEW_H
      ) {
        continue; // cull off-screen cells
      }
      const cid = xyToCid(mx, my);
      const cell = world.cells.get(cid);
      const texture = cell ? terrainTextures?.get(cell.type) : undefined;
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.position.set(screen.x, screen.y);
        gridLayer.addChild(sprite);
      } else {
        traceCellDiamond(tints, screen.x, screen.y).fill(PLACEHOLDER_COLOR);
      }
      // mark / own-field / event overlays
      if (
        cell &&
        (cell.marktype > 0 ||
          world.userFieldCids.includes(cid) ||
          world.actionFieldCids.includes(cid))
      ) {
        const dot = new Graphics();
        const dotColor =
          cell.marktype > 0 ? 0xff00ff : world.actionFieldCids.includes(cid) ? 0x00ffff : 0x00ff00;
        dot.circle(screen.x + GRID_OFFSET_X, screen.y + GRID_OFFSET_Y, 4).fill(dotColor);
        dots.push(dot);
      }
      if (cell?.type === 0) {
        // relationship tint over the shared city base image keeps 敌我 readable (this round
        // replaces the original flagImages sprites; the name label is unchanged)
        const info = world.cityInfo.get(cid);
        traceCellDiamond(tints, screen.x, screen.y).fill({
          color: FLAG_COLOR[info?.flag ?? 7] ?? FLAG_COLOR[7]!,
          alpha: 0.4,
        });
        if (info) {
          const label = new Text({ text: info.cityname, style: labelStyle });
          label.x = screen.x + GRID_OFFSET_X - label.width / 2;
          label.y = screen.y + GRID_OFFSET_Y - 6;
          labels.push(label);
        }
      }
    }
  }
  gridLayer.addChild(tints);
  for (const d of dots) gridLayer.addChild(d);
  for (const l of labels) gridLayer.addChild(l);
}

// ---- input ----

function localPoint(e: PointerEvent): Point {
  const rect = app!.canvas.getBoundingClientRect();
  const scaleX = app!.canvas.width / app!.renderer.resolution / rect.width;
  const scaleY = app!.canvas.height / app!.renderer.resolution / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  drag.active = true;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.startCentre = { ...world.centre };
}

function onPointerMove(e: PointerEvent): void {
  const p = localPoint(e);
  const cell = screenToCell(p.x, p.y, world.centre.x, world.centre.y);
  if (inRange(cell.x, cell.y)) {
    const c = world.cells.get(xyToCid(cell.x, cell.y));
    const name = c ? worldTypeName(c.type) : '';
    hoverTip.value = { text: `[${cell.x},${cell.y}] ${name}`.trim(), x: p.x + 14, y: p.y + 10 };
  } else {
    hoverTip.value = null;
  }
  if (!drag.active) return;
  // one grid cell ~ GRID_OFFSET_X px horizontally; pan by whole cells while dragging
  const dx = Math.round((e.clientX - drag.startX) / GRID_OFFSET_X);
  const dy = Math.round((e.clientY - drag.startY) / GRID_OFFSET_Y);
  const nx = clampCoord(drag.startCentre.x - dx);
  const ny = clampCoord(drag.startCentre.y - dy);
  if (nx !== world.centre.x || ny !== world.centre.y) {
    world.centre = { x: nx, y: ny };
    redraw();
  }
}

function onPointerUp(e: PointerEvent): void {
  const moved = Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
  const wasDrag = drag.active && moved > 4;
  drag.active = false;
  if (wasDrag) {
    loadBlocks();
    return;
  }
  // a click: open the action dialog for the cell under the pointer (WorldPanel.onMouseUp)
  const p = localPoint(e);
  const cell = screenToCell(p.x, p.y, world.centre.x, world.centre.y);
  if (!inRange(cell.x, cell.y)) return;
  const cid = xyToCid(cell.x, cell.y);
  const data = world.cells.get(cid);
  if (!data) {
    void showAlert(i18n('World_WorldPanelSrc_34'));
    return;
  }
  if (data.type === 0 && !world.cityInfo.get(cid)) {
    void showAlert(i18n('World_WorldPanelSrc_34'));
    return;
  }
  game.showWorldAction(cid);
}

function clampCoord(v: number): number {
  return Math.max(MIN_RANGE, Math.min(MAX_RANGE, v));
}

// ---- jump / move / search ----

function moveViewTo(x: number, y: number): void {
  world.centre = { x: clampCoord(x), y: clampCoord(y) };
}

function onJump(): void {
  const x = parseInt(jumpX.value, 10);
  const y = parseInt(jumpY.value, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !inRange(x, y)) {
    void showAlert(i18n('World_WorldPanelSrc_34') || '坐标超出范围 (1-500)');
    return;
  }
  moveViewTo(x, y);
}

const onLeft = () =>
  moveViewTo(world.centre.x - MOVE_GRID_HORI_STRAIGHT, world.centre.y + MOVE_GRID_HORI_STRAIGHT);
const onRight = () =>
  moveViewTo(world.centre.x + MOVE_GRID_HORI_STRAIGHT, world.centre.y - MOVE_GRID_HORI_STRAIGHT);
const onUp = () =>
  moveViewTo(world.centre.x - MOVE_GRID_VERT_STRAIGHT, world.centre.y - MOVE_GRID_VERT_STRAIGHT);
const onDown = () =>
  moveViewTo(world.centre.x + MOVE_GRID_VERT_STRAIGHT, world.centre.y + MOVE_GRID_VERT_STRAIGHT);

function onSearch(): void {
  const name = searchName.value.trim();
  if (name.length === 0) {
    void showAlert(i18n('World_CityInfluenceMap_1') || '请输入目标名称');
    return;
  }
  if (name.length > 8) {
    void showAlert(i18n('World_CityInfluenceMap_2') || '名称过长');
    return;
  }
  game.sendWorldCommand('getOtherCityByName', [name]);
}

/** `getOtherCityByName` reply: `[name, cities[]]`. */
function onGetOtherCityByName(data: unknown): void {
  const arr = Array.isArray(data) ? (data as unknown[]) : [];
  const rows = Array.isArray(arr[arr.length - 1])
    ? (arr[arr.length - 1] as Record<string, unknown>[])
    : [];
  if (rows.length === 0) {
    void showAlert(i18n('searchcityname_target_union_not_exist') || '未找到目标');
    return;
  }
  results.value = rows.map((r) => ({
    cid: parseInt(String(r.cid), 10) || 0,
    name: String(r.name ?? ''),
    username: String(r.username ?? ''),
  }));
}

function jumpToResult(cid: number): void {
  const { x, y } = cidToXY(cid);
  results.value = [];
  moveViewTo(x, y);
}

// ---- minimap ----

const MINIMAP = 120;
const minimapCities = computed(() =>
  mapCities.value.map((c) => {
    const { x, y } = cidToXY(c.cid);
    return { ...c, px: (x / MAX_RANGE) * MINIMAP, py: (y / MAX_RANGE) * MINIMAP };
  }),
);
const minimapView = computed(() => ({
  x: (world.centre.x / MAX_RANGE) * MINIMAP,
  y: (world.centre.y / MAX_RANGE) * MINIMAP,
}));

function onMinimapClick(e: MouseEvent): void {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  const x = clampCoord(Math.round(((e.clientX - rect.left) / MINIMAP) * MAX_RANGE));
  const y = clampCoord(Math.round(((e.clientY - rect.top) / MINIMAP) * MAX_RANGE));
  moveViewTo(x, y);
}

// ---- lifecycle ----

const unregister = game.addGlobalReceiver('world', (command, data) => {
  if (command === 'getBlockData') onGetBlockData(data);
  else if (command === 'getWorldCityInfo' || command === 'startWar') onGetWorldCityInfo(data);
  else if (command === 'useTaoNiShengZhi') {
    const cids = [...world.cityInfo.keys()];
    if (cids.length) game.sendWorldCommand('getWorldCityInfo', [cids.length, ...cids]);
  } else if (command === 'createCityFromLand') {
    // WorldPanel.as:9324 `moveViewTo(mgx, mgy)`: re-centre on the current view so the flatland
    // that just became a city reloads its block (loadUserInfo + the 筑城成功 toast are app-level,
    // handled in Game.onGlobalCommand).
    moveViewTo(world.centre.x, world.centre.y);
  } else if (command === 'getUserFields') {
    world.userFieldCids = parseUserFields(data);
    redraw();
  } else if (command === 'getActionField') {
    world.actionFieldCids = parseActionField(data).cids;
    redraw();
  } else if (command === 'getMapCity') {
    mapCities.value = parseMapCity(data);
  } else if (command === 'getOtherCityByName') {
    onGetOtherCityByName(data);
  }
});

onMounted(async () => {
  app = new Application();
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio,
    autoDensity: true,
    antialias: true,
  });
  gridLayer = new Container();
  app.stage.addChild(gridLayer);
  host.value?.appendChild(app.canvas);
  // blit the original terrain bitmaps (placeholders if the export is missing)
  try {
    await ensureTerrainTextures();
  } catch (err) {
    console.warn('missing terrain images', err);
  }
  // centre on the player's current city if known
  if (game.city.cid > 0) {
    const { x, y } = cidToXY(game.city.cid);
    world.centre = { x: clampCoord(x), y: clampCoord(y) };
  }
  redraw();
  loadBlocks();
  game.sendWorldCommand('getMapCity');
});

onBeforeUnmount(() => {
  unregister();
  app?.destroy(true, { children: true });
  app = undefined;
  gridLayer = undefined;
  hoverTip.value = null;
});

// keep the Pixi view in sync if the centre is changed elsewhere
watch(
  () => world.centre,
  () => {
    redraw();
    loadBlocks();
  },
  { deep: true },
);
</script>

<template>
  <FxCanvas :x="264" :y="0" :w="PANEL_W" :h="PANEL_H" style-name="FrameScreenBoard">
    <div
      ref="host"
      class="world-view"
      :style="{ width: `${VIEW_W}px`, height: `${VIEW_H}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="hoverTip = null"
    />
    <div
      v-if="hoverTip"
      class="grid-tip"
      :style="{ left: `${hoverTip.x}px`, top: `${hoverTip.y}px` }"
    >
      {{ hoverTip.text }}
    </div>

    <!-- control bar -->
    <FxCanvas
      :x="VIEW_W + 4"
      :y="8"
      :w="PANEL_W - VIEW_W - 12"
      :h="PANEL_H - 16"
      style-name="BoardListUp"
    >
      <!-- directional pad -->
      <div class="pad">
        <FxButton :w="34" :h="22" style-name="ButtonGreen" label="↑" @click="onUp" />
        <div class="pad-mid">
          <FxButton :w="34" :h="22" style-name="ButtonGreen" label="←" @click="onLeft" />
          <FxButton :w="34" :h="22" style-name="ButtonGreen" label="→" @click="onRight" />
        </div>
        <FxButton :w="34" :h="22" style-name="ButtonGreen" label="↓" @click="onDown" />
      </div>

      <!-- coordinate jump (a remaster addition — the original had no jump inputs) -->
      <div class="jump">
        <FxTextInput v-model="jumpX" :w="48" :h="22" placeholder="X" />
        <FxTextInput v-model="jumpY" :w="48" :h="22" placeholder="Y" />
        <FxButton :w="44" :h="22" style-name="ButtonRed" label="定位" @click="onJump" />
      </div>

      <!-- search by name: the original's nameInput prompt (WorldPanel.as:14501) -->
      <div class="search">
        <FxTextInput
          v-model="searchName"
          :w="100"
          :h="22"
          :placeholder="i18n('World_WorldPanel_10_3') || '请输入城池名称'"
        />
        <FxButton :w="44" :h="22" style-name="ButtonRed" label="查找" @click="onSearch" />
      </div>
      <ul v-if="results.length" class="results">
        <li v-for="r in results" :key="r.cid" @click="jumpToResult(r.cid)">
          {{ r.name }} <span class="owner">{{ r.username }}</span>
        </li>
      </ul>

      <!-- favourites entry (label from the action dialog's 收藏 button) -->
      <FxButton
        :w="150"
        :h="24"
        style-name="ButtonGreen"
        :label="i18n('World_WorldActionDialog_44_1') || '收藏'"
        @click="game.showFavourites()"
      />

      <!-- minimap -->
      <div
        class="minimap"
        :style="{ width: `${MINIMAP}px`, height: `${MINIMAP}px` }"
        @click="onMinimapClick"
      >
        <span
          v-for="c in minimapCities"
          :key="c.cid"
          class="mini-city"
          :class="`mini-type-${c.type}`"
          :style="{ left: `${c.px}px`, top: `${c.py}px` }"
          :title="c.name"
        />
        <span
          class="mini-view"
          :style="{ left: `${minimapView.x - 7}px`, top: `${minimapView.y - 7}px` }"
        />
      </div>
    </FxCanvas>

    <!-- center-on-my-city -->
    <FxImage source="images/map_up.png" :x="2" :y="2" :w="0" :h="0" />
  </FxCanvas>
</template>

<style scoped>
.world-view {
  position: absolute;
  left: 2px;
  top: 8px;
  overflow: hidden;
  cursor: grab;
  background: #1c1c1c;
}

.world-view:active {
  cursor: grabbing;
}

.grid-tip {
  position: absolute;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 12px;
  border-radius: 3px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
}

.pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 6px;
}

.pad-mid {
  display: flex;
  gap: 24px;
}

.jump,
.search {
  display: flex;
  gap: 4px;
  justify-content: center;
  padding: 8px 4px 0;
}

.results {
  list-style: none;
  margin: 4px;
  padding: 2px;
  max-height: 110px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.35);
  font-size: 12px;
  color: #fff;
}

.results li {
  padding: 3px 4px;
  cursor: pointer;
}

.results li:hover {
  background: rgba(255, 255, 255, 0.15);
}

.results .owner {
  color: #9ad;
  font-size: 11px;
}

.minimap {
  position: relative;
  margin: 8px auto 0;
  background: #0d1a0d;
  border: 1px solid #3a5a3a;
  cursor: pointer;
}

.mini-city {
  position: absolute;
  width: 4px;
  height: 4px;
  margin: -2px;
  border-radius: 50%;
  background: #daa520;
}

.mini-type-4 {
  background: #ff4500;
  width: 6px;
  height: 6px;
  margin: -3px;
}

.mini-view {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 1px solid #ffff66;
  pointer-events: none;
}
</style>
