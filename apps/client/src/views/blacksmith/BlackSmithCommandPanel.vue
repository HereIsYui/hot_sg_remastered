<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import {
  BLACKSMITH_TABS,
  PORTED_TABS,
  canMergeBook,
  dismantleNeedCount,
  parseEmbedHoles,
  parseEmbedPearls,
  strongBlockReason,
  strongResultText,
} from '../../game/blacksmith';
import { useGame } from '../../game/game';
import { armorImage } from '../../game/goods';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import UseHuaShiFenDialog from '../goods/UseHuaShiFenDialog.vue';

/**
 * BlackSmith.BSCommandDialog: the 铁匠铺 command dialog. 强化 / 镶嵌 / 合成 / 技能书合并 are
 * ported; 洗练 / 熔炼 / 装备升级 show a not-yet-open notice (owned by other flows / later stages).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

type Row = Record<string, unknown>;

const tab = ref<number>(BLACKSMITH_TABS.Strong);

/** Aid goods shown across the tabs (gid -> count), kept selected like the original checkboxes. */
const aids = ref<Record<number, Row>>({});
const useTianGong = ref(true);
const useQianKun = ref(false);
const usePearlProtect = ref(false);
const useQiaoShou = ref(false);
const useSkillProtect = ref(true);

/** 强化 / 镶嵌 selected piece. */
const picked = shallowRef<Armor | null>(null);
/** The inline part picker (reuses loadUserPartArmor). */
const picking = ref<number | null>(null);
const partArmors = shallowRef<Armor[]>([]);

/** 镶嵌: the five holes + pearls of the picked piece, and the pearl list to drop in. */
const embedHoles = ref<number[]>([3, 3, 3, 3, 3]);
const embedPearls = ref<number[]>([0, 0, 0, 0, 0]);
const pearlChoices = shallowRef<Row[]>([]);
const choosingHole = ref<number | null>(null);
/** 化石粉 dialog state: the hole whose pearl is being cleared. */
const huaShiFen = ref<{ sid: number; pos: number; count: number } | null>(null);

/** 合成: the pearl list, the chosen target, its recipe and the craft count. */
const synthPearls = shallowRef<Row[]>([]);
const synthTarget = shallowRef<Row | null>(null);
const synthRecipe = shallowRef<Row[]>([]);
const synthCount = ref('1');

/** 技能书: the books and the three chosen for a merge. */
const books = shallowRef<Row[]>([]);
const mergeOnlyReady = ref(true);
const mergePick = shallowRef<Row | null>(null);

const PART_NAMES = Array.from({ length: 11 }, (_, i) => i18n(`BlackSmith_ArmorPart_${i + 1}`));

const strongPearlCount = computed(() => int(aids.value[205]?.count));
const highStrongPearlCount = computed(() => int(aids.value[11170]?.count));

function aid(gid: number): Row | undefined {
  return aids.value[gid];
}

// --------------------------------------------------------------- receivers

const unregister = game.addGlobalReceiver('blacksmith', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadEquitmentInfor') {
    d.shift(); // leading 0
    const list = rowsOf(d.shift());
    const map: Record<number, Row> = {};
    for (const g of list) map[int(g.gid)] = g;
    aids.value = map;
    const pearls = d.shift();
    if (Array.isArray(pearls)) synthPearls.value = rowsOf(pearls);
  } else if (command === 'loadEmbedPearl_OpenTab') {
    synthPearls.value = rowsOf(d.shift());
  } else if (command === 'loadStuff') {
    d.shift(); // gid echo
    synthRecipe.value = rowsOf(d.shift());
  } else if (command === 'loadEmbedPearl') {
    pearlChoices.value = rowsOf(d.shift());
  } else if (command === 'loadEmbedPearlByArmor') {
    const objs = rowsOf(d.shift());
    for (let i = 0; i < objs.length; i++) {
      // kept for tooltips; the gids already come from embed_pearls
      void objs[i];
    }
  } else if (command === 'doStrong') {
    onDoStrong(d);
  } else if (command === 'doEmbed') {
    onDoEmbed(d);
  } else if (command === 'synthStuff') {
    const got = int(d.shift());
    gameAlert(i18n('BlackSmith_SynthSucc') + got);
    refreshAids();
    if (synthTarget.value) setTarget(synthTarget.value);
  } else if (command === 'loadSkillBook_OpenTab') {
    books.value = rowsOf(d.shift());
    const protect = d.shift();
    if (protect && typeof protect === 'object') aids.value[10667] = protect as Row;
  } else if (command === 'mergeBook') {
    const success = int(d.shift());
    d.shift(); // flag
    const tabData = Array.isArray(d[0]) ? (d.shift() as unknown[]) : [];
    books.value = rowsOf(tabData[0]);
    const protect = tabData[1];
    if (protect && typeof protect === 'object') aids.value[10667] = protect as Row;
    mergePick.value = null;
    void showAlert(i18n(success === 1 ? 'BlackSmith_Merge_succ' : 'BlackSmith_Merge_fail'));
  } else if (command === 'loadPartArmor') {
    // reply of loadUserPartArmor (reused armor action) is handled by the armor receiver below
  }
});

const unregisterArmor = game.addGlobalReceiver('armor', (command, data) => {
  if (command !== 'loadUserPartArmor' || !Array.isArray(data) || data.length === 0) return;
  const rest = [...(data as unknown[])];
  partArmors.value = rowsOf(rest.shift()).map(parseArmor);
  dealWithOtherInfoOfArmor(armorInfo, rest);
});

/**
 * `openHoleSucc`: the 打孔器 / 化石粉 reply of useTypeGoods — `[armor, pearlObjs, gid]` — carries
 * the piece with its new embed_holes / embed_pearls; refresh the picked piece's holes.
 */
const unregisterUser = game.addGlobalReceiver('user', (command, data) => {
  if (command !== 'useTypeGoods' || !Array.isArray(data)) return;
  const armor = (data as unknown[])[0];
  if (!armor || typeof armor !== 'object') return;
  const a = picked.value;
  if (!a) return;
  const row = armor as Row;
  if (row.embed_holes !== undefined) {
    a.row.embed_holes = row.embed_holes as never;
    embedHoles.value = parseEmbedHoles(row.embed_holes);
  }
  if (row.embed_pearls !== undefined) {
    a.row.embed_pearls = row.embed_pearls as never;
    embedPearls.value = parseEmbedPearls(row.embed_pearls);
  }
  gameAlert(i18n('BlackSmith_OpenHoleSucc'));
});

onMounted(() => refreshAids());
onUnmounted(() => {
  unregister();
  unregisterArmor();
  unregisterUser();
});

function refreshAids() {
  game.sendGlobalCommand('blacksmith', 'loadEquitmentInfor', [
    tab.value === BLACKSMITH_TABS.PearlUpgrade ? -1 : 0,
  ]);
}

// ------------------------------------------------------------------- tabs

const TAB_LABELS = [
  'BlackSmith_xilian',
  'BlackSmith_StrongArmor',
  'BlackSmith_ArmorEmbed',
  'BlackSmith_PeralUpgrade',
  'BlackSmith_jinengshu',
  'BlackSmith_Fusion',
  'BlackSmith_upgradeArmor',
];

function showTab(t: number) {
  tab.value = t;
  picking.value = null;
  choosingHole.value = null;
  if (t === BLACKSMITH_TABS.PearlUpgrade) {
    game.sendGlobalCommand('blacksmith', 'loadEmbedPearl_OpenTab', []);
  } else if (t === BLACKSMITH_TABS.SkillBook) {
    game.sendGlobalCommand('blacksmith', 'loadSkillBook_OpenTab', []);
  }
}

// ----------------------------------------------------------------- picker

/** `showMyArmor`: open the part picker for the current tab's piece. */
function pickArmor() {
  picking.value = 0;
  game.sendGlobalCommand('armor', 'loadUserPartArmor', [1]);
}

function pickPart(part: number) {
  picking.value = part;
  game.sendGlobalCommand('armor', 'loadUserPartArmor', [part]);
}

function chooseArmor(a: Armor) {
  picked.value = a;
  picking.value = null;
  if (tab.value === BLACKSMITH_TABS.Embed) {
    embedHoles.value = parseEmbedHoles(a.row.embed_holes);
    embedPearls.value = parseEmbedPearls(a.row.embed_pearls);
  }
}

// ------------------------------------------------------------------ 强化

function doStrong() {
  const a = picked.value;
  const reason = strongBlockReason(
    a?.row ?? null,
    strongPearlCount.value,
    highStrongPearlCount.value,
  );
  if (reason) {
    void showAlert(i18n(reason));
    return;
  }
  if (!a) return;
  game.sendGlobalCommand('blacksmith', 'doStrong', [
    city.cid,
    int(aid(203)?.gid) || 203,
    useTianGong.value ? 1 : 0,
    int(aid(204)?.gid) || 204,
    useQianKun.value ? 1 : 0,
    a.sid,
  ]);
}

function onDoStrong(d: unknown[]) {
  const ok = int(d.shift());
  const a = picked.value;
  if (ok === 1 && a) {
    const result = int(d.shift());
    const value = d.shift();
    const best = d.shift();
    a.row.strong_value = value as never;
    a.row.best_quality = best as never;
    if (result === 0) {
      const bonus = str(d.shift());
      void showAlert(strongResultText(0, bonus));
      a.row.strong_level = (int(a.row.strong_level) + 1) as never;
    } else {
      void showAlert(strongResultText(result, ''));
      if (result === 1) a.row.strong_level = 0 as never;
      else if (result === 2) a.row.strong_level = (int(a.row.strong_level) - 1) as never;
    }
    refreshAids();
  } else if (ok === 0) {
    picked.value = null;
    void showAlert(str(d.shift()));
  }
}

// ------------------------------------------------------------------ 镶嵌

function selectHole(pos: number) {
  const a = picked.value;
  if (!a) {
    void showAlert(i18n('BlackSmith_NoArmor'));
    return;
  }
  const code = embedHoles.value[pos];
  // A locked hole opens the matching 打孔器 picker (初级 24 / 高级 25 / 特级金刚钻 28).
  if (code === 1 || code === 2 || code === 4) {
    if (code === 4) {
      // 特级金刚钻 only opens on 紫装 / 橙装 (type 5 / 6).
      const type = int(a.row.type);
      if (type !== 5 && type !== 6) {
        void showAlert(i18n('BlackSmith_ArmorEmbed_not_purple'));
        return;
      }
    }
    const type = code === 1 ? 24 : code === 2 ? 25 : 28;
    game.showUseGoodsDialog(0, type, [a.sid, pos]);
    return;
  }
  if (code === 0) {
    const pearl = embedPearls.value[pos] ?? 0;
    if (pearl === 0) {
      // an empty hole: pick a pearl to embed
      choosingHole.value = pos;
      game.sendGlobalCommand('blacksmith', 'loadEmbedPearl', [pos]);
    } else {
      // a filled hole: 化石粉 clears the pearl out
      huaShiFen.value = { sid: a.sid, pos, count: dismantleNeedCount(pearl) };
    }
  }
}

function embedPearl(gid: number) {
  const a = picked.value;
  const pos = choosingHole.value;
  if (!a || pos == null) return;
  game.sendGlobalCommand('blacksmith', 'doEmbed', [a.sid, pos, gid]);
}

function onDoEmbed(d: unknown[]) {
  const ok = int(d.shift());
  if (ok === 1) {
    const inner = int(d.shift());
    if (inner === 0) {
      void showAlert(i18n('BlackSmith_EmbedSucc'));
      const pearls = str(d.shift());
      if (picked.value) {
        picked.value.row.embed_pearls = pearls as never;
        embedPearls.value = parseEmbedPearls(pearls);
      }
      choosingHole.value = null;
      pearlChoices.value = [];
    }
  } else if (ok === 0) {
    picked.value = null;
    void showAlert(str(d.shift()));
  }
}

// ------------------------------------------------------------------ 合成

function setTarget(row: Row) {
  synthTarget.value = row;
  game.sendGlobalCommand('blacksmith', 'loadStuff', [int(row.gid)]);
}

function synth() {
  const t = synthTarget.value;
  const n = int(synthCount.value);
  if (!t) {
    void showAlert(i18n('BlackSmith_NoSynthStuff'));
    return;
  }
  if (n <= 0) {
    void showAlert(i18n('BlackSmith_LargeZero'));
    return;
  }
  game.sendGlobalCommand('blacksmith', 'synthStuff', [
    city.cid,
    int(t.gid),
    n,
    useQiaoShou.value ? 1 : 0,
    usePearlProtect.value ? 1 : 0,
  ]);
}

// ------------------------------------------------------------- 技能书合并

const shownBooks = computed(() =>
  books.value.filter((b) =>
    mergeOnlyReady.value ? int(b.count) >= 3 && int(b.level) < 10 : int(b.count) > 0,
  ),
);

function pickBook(b: Row) {
  if (canMergeBook(int(b.level), int(b.count))) mergePick.value = b;
}

function mergeBook() {
  const b = mergePick.value;
  if (!b) {
    void showAlert(i18n('BlackSmith_NoSynthStuff'));
    return;
  }
  game.sendGlobalCommand('blacksmith', 'mergeBook', [
    int(b.skill),
    int(b.level),
    useSkillProtect.value ? 1 : 0,
  ]);
}
</script>

<template>
  <FxCanvas :x="(736 - 650) / 2" :y="(556 - 370) / 2" :w="650" :h="370" style-name="PopupDialog">
    <FxButton :right="8" :y="6" style-name="Close" @click="emit('close')" />

    <!-- tab bar -->
    <FxCanvas :x="4" :y="8" :w="642" :h="43" style-name="BoardListUp">
      <FxButton
        v-for="(label, i) in TAB_LABELS"
        :key="i"
        :x="2 + i * 75"
        :y="2"
        :w="73"
        :h="37"
        style-name="ButtonYellow"
        :label="i18n(label)"
        :selected="tab === i"
        @click="showTab(i)"
      />
    </FxCanvas>

    <!-- not-ported tabs -->
    <FxCanvas
      v-if="!PORTED_TABS.has(tab)"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxLabel
        :x="40"
        :y="140"
        :w="560"
        :fx="{ textAlign: 'center' }"
        :text="i18n('BlackSmith_NotYetValid')"
      />
    </FxCanvas>

    <!-- 强化 -->
    <FxCanvas
      v-else-if="tab === BLACKSMITH_TABS.Strong"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxLabel :x="90" :y="10" :w="120" :text="i18n('BlackSmith_ArmorSelect')" />
      <FxImage
        v-if="picked"
        :x="90"
        :y="40"
        :w="64"
        :h="64"
        :source="armorImage(picked.row)"
        @click="pickArmor()"
      />
      <FxButton v-else :x="90" :y="40" :w="64" :h="64" :label="'+'" @click="pickArmor()" />
      <FxLabel v-if="picked" :x="90" :y="108" :w="120" :text="`+${int(picked.row.strong_level)}`" />
      <FxLabel
        :x="240"
        :y="40"
        :w="160"
        :text="`${i18n('BlackSmith_StrongPearl')}: ${strongPearlCount}/${highStrongPearlCount}`"
      />
      <FxButton
        :x="240"
        :y="80"
        style-name="ButtonYellow"
        :selected="useTianGong"
        :label="`${i18n('BlackSmith_GoodsSelect')} 天工符(${int(aid(203)?.count)})`"
        @click="useTianGong = !useTianGong"
      />
      <FxButton
        :x="240"
        :y="120"
        style-name="ButtonYellow"
        :selected="useQianKun"
        :label="`乾坤宝珠(${int(aid(204)?.count)})`"
        @click="useQianKun = !useQianKun"
      />
      <FxButton
        :x="160"
        :y="210"
        style-name="ButtonYellow"
        :label="i18n('BlackSmith_Strong')"
        @click="doStrong()"
      />
      <FxText :x="440" :y="20" :w="190" :h="270" :html="i18n('BlackSmith_xilian_guid')" />
    </FxCanvas>

    <!-- 镶嵌 -->
    <FxCanvas
      v-else-if="tab === BLACKSMITH_TABS.Embed"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxImage
        v-if="picked"
        :x="170"
        :y="120"
        :w="64"
        :h="64"
        :source="armorImage(picked.row)"
        @click="pickArmor()"
      />
      <FxButton v-else :x="170" :y="120" :w="64" :h="64" label="+" @click="pickArmor()" />
      <FxButton
        v-for="pos in 5"
        :key="pos"
        :x="[32, 63, 176, 288, 319][pos - 1]"
        :y="[154, 59, 22, 59, 154][pos - 1]"
        :w="32"
        :h="32"
        :label="embedPearls[pos - 1] ? '●' : embedHoles[pos - 1] === 0 ? '○' : '×'"
        @click="selectHole(pos - 1)"
      />
      <FxText :x="440" :y="20" :w="190" :h="270" :html="i18n('BlackSmith_EmbedDesc')" />
      <!-- pearl chooser -->
      <FxCanvas
        v-if="choosingHole !== null"
        :x="20"
        :y="40"
        :w="400"
        :h="240"
        style-name="BoardListDown"
      >
        <FxButton
          v-for="(p, i) in pearlChoices"
          :key="String(p.gid)"
          :x="10 + (i % 6) * 60"
          :y="10 + Math.floor(i / 6) * 40"
          :w="56"
          :h="34"
          :label="str(p.name)"
          @click="embedPearl(int(p.gid))"
        />
        <FxButton :right="6" :y="6" style-name="Close" @click="choosingHole = null" />
      </FxCanvas>
    </FxCanvas>

    <!-- 合成 -->
    <FxCanvas
      v-else-if="tab === BLACKSMITH_TABS.PearlUpgrade"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxLabel v-if="synthTarget" :x="140" :y="20" :w="200" :text="str(synthTarget.name)" />
      <FxTextInput v-model="synthCount" :x="330" :y="20" :w="57" :h="24" />
      <FxButton
        :x="140"
        :y="74"
        style-name="ButtonYellow"
        :label="i18n('BlackSmith_Upgrade')"
        @click="synth()"
      />
      <FxButton
        :x="12"
        :y="20"
        style-name="ButtonYellow"
        :selected="useQiaoShou"
        :label="`巧手符(${int(aid(202)?.count)})`"
        @click="useQiaoShou = !useQiaoShou"
      />
      <FxButton
        :x="12"
        :y="92"
        style-name="ButtonYellow"
        :selected="usePearlProtect"
        :label="`保护符(${int(aid(11172)?.count)})`"
        @click="usePearlProtect = !usePearlProtect"
      />
      <FxLabel
        v-for="(s, i) in synthRecipe"
        :key="String(s.gid)"
        :x="80 + i * 120"
        :y="170"
        :w="110"
        :text="`${str(s.name)} ${int(s.count)}`"
      />
      <!-- pearl grid -->
      <FxCanvas :x="440" :y="10" :w="197" :h="290" style-name="BoardListUp" scroll-y>
        <FxButton
          v-for="(p, i) in synthPearls"
          :key="String(p.gid)"
          :x="8 + (i % 3) * 60"
          :y="8 + Math.floor(i / 3) * 40"
          :w="56"
          :h="34"
          :label="str(p.name)"
          @click="setTarget(p)"
        />
      </FxCanvas>
    </FxCanvas>

    <!-- 技能书合并 -->
    <FxCanvas
      v-else-if="tab === BLACKSMITH_TABS.SkillBook"
      :x="4"
      :y="55"
      :w="642"
      :h="310"
      style-name="BoardListUp"
    >
      <FxButton
        :x="8"
        :y="6"
        style-name="ButtonYellow"
        :selected="mergeOnlyReady"
        :label="i18n('BlackSmith_jinengshu_ins1')"
        @click="mergeOnlyReady = !mergeOnlyReady"
      />
      <FxCanvas :x="7" :y="34" :w="258" :h="230" style-name="BoardListUp" scroll-y>
        <FxButton
          v-for="(b, i) in shownBooks"
          :key="`${b.skill}-${b.level}`"
          :x="12 + (i % 3) * 82"
          :y="10 + Math.floor(i / 3) * 40"
          :w="78"
          :h="34"
          :selected="mergePick === b"
          :label="`${str(b.name)} ${int(b.level)}级×${int(b.count)}`"
          @click="pickBook(b)"
        />
      </FxCanvas>
      <FxCanvas :x="273" :y="10" :w="363" :h="252" style-name="BoardListUp">
        <FxLabel :x="20" :y="20" :w="320" :text="i18n('BlackSmith_skillBookSelect')" />
        <FxLabel
          v-if="mergePick"
          :x="20"
          :y="60"
          :w="320"
          :text="`${str(mergePick.name)} ${int(mergePick.level)}级 → ${int(mergePick.level) + 1}级`"
        />
        <FxButton
          :x="248"
          :y="15"
          style-name="ButtonYellow"
          :selected="useSkillProtect"
          :label="`技能保护符(${int(aid(10667)?.count)})`"
          @click="useSkillProtect = !useSkillProtect"
        />
        <FxButton
          :x="134"
          :y="207"
          :w="80"
          :h="33"
          style-name="ButtonYellow"
          :label="i18n('BlackSmith_jinengshu1')"
          @click="mergeBook()"
        />
      </FxCanvas>
    </FxCanvas>

    <!-- inline part picker (reuses loadUserPartArmor) -->
    <FxCanvas v-if="picking !== null" :x="20" :y="55" :w="610" :h="310" style-name="PopupDialog">
      <FxButton :right="6" :y="6" style-name="Close" @click="picking = null" />
      <FxCanvas :x="10" :y="10" :w="590" :h="30">
        <FxButton
          v-for="(name, i) in PART_NAMES"
          :key="i"
          :x="2 + i * 53"
          :y="0"
          :w="51"
          :h="26"
          style-name="ButtonYellow"
          :label="name"
          :selected="picking === i + 1"
          @click="pickPart(i + 1)"
        />
      </FxCanvas>
      <FxCanvas :x="10" :y="46" :w="590" :h="250" style-name="BoardListDown" scroll-y>
        <FxImage
          v-for="(a, i) in partArmors"
          :key="a.sid"
          :x="10 + (i % 7) * 82"
          :y="10 + Math.floor(i / 7) * 82"
          :w="64"
          :h="64"
          :source="armorImage(a.row)"
          @click="chooseArmor(a)"
        />
      </FxCanvas>
    </FxCanvas>

    <UseHuaShiFenDialog
      v-if="huaShiFen"
      :sid="huaShiFen.sid"
      :pos="huaShiFen.pos"
      :count="huaShiFen.count"
      @close="huaShiFen = null"
    />
  </FxCanvas>
</template>
