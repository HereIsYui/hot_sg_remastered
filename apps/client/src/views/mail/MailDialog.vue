<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import {
  MAIL_PAGE,
  makeMailTime,
  pageLabel,
  parseMailList,
  type MailItem,
  type MailPage,
} from '../../game/mail';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Mail.MailDialog: the inbox / 发件箱 / 系统信 tabs, the paged letter list, select-all /
 * deselect-all / 删除 and 写信. Double-clicking a row opens the detail dialog. The server's
 * `getMail` / `getInboxMail` / `getOutboxMail` / `getSysMail` / `delete*` replies arrive on the
 * `mail` action and are decoded by `parseMailList`.
 */
const game = useGame();
const t = (n: number) => i18n(`Mail_MailDialog_${n}_1`);
const unit = (k: string) => i18n(k);

const page = ref<MailPage>(MAIL_PAGE.sys);
const items = ref<MailItem[]>([]);
const pageCount = ref(0);
const pageIndex = ref(0);
/** The current page number kept per mailbox, as the original tracked separately. */
const pages = { [MAIL_PAGE.inbox]: 0, [MAIL_PAGE.outbox]: 0, [MAIL_PAGE.sys]: 0 };
const allSelected = ref(false);

const isOutbox = computed(() => page.value === MAIL_PAGE.outbox);
const senderHeader = computed(() => (isOutbox.value ? t(14) : t(15)));

/** DataGrid rows: checkbox, title, sender/receiver, time, 查看. */
const rows = computed(() =>
  items.value.map((m) => ({
    item: m,
    title: m.title,
    who: isOutbox.value ? m.name : m.fromname,
    time: makeMailTime(parseInt(m.posttime, 10) || 0, unit),
    bold: m.bold,
  })),
);

function reloadList(): void {
  const p = pages[page.value];
  if (page.value === MAIL_PAGE.inbox) game.sendGlobalCommand('mail', 'getInboxMail', [p]);
  else if (page.value === MAIL_PAGE.outbox) game.sendGlobalCommand('mail', 'getOutboxMail', [p]);
  else game.sendGlobalCommand('mail', 'getSysMail', [p]);
}

function showPage(p: MailPage): void {
  page.value = p;
  allSelected.value = false;
  reloadList();
}

function prevPage(): void {
  if (pages[page.value] > 0) {
    pages[page.value]--;
    reloadList();
  }
}

function nextPage(): void {
  if (pages[page.value] < pageCount.value - 1) {
    pages[page.value]++;
    reloadList();
  }
}

function selectAll(): void {
  for (const m of items.value) m.selected = true;
  if (items.value.length > 0) allSelected.value = true;
}

function deselectAll(): void {
  for (const m of items.value) m.selected = false;
  allSelected.value = false;
}

function toggle(item: MailItem): void {
  item.selected = !item.selected;
}

function deleteSelected(): void {
  const mids = items.value.filter((m) => m.selected).map((m) => m.mid);
  if (mids.length > 0) {
    const p = pages[page.value];
    if (page.value === MAIL_PAGE.inbox)
      game.sendGlobalCommand('mail', 'deleteInboxMail', [mids, p]);
    else if (page.value === MAIL_PAGE.outbox)
      game.sendGlobalCommand('mail', 'deleteOutboxMail', [mids, p]);
    else game.sendGlobalCommand('mail', 'deleteSysMail', [mids, p]);
  }
  allSelected.value = false;
}

function openDetail(item: MailItem): void {
  item.bold = false;
  game.showMailDetail(item.mid, page.value);
}

const unregister = game.addGlobalReceiver('mail', (command, data) => {
  const reply = parseMailList(command, data);
  if (command === 'getMail' && reply.openPage !== undefined) page.value = reply.openPage;
  pages[page.value] = reply.page;
  pageCount.value = reply.pageCount;
  pageIndex.value = reply.page;
  items.value = reply.items;
});
onMounted(() => game.sendGlobalCommand('mail', 'getMail', []));
onUnmounted(unregister);

const label = computed(() => pageLabel(pageCount.value, pageIndex.value));
</script>

<template>
  <FxCanvas :x="27" :y="54" :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="15" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="19"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="t(5)"
    />

    <!-- mailbox tabs + 写信 -->
    <FxButton
      :x="23"
      :y="50"
      :h="38"
      style-name="ButtonRed"
      :label="t(6)"
      :selected="page === MAIL_PAGE.inbox"
      @click="showPage(MAIL_PAGE.inbox)"
    />
    <FxButton
      :x="173"
      :y="50"
      :h="38"
      style-name="ButtonRed"
      :label="t(7)"
      @click="game.showMailWrite()"
    />
    <FxButton
      :x="248"
      :y="50"
      :h="38"
      style-name="ButtonRed"
      :label="t(8)"
      :selected="page === MAIL_PAGE.outbox"
      @click="showPage(MAIL_PAGE.outbox)"
    />
    <FxButton
      :x="98"
      :y="50"
      :h="38"
      style-name="ButtonRed"
      :label="t(9)"
      :selected="page === MAIL_PAGE.sys"
      @click="showPage(MAIL_PAGE.sys)"
    />

    <!-- paging -->
    <FxButton :x="520" :y="51" style-name="ButtonRed" :label="t(10)" @click="prevPage()" />
    <FxCanvas :x="431" :y="58" :w="80" :h="25" style-name="BoardListDown">
      <FxLabel
        :y="3"
        :w="80"
        :h="20"
        :fx="{ color: 15192461, textAlign: 'center', fontWeight: 'bold' }"
        :text="label"
      />
    </FxCanvas>
    <FxButton :x="593" :y="51" style-name="ButtonRed" :label="t(11)" @click="nextPage()" />

    <!-- letter list -->
    <FxCanvas :x="23" :y="94" :w="635" :h="332" style-name="BoardListDown">
      <FxCanvas :x="3" :y="3" :w="629" :h="24" :fx="{ fontWeight: 'bold', color: 15192461 }">
        <FxLabel :x="0" :w="40" :fx="{ textAlign: 'center' }" :text="t(12)" />
        <FxLabel :x="40" :w="200" :fx="{ textAlign: 'center' }" :text="t(13)" />
        <FxLabel :x="240" :w="140" :fx="{ textAlign: 'center' }" :text="senderHeader" />
        <FxLabel :x="380" :w="160" :fx="{ textAlign: 'center' }" :text="t(16)" />
        <FxLabel :x="540" :w="60" :fx="{ textAlign: 'center' }" :text="t(17)" />
      </FxCanvas>
      <FxCanvas :x="3" :y="30" :w="629" :h="298" scroll-y>
        <FxCanvas
          v-for="(r, i) in rows"
          :key="r.item.mid"
          :x="0"
          :y="i * 30"
          :w="626"
          :h="30"
          :style-name="i % 2 === 0 ? 'BoardListUp' : 'BoardListDown'"
        >
          <FxButton
            :x="12"
            :y="7"
            style-name="CheckBox"
            :selected="r.item.selected"
            @click="toggle(r.item)"
          />
          <FxLabel
            :x="40"
            :y="6"
            :w="200"
            :fx="{ textAlign: 'center', fontWeight: r.bold ? 'bold' : 'normal', color: 16777215 }"
            :text="r.title"
            hand
            @click="openDetail(r.item)"
          />
          <FxLabel
            :x="240"
            :y="6"
            :w="140"
            :fx="{ textAlign: 'center', fontWeight: r.bold ? 'bold' : 'normal', color: 16777215 }"
            :text="r.who"
          />
          <FxLabel
            :x="380"
            :y="6"
            :w="160"
            :fx="{ textAlign: 'center', fontWeight: r.bold ? 'bold' : 'normal', color: 16777215 }"
            :text="r.time"
          />
          <FxButton
            :x="548"
            :y="4"
            :w="44"
            :h="22"
            style-name="ButtonGreen"
            :label="t(18)"
            @click="openDetail(r.item)"
          />
        </FxCanvas>
      </FxCanvas>
    </FxCanvas>

    <!-- footer -->
    <FxButton
      v-if="!allSelected"
      :x="352"
      :y="438"
      :w="80"
      :h="38"
      style-name="ButtonGreen"
      :label="t(2)"
      @click="selectAll()"
    />
    <FxButton
      v-else
      :x="352"
      :y="438"
      :w="80"
      :h="38"
      style-name="ButtonGreen"
      :label="t(3)"
      @click="deselectAll()"
    />
    <FxButton
      :x="440"
      :y="438"
      :w="80"
      :h="38"
      style-name="ButtonRed"
      :label="t(4)"
      @click="deleteSelected()"
    />
    <FxButton
      :x="582"
      :y="439"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeMail()"
    />
  </FxCanvas>
</template>
