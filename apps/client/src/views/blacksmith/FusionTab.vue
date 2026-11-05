<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import { fusionSlotError, fusionSubmitError } from '../../game/blacksmith';
import { useGame } from '../../game/game';
import { armorImage } from '../../game/goods';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import { showMenu } from '../../ui/menu';
import { stagePoint } from '../../ui/tooltip';

/**
 * BSCommandDialog's 熔炼 tab: three equal pieces of one combine level go into the main / left /
 * right slots (from the 装备 list, loadPartArmor / reloadArmor); combineArmor raises the main
 * piece a level. 查看 lists every fusable group (loadFusionableArmor) for reference only.
 */
type Row = Record<string, unknown>;
defineProps<{ protect: Row | undefined }>();
const emit = defineEmits<{ refresh: [] }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);

const SUB_TABS = ['BlackSmith_FusionInstr', 'BlackSmith_FusionArmor', 'BlackSmith_FusionPart'];
const SLOT_LABELS = [
  'BlackSmith_FusionMainArmor',
  'BlackSmith_FusionLeftAddArmor',
  'BlackSmith_FusionRightAddArmor',
];
const SLOT_POS = [
  { x: 118, y: 30 },
  { x: 30, y: 120 },
  { x: 206, y: 120 },
];
const PART_FILTERS = Array.from({ length: 11 }, (_, i) => i18n(`BlackSmith_ArmorPart_${i + 1}`));
const TIE_FILTERS = Array.from({ length: 16 }, (_, i) => i18n(`BlackSmith_ArmorPartTie_${i}`));

const subTab = ref(0);
const onlyReady = ref(true);
const groups = shallowRef<Row[]>([]);
const part = ref(0);
const partTie = ref(0);
const pieces = shallowRef<Armor[]>([]);
/** main, left, right */
const slots = shallowRef<(Armor | null)[]>([null, null, null]);
const result = shallowRef<Armor | null>(null);
const useProtect = ref(false);

const shownGroups = computed(() =>
  groups.value.filter(
    (g) => int(g.count) !== 0 && (!onlyReady.value || (int(g.count) >= 3 && int(g.level) <= 120)),
  ),
);
const shownPieces = computed(() => pieces.value.filter((a) => int(a.row.hero_level) <= 120));

const unregister = game.addGlobalReceiver('blacksmith', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadFusionableArmor') {
    d.shift();
    groups.value = rowsOf(d.shift());
  } else if (command === 'loadPartArmor' || command === 'reloadArmor') {
    d.splice(0, 2);
    pieces.value = rowsOf(d.shift()).map(parseArmor);
    dealWithOtherInfoOfArmor(armorInfo, d);
  } else if (command === 'combineArmor') {
    onCombine(d);
  }
});

onMounted(() => showSubTab(0));
onUnmounted(unregister);

function showSubTab(t: number) {
  subTab.value = t;
  if (t === 1) game.sendGlobalCommand('blacksmith', 'loadFusionableArmor', [1]);
  else if (t === 2) loadPieces();
}

/** `switchArmorPart`: the part list, skipping the pieces already in a slot. */
function loadPieces() {
  const refs = slots.value.filter((s): s is Armor => !!s).map((s) => s.sid);
  if (refs.length === 0) {
    game.sendGlobalCommand('blacksmith', 'loadPartArmor', [part.value + 1, partTie.value]);
  } else {
    game.sendGlobalCommand('blacksmith', 'reloadArmor', [refs, part.value + 1, partTie.value]);
  }
}

function setPart(i: number) {
  part.value = i;
  loadPieces();
}

function setTie(i: number) {
  partTie.value = i;
  loadPieces();
}

/** `ArmorItem.menuHandler`: put a listed piece into the chosen slot. */
async function onPiece(a: Armor, e: MouseEvent) {
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  const choice = await showMenu(
    SLOT_LABELS.map((label, i) => ({ label: i18n(label), data: String(i) })),
    p.x,
    p.y,
  );
  if (choice == null) return;
  const i = int(choice);
  const chosen = slots.value.filter((s): s is Armor => !!s).map((s) => s.row);
  const error = fusionSlotError(chosen, !!slots.value[i], a.row);
  if (error) {
    void showAlert(i18n(error));
    return;
  }
  const next = [...slots.value];
  next[i] = a;
  slots.value = next;
  result.value = null;
  loadPieces();
}

/** `FusionItem.offArmor`: take a piece back out of its slot. */
function offSlot(i: number) {
  if (!slots.value[i]) return;
  const next = [...slots.value];
  next[i] = null;
  slots.value = next;
  if (subTab.value === 2) loadPieces();
}

/** `doFusion` / `submitFusion` */
async function fuse() {
  const error = fusionSubmitError(slots.value.map((s) => s?.row ?? null));
  if (error) {
    void showAlert(i18n(error));
    return;
  }
  const flag = useProtect.value ? 1 : 0;
  if (flag === 0) {
    const ok = await showAlert(i18n('BlackSmith_FusionNotUseProctTip'), '', ['yes', 'no']);
    if (ok !== 'yes') return;
  }
  const [main, left, right] = slots.value as Armor[];
  game.sendGlobalCommand('blacksmith', 'combineArmor', [main!.sid, 1, left!.sid, right!.sid, flag]);
}

/** `combineResult` */
function onCombine(d: unknown[]) {
  const success = int(d.shift());
  d.shift(); // the 熔炼保护符 row; the aids refresh below carries it
  if (success === 1) {
    const armors = rowsOf(d.shift());
    dealWithOtherInfoOfArmor(armorInfo, d);
    slots.value = [null, null, null];
    result.value = armors[0] ? parseArmor(armors[0]) : null;
    void showAlert(i18n('BlackSmith_FusionArmorSucc'));
  } else {
    result.value = null;
    // A protected failure keeps the three pieces in place.
    if (int(d.shift()) !== 1) slots.value = [null, null, null];
    void showAlert(i18n('BlackSmith_FusionArmorFail'));
  }
  showSubTab(subTab.value);
  emit('refresh');
}
</script>

<template>
  <FxCanvas :x="4" :y="55" :w="642" :h="310" style-name="BoardListUp">
    <!-- slots -->
    <FxCanvas :x="6" :y="6" :w="302" :h="298" style-name="BoardListDown">
      <template v-for="(pos, i) in SLOT_POS" :key="i">
        <FxLabel
          :x="pos.x - 18"
          :y="pos.y - 22"
          :w="100"
          :fx="{ textAlign: 'center' }"
          :text="i18n(SLOT_LABELS[i]!)"
        />
        <FxImage
          v-if="slots[i]"
          :x="pos.x"
          :y="pos.y"
          :w="64"
          :h="64"
          :source="armorImage(slots[i]!.row)"
          hand
          @click="offSlot(i)"
        />
        <FxCanvas v-else :x="pos.x" :y="pos.y" :w="64" :h="64" style-name="FramePicture" />
        <FxLabel
          v-if="slots[i]"
          :x="pos.x - 18"
          :y="pos.y + 66"
          :w="100"
          :fx="{ textAlign: 'center' }"
          :text="`${str(slots[i]!.row.name)} ${i18n('BlackSmith_FusionLevel')}${int(slots[i]!.row.combine_level)}`"
        />
      </template>
      <FxImage v-if="result" :x="118" :y="140" :w="64" :h="64" :source="armorImage(result.row)" />
      <FxLabel
        v-if="result"
        :x="100"
        :y="206"
        :w="100"
        :fx="{ textAlign: 'center', color: 16762880 }"
        :text="`${str(result.row.name)} ${i18n('BlackSmith_FusionLevel')}${int(result.row.combine_level)}`"
      />
      <FxButton
        :x="10"
        :y="250"
        :w="170"
        style-name="ButtonYellow"
        :selected="useProtect"
        :label="`${str(protect?.name)}(${int(protect?.count)})`"
        @click="useProtect = !useProtect"
      />
      <FxButton
        :x="200"
        :y="250"
        :w="90"
        style-name="ButtonYellow"
        :label="i18n('BlackSmith_FusionBtn')"
        @click="fuse()"
      />
    </FxCanvas>

    <!-- 说明 / 查看 / 装备 -->
    <FxCanvas :x="314" :y="6" :w="322" :h="298" style-name="BoardListDown">
      <FxButton
        v-for="(label, i) in SUB_TABS"
        :key="i"
        :x="6 + i * 70"
        :y="4"
        :w="68"
        style-name="ButtonYellow"
        :selected="subTab === i"
        :label="i18n(label)"
        @click="showSubTab(i)"
      />
      <FxText
        v-if="subTab === 0"
        :x="8"
        :y="36"
        :w="306"
        :h="256"
        :html="i18n('BlackSmith_FusionInstrText')"
      />
      <template v-else-if="subTab === 1">
        <FxButton
          :x="6"
          :y="34"
          :w="310"
          style-name="ButtonYellow"
          :selected="onlyReady"
          :label="
            i18n(
              onlyReady ? 'BlackSmith_FusionShowConditionArmor' : 'BlackSmith_FusionShowAllArmor',
            )
          "
          @click="onlyReady = !onlyReady"
        />
        <FxCanvas :x="6" :y="66" :w="310" :h="226" scroll-y>
          <FxLabel
            v-for="(g, i) in shownGroups"
            :key="`${g.id}-${g.combine_level}`"
            :x="6"
            :y="4 + i * 22"
            :w="296"
            :text="`${str(g.name)}  ${i18n('BlackSmith_FusionLevel')}${int(g.combine_level)}  ×${int(g.count)}`"
          />
        </FxCanvas>
      </template>
      <template v-else>
        <FxComboBox
          :selected-index="part"
          :x="6"
          :y="34"
          :w="100"
          :row-count="11"
          :items="PART_FILTERS"
          @update:selected-index="setPart"
        />
        <FxComboBox
          :selected-index="partTie"
          :x="112"
          :y="34"
          :w="140"
          :row-count="10"
          :items="TIE_FILTERS"
          @update:selected-index="setTie"
        />
        <FxCanvas :x="6" :y="64" :w="310" :h="228" scroll-y>
          <template v-for="(a, i) in shownPieces" :key="a.sid">
            <FxImage
              :x="8 + (i % 4) * 76"
              :y="4 + Math.floor(i / 4) * 86"
              :w="64"
              :h="64"
              :source="armorImage(a.row)"
              hand
              @click="onPiece(a, $event)"
            />
            <FxLabel
              :x="(i % 4) * 76"
              :y="68 + Math.floor(i / 4) * 86"
              :w="80"
              :fx="{ textAlign: 'center' }"
              :text="`${i18n('BlackSmith_FusionLevel')}${int(a.row.combine_level)}`"
            />
          </template>
        </FxCanvas>
      </template>
    </FxCanvas>
  </FxCanvas>
</template>
