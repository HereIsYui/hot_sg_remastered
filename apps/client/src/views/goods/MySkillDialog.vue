<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { PAGE_ITEM_COUNT, itemPosition, pageCount } from '../../game/goods';
import { parseSkillBooks, type SkillBook } from '../../game/skill';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import UserSkillItem from './UserSkillItem.vue';

/** Goods.MySkillDialog: the skill books on the shelf, 21 to a page, to sell back. */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();

const MARKET_BID = 13;
const BOOK_PRICE = 5000;
const FILTERS = [
  i18n('SkillName_All'),
  ...Array.from({ length: 19 }, (_, i) => i18n(`SkillName_${i + 1}`)),
];

const books = ref<SkillBook[]>([]);
const maxCount = ref(50);
const filter = ref(0);
const curPage = ref(0);

const filtered = computed(() =>
  filter.value === 0 ? books.value : books.value.filter((b) => b.bid === filter.value),
);
const pages = computed(() => pageCount(filtered.value.length));
const shown = computed(() =>
  filtered.value.slice(curPage.value * PAGE_ITEM_COUNT, (curPage.value + 1) * PAGE_ITEM_COUNT),
);

function onChangeFilter() {
  curPage.value = 0;
}

function onPrevPage() {
  if (curPage.value > 0) curPage.value--;
}

function onNextPage() {
  if (curPage.value < pages.value - 1) curPage.value++;
}

/** `onClickSell` */
async function onSell(book: SkillBook) {
  const market = city.buildings.find((b) => b.bid === MARKET_BID);
  if (!market || market.level < 5) {
    void showAlert(i18n('SkillBook_Recall_Cond'));
    return;
  }
  const gain = book.level * BOOK_PRICE;
  const prompt = i18n('SkillBook_Recall_Gain') + gain + i18n('Armor_ArmorDialogSrc_15');
  if ((await showAlert(prompt, '', ['yes', 'no'])) === 'yes') {
    game.sendGlobalCommand('myskill', 'sellBook', [city.cid, book.xid]);
  }
}

/** `useBookShelf` */
async function onAddShelf() {
  if ((await showAlert(i18n('AddSkillBookShelf'), '', ['yes', 'no'])) === 'yes') {
    game.sendGlobalCommand('myskill', 'AddSkillBookShelf');
  }
}

/** `[xid, cid, gold]` */
function onSellBook(d: unknown[]) {
  const xid = parseInt(String(d[0]), 10);
  const i = books.value.findIndex((b) => b.xid === xid);
  if (i >= 0) books.value.splice(i, 1);
  if (curPage.value > 0 && curPage.value >= pages.value) curPage.value = pages.value - 1;
  if (parseInt(String(d[1]), 10) === city.cid) city.gold = parseInt(String(d[2]), 10) || 0;
  gameAlert(i18n('Armor_ArmorDialogSrc_3'));
}

const unregister = game.addGlobalReceiver('myskill', (command, data) => {
  const d = Array.isArray(data) ? (data as unknown[]) : [];
  if (command === 'loadUserValidSkillBook') {
    if (d.length > 0) {
      maxCount.value = parseInt(String(d[0]), 10) || 0;
      books.value = parseSkillBooks(d[1]);
    }
    curPage.value = 0;
  } else if (command === 'sellBook') onSellBook(d);
  else if (command === 'AddSkillBookShelf') {
    maxCount.value = parseInt(String(d[0]), 10) || 0;
    gameAlert(i18n('AddSkillBookShelf_succ'));
  }
});
onUnmounted(unregister);
game.sendGlobalCommand('myskill', 'loadUserValidSkillBook');
</script>

<template>
  <FxCanvas
    :w="682"
    :h="492"
    style-name="PanelGreyGreen"
    :fx="{ fontSize: 12, backgroundColor: 8026746 }"
  >
    <FxImage :x="215" :y="21" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="25"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('SkillBook')"
    />
    <FxButton :x="587" :y="434" style-name="Close" @click="emit('close')" />
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
        <UserSkillItem
          v-for="(book, i) in shown"
          :key="book.xid"
          v-bind="itemPosition(i)"
          :book="book"
          @sell="onSell"
        />
      </FxCanvas>
    </FxCanvas>
    <FxLabel :x="200" :y="74" :w="80" style-name="ItemTitle" :text="i18n('SkillBookFilter')" />
    <FxComboBox
      v-model:selected-index="filter"
      :x="290"
      :y="72"
      :w="100"
      :row-count="13"
      :items="FILTERS"
      @change="onChangeFilter"
    />
    <FxLabel :x="20" :y="75" style-name="ItemTitle" :text="i18n('SkillBookCount')" />
    <FxCanvas :x="100" :y="72" :w="80" :h="25" style-name="BoardListDown">
      <FxLabel
        :y="3"
        :w="80"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', fontWeight: 'bold' }"
        :text="`${books.length}/${maxCount}`"
      />
    </FxCanvas>
    <FxButton
      :x="20"
      :y="434"
      :w="80"
      style-name="ButtonYellow"
      :label="i18n('BuySkillBook')"
      @click="showAlert(i18n('NotYetValid'))"
    />
    <FxButton
      :x="108"
      :y="434"
      :w="100"
      style-name="ButtonYellow"
      :label="i18n('AddSkillBookMax')"
      @click="onAddShelf"
    />
  </FxCanvas>
</template>
