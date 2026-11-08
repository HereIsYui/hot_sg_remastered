<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import {
  ACTIVATABLE_ARMOR_IDS,
  MORIZHIREN_ID,
  armorInfo,
  armorItemName,
  armorTip,
  armorTipRow,
  dealWithOtherInfoOfArmor,
  filterStoreArmors,
  isEnhanced,
  needsRenovate,
  parseArmor,
  renovateCost,
  sellPrice,
  type Armor,
} from '../../game/armor';
import { armorShowTip } from '../../game/chatLink';
import { useGame } from '../../game/game';
import { PAGE_ITEM_COUNT, itemPosition, pageCount } from '../../game/goods';
import { i18n } from '../../i18n';
import { useChatStore } from '../../stores/chat';
import { useCityStore } from '../../stores/city';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';
import { showMenu, type MenuItem } from '../../ui/menu';
import { stagePoint, vTip } from '../../ui/tooltip';
import ArmorRenovatePayDialog from '../hero/ArmorRenovatePayDialog.vue';
import ActiveArmorSpecial from './ActiveArmorSpecial.vue';
import UserArmorItem from './UserArmorItem.vue';

/**
 * Armor.ArmorDialog (我的装备, opened from the info panel): the unworn pieces, 21 to a page,
 * filtered by part and quality; each can be sold, analyzed, activated or broken up, and the
 * listed ones repaired or renovated together. The blacksmith / barn / union-store modes are
 * opened from those dialogs.
 */
const game = useGame();
const city = useCityStore();
const chat = useChatStore();

type Row = Record<string, unknown>;
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const src = (n: number | string) => i18n(`Armor_ArmorDialogSrc_${n}`);
const send = (command: string, ...args: (number | string)[]) =>
  game.sendGlobalCommand('armor', command, args);

const MARKET_BID = 13;
/** useTypeGoods type of the 武器架 (`useArmorShelf`). */
const ARMOR_SHELF_TYPE = 30;
/** `repairAllArmor` / `renovateAllArmor` hid of the store's own pieces. */
const STORE_HID = -5;
const PART_FILTERS = Array.from({ length: 13 }, (_, i) => i18n(`Armor_ArmorDialog_${i + 4}`));
const QUALITY_FILTERS = Array.from({ length: 7 }, (_, i) => i18n(`ArmorDialog_ArmorType_${i}`));

const armors = ref<Armor[]>([]);
const maxCount = ref(0);
const part = ref(0);
const quality = ref(0);
const curPage = ref(0);
/** `selectOrClick`: clicks pick pieces for 批量分解 instead of opening the menu. */
const selecting = ref(false);
const selected = ref<Armor[]>([]);
const special = ref<Armor | null>(null);
const renovate = ref<{ cost: number; param: (number | string)[] } | null>(null);
let lastSids: number[] = [];

const listed = computed(() => filterStoreArmors(armors.value, part.value, quality.value));
const pages = computed(() => pageCount(listed.value.length));
const shown = computed(() =>
  listed.value.slice(curPage.value * PAGE_ITEM_COUNT, (curPage.value + 1) * PAGE_ITEM_COUNT),
);
const isSelected = (a: Armor) => selected.value.some((s) => s.sid === a.sid);

watch([part, quality], () => (curPage.value = 0));
watch(pages, (n) => {
  if (curPage.value > 0 && curPage.value >= n) curPage.value = n - 1;
});

function load() {
  send('loadUserArmor');
}

function onPrevPage() {
  if (curPage.value > 0) curPage.value--;
}

function onNextPage() {
  if (curPage.value < pages.value - 1) curPage.value++;
}

/** `doSelectMulti` */
function onToggleSelect(on: boolean) {
  selecting.value = on;
  if (!on) selected.value = [];
}

/** A 2级密码-guarded action: the dialog closes for the password and reopens to run it. */
function guarded(type: string, action: () => void) {
  game.requestUnlock(type, () => {
    game.showDialog('armor');
    void nextTick(action);
  });
}

/** `onClickSell` / `doValidateArmorType` */
async function onSell(a: Armor) {
  const market = city.buildings.find((b) => b.bid === MARKET_BID);
  if (!market || market.level < 5) {
    void showAlert(src(13));
    return;
  }
  const prompt = src(14) + sellPrice(a) + src(15);
  if ((await showAlert(prompt, '', ['yes', 'no'])) !== 'yes') return;
  const cid = city.cid;
  const sell = () => send('sellArmor', cid, a.sid);
  if (int(a.row.type) >= 4) guarded('sellArmor', sell);
  else sell();
}

/** `onClickAnalyze` / `doValidateType` */
async function onAnalyze(a: Armor) {
  if ((await showAlert(i18n('Armor_UserArmorItem_7'), '', ['yes', 'no'])) !== 'yes') return;
  const analyze = () => send('multipAnalyzeArmor', a.sid);
  if (int(a.row.type) >= 4) guarded('analyArmor', analyze);
  else analyze();
}

/** `doMultiOperateArmor` / `doMultiQuery` / `sendMultiAnalyzeCommand` */
async function onMultiAnalyze() {
  if ((await showAlert(i18n('Armor_ArmorDialog_analyze_multi_1'), '', ['yes', 'no'])) !== 'yes') {
    return;
  }
  const list = [...selected.value];
  if (list.length === 0) {
    void showAlert(i18n('Armor_ArmorDialog_analyze_multi_2'));
    return;
  }
  if (list.some((a) => isEnhanced(a.row))) {
    const answer = await showAlert(i18n('Armor_ArmorDialog_analyze_multi_tooltip'), '', [
      'yes',
      'no',
    ]);
    if (answer !== 'yes') return;
  }
  const analyze = () => send('multipAnalyzeArmor', ...list.map((a) => a.sid));
  if (list.some((a) => int(a.row.type) >= 4)) guarded('multipAnalyArmor', analyze);
  else analyze();
}

/** `UserArmorItem.menuHandler` 拆解 */
async function onBreakUp(a: Armor) {
  if (String(a.row.embed_holes ?? '') === '') {
    void showAlert(i18n('BlackSmith_CannotChaijie'));
    return;
  }
  if ((await showAlert(i18n('BlackSmith_CanChaijie'), '', ['yes', 'no'])) === 'yes') {
    send('zhuangbeichaijie', a.sid);
  }
}

/**
 * `UserArmorItem.menuHandler` 展示: queue the piece into the bottom-bar chat input as an item
 * link; the `UserArmorItem_Full_ArmorShow` alert fires when three pieces are already queued.
 */
function onShow(a: Armor) {
  const ok = chat.addItemLink({
    sid: a.sid,
    name: armorItemName(a.row),
    tip: armorShowTip(armorTip(armorInfo, armorTipRow(a)), a.imageName),
  });
  if (!ok) void showAlert(i18n('UserArmorItem_Full_ArmorShow'));
}

/** `UserArmorItem.onNewClickGoods`: toggles the batch selection, or opens the piece's menu. */
async function onPick(a: Armor, e: MouseEvent) {
  if (selecting.value) {
    selected.value = isSelected(a)
      ? selected.value.filter((s) => s.sid !== a.sid)
      : [...selected.value, a];
    return;
  }
  const menu: MenuItem[] = [
    { label: i18n('Armor_UserArmorItem_3_1'), data: 'sell' },
    { label: i18n('Armor_UserArmorItem_4_1'), data: 'show' },
    {
      label: i18n('Armor_UserArmorItem_5_1'),
      data: 'active',
      enabled: ACTIVATABLE_ARMOR_IDS.includes(int(a.row.id ?? a.row.armorid)),
    },
    { label: i18n('Armor_UserArmorItem_6_1'), data: 'analyze' },
    {
      label: i18n('BlackSmith_Active'),
      data: 'blacksmith_active',
      enabled: String(a.row.embed_holes ?? '') === '',
    },
    { label: i18n('BlackSmith_Chaijie'), data: 'blacksmith_chajie' },
  ];
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  const action = await showMenu(menu, p.x, p.y);
  if (action === 'sell') void onSell(a);
  else if (action === 'show') onShow(a);
  else if (action === 'active') special.value = a;
  else if (action === 'analyze') void onAnalyze(a);
  else if (action === 'blacksmith_active') send('initHoles', city.cid, a.sid);
  else if (action === 'blacksmith_chajie') void onBreakUp(a);
}

/** `onClickRepairAllArmor`: the listed pieces still holding durability. */
async function onRepairAll() {
  const list = listed.value.filter((a) => a.hp > 0 && a.hp < a.hpMax);
  const cost = list.reduce((sum, a) => sum + a.hpMax - a.hp, 0);
  if (cost === 0) {
    void showAlert(src(18));
    return;
  }
  if ((await showAlert(src(16) + cost + src(17), '', ['yes', 'no'])) !== 'yes') return;
  lastSids = list.map((a) => a.sid);
  send('repairAllArmor', city.cid, STORE_HID, lastSids.join(','));
}

/** `onClickRenovateAllArmor` */
function onRenovateAll() {
  const list = listed.value.filter(needsRenovate);
  const cost = list.reduce((sum, a) => sum + renovateCost(a), 0);
  if (cost === 0) {
    void showAlert(src(21));
    return;
  }
  renovate.value = { cost, param: [STORE_HID, list.map((a) => a.sid).join(',')] };
}

function payRenovation(byGift: boolean) {
  if (renovate.value) send(`renovateAllArmor${byGift ? 'WithGift' : ''}`, ...renovate.value.param);
}

/** `onLoadUserArmor` */
function onLoad(d: unknown[]) {
  if (d.length > 0) {
    maxCount.value = int(d.shift());
    armors.value = rowsOf(d.shift()).map(parseArmor);
    dealWithOtherInfoOfArmor(armorInfo, d);
  }
  selecting.value = false;
  selected.value = [];
}

/** `onSellArmor`: `[sid, cid, gold, event gift?]` */
function onSold(d: unknown[]) {
  const sid = int(d[0]);
  armors.value = armors.value.filter((a) => a.sid !== sid);
  if (int(d[1]) === city.cid) city.gold = int(d[2]);
  gameAlert(src(3) + (d.length > 3 ? String(d[3]) : ''));
}

/** `activeArmorSpecial`: 末日之刃 keeps the panel for another roll; others reload the store. */
function onActivated(d: unknown[]) {
  const row = rowsOf(d[0])[0] ?? {};
  if (int(row.armorid) === MORIZHIREN_ID) {
    const a = armors.value.find((x) => x.sid === int(row.sid));
    if (a) {
      a.row = {
        ...a.row,
        specialAttid: row.specialAttid,
        specialValue: row.specialValue,
        active_special: row.active_special,
      };
      special.value = { ...a };
    } else {
      special.value = null;
    }
  } else {
    load();
  }
  void showAlert(String(d[1] ?? ''));
}

const unregister = game.addGlobalReceiver('armor', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  switch (command) {
    case 'loadUserArmor':
    case 'loadUserActivedArmor':
      onLoad(d);
      break;
    case 'sellArmor':
      onSold(d);
      break;
    case 'repairAllArmor':
      for (const a of armors.value) {
        if (!lastSids.includes(a.sid)) continue;
        a.hpMax = Math.max(0, a.hpMax - Math.max(1, Math.ceil((a.hpMax - a.hp) / 10)));
        a.hp = a.hpMax;
      }
      if (int(d[1]) === city.cid) city.gold = int(d[2]);
      gameAlert(src(4));
      break;
    case 'renovateAllArmor':
    case 'renovateAllArmorWithGift':
      for (const a of listed.value) {
        a.hpMax = a.oriHpMax;
        a.hp = a.hpMax;
      }
      gameAlert(src(5));
      break;
    case 'activeArmorSpecial':
      onActivated(d);
      break;
    case 'initHoles':
      load();
      void showAlert(i18n('BlackSmith_ActiveArmorSucc') + int(d[0]));
      break;
    case 'zhuangbeichaijie':
    case 'multipAnalyzeArmor':
      void showAlert(String(d[0] ?? ''));
      load();
      break;
  }
});
/** `setArmorMaxCount`: a 武器架 used from the picker this dialog opened. */
const unregisterUser = game.addGlobalReceiver('user', (command, data) => {
  if (command !== 'useTypeGoods' || game.session.useGoods?.type !== ARMOR_SHELF_TYPE) return;
  const count = int(Array.isArray(data) ? data[0] : 0);
  void showAlert(i18n('Armor_ArmorDialog_ShelfAddSucc') + count);
  maxCount.value = count;
});
onUnmounted(() => {
  unregister();
  unregisterUser();
});
load();
</script>

<template>
  <FxCanvas
    :w="682"
    :h="492"
    style-name="PanelGreyGreen"
    :fx="{ fontSize: 12, borderStyle: 'none', backgroundColor: 8026746 }"
  >
    <FxImage :x="215" :y="21" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="25"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Armor_ArmorDialog_1_1')"
    />
    <FxButton :x="587" :y="434" style-name="Close" @click="game.closeDialog()" />
    <FxCanvas v-if="pages > 1" :x="462" :y="65" :w="210" :h="36">
      <FxCanvas :x="8" :y="6" :w="70" :h="25" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="70"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="`${curPage + 1}/${pages}`"
        />
      </FxCanvas>
      <FxButton :x="78" :y="0" :w="65" :label="i18n('Armor_ArmorDialog_2_1')" @click="onPrevPage" />
      <FxButton
        :x="141"
        :y="0"
        :w="65"
        :label="i18n('Armor_ArmorDialog_3_1')"
        @click="onNextPage"
      />
    </FxCanvas>
    <FxCanvas :y="109" :h="303" :left="20" :right="20" style-name="BoardListDown">
      <FxCanvas :left="15" :top="10" :right="15" :bottom="10">
        <UserArmorItem
          v-for="(a, i) in shown"
          :key="a.sid"
          v-bind="itemPosition(i)"
          :armor="a"
          :selected="isSelected(a)"
          @pick="(e) => onPick(a, e)"
        />
      </FxCanvas>
    </FxCanvas>
    <FxComboBox
      v-model:selected-index="part"
      :x="249"
      :y="72"
      :w="100"
      :row-count="13"
      :items="PART_FILTERS"
    />
    <FxComboBox
      v-model:selected-index="quality"
      :x="357"
      :y="72"
      :w="100"
      :row-count="11"
      :items="QUALITY_FILTERS"
    />
    <FxLabel
      :x="188"
      :y="74"
      :w="60"
      style-name="ItemTitle"
      :text="i18n('Armor_ArmorDialog_17_1')"
    />
    <FxLabel :x="20" :y="75" style-name="ItemTitle" :text="i18n('Armor_ArmorDialog_18_1')" />
    <FxCanvas :x="78" :y="72" :w="80" :h="25" style-name="BoardListDown">
      <FxLabel
        :y="3"
        :w="80"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', fontWeight: 'bold' }"
        :text="`${armors.length}/${maxCount}`"
      />
    </FxCanvas>
    <FxButton
      :x="20"
      :y="434"
      :w="80"
      style-name="ButtonYellow"
      :label="i18n('Armor_ArmorDialog_19_1')"
      @click="onRepairAll"
    />
    <FxButton
      :x="108"
      :y="434"
      :w="80"
      style-name="ButtonYellow"
      :label="i18n('Armor_ArmorDialog_20_1')"
      @click="onRenovateAll"
    />
    <FxButton
      :x="196"
      :y="434"
      :w="100"
      style-name="ButtonYellow"
      :label="i18n('Armor_ArmorDialog_Shelf')"
      @click="game.showUseGoodsDialog(0, ARMOR_SHELF_TYPE)"
    />
    <FxCanvas :x="310" :y="433" :w="189" :h="38" style-name="BoardListDown">
      <FxToggle
        v-model:selected="selecting"
        v-tip="i18n('Armor_ArmorDialog_select_multi_tooltip')"
        :x="88"
        :y="7"
        :w="95"
        :label="i18n('Armor_ArmorDialog_select_multi')"
        @change="onToggleSelect"
      />
      <FxButton
        :x="4"
        :y="1"
        :w="78"
        style-name="ButtonGreen"
        :enabled="selecting"
        :label="i18n('Armor_ArmorDialog_analyze_multi')"
        @click="onMultiAnalyze"
      />
    </FxCanvas>
    <ActiveArmorSpecial v-if="special" :armor="special" @close="special = null" />
    <ArmorRenovatePayDialog
      v-if="renovate"
      all
      :cost="renovate.cost"
      @pay="payRenovation"
      @close="renovate = null"
    />
  </FxCanvas>
</template>
