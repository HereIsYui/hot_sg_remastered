<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import {
  announcementOpenCommands,
  parseLoginInfo,
  parseSignState,
  signCalendar,
} from '../../game/loginActivity';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import DayItem from '../activity/DayItem.vue';
defineOptions({ name: 'LoginAnnouncement' });
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const info = shallowRef(parseLoginInfo(null));
const pending = ref(false);
const days = computed(() => (info.value.sign ? signCalendar(info.value.sign) : []));
const signed = computed(() => days.value.some((day) => day.today && day.state !== 99));
const report = computed(() =>
  Number(info.value.announcement.newestreport) === 1
    ? i18n('Report_Announcement_9_1')
    : i18n('Announcement_Dialog_3'),
);
const attack = computed(() =>
  info.value.announcement.maxattack
    ? i18n('Report_Announcement_10_1') +
      info.value.announcement.maxattack +
      i18n('Report_Announcement_11_1')
    : i18n('Report_Announcement_12_1'),
);
const defence = computed(() =>
  info.value.announcement.maxdefence
    ? i18n('Report_Announcement_13_1') +
      info.value.announcement.maxdefence +
      i18n('Report_Announcement_14_1')
    : i18n('Report_Announcement_15_1'),
);
const unregister = [
  game.addGlobalReceiver('reward', (command, data) => {
    if (command === 'getLoginInfo') {
      info.value = parseLoginInfo(data);
    }
    // RewardFunc.getLoginReward returns null in the original offline game.
  }),
  game.addGlobalReceiver('sign', (command, data) => {
    if (command === 'getSignState') info.value = { ...info.value, sign: parseSignState(data) };
    if (command === 'doSign' && Array.isArray(data)) {
      info.value = { ...info.value, sign: parseSignState(data[1]) };
      if (data[0]) void showAlert(String(data[0]));
    }
  }),
];
async function sign() {
  if (pending.value || !info.value.sign || signed.value) return;
  pending.value = true;
  try {
    await game.cmd.sendGlobalCommand('sign', 'doSign');
  } finally {
    pending.value = false;
  }
}
function close() {
  emit('close');
}
onMounted(() => {
  for (const command of announcementOpenCommands(false)) game.sendGlobalCommand('reward', command);
});
onUnmounted(() => unregister.forEach((off) => off()));
</script>
<template>
  <FxCanvas :w="1000" :h="600" :fx="{ backgroundColor: 0, backgroundAlpha: 0.55 }">
    <FxCanvas :x="100" :y="65" :w="800" :h="470" style-name="PopupDialog">
      <FxLabel
        :x="24"
        :y="15"
        :w="500"
        style-name="ItemTitle"
        :text="i18n('Announcement_Dialog_1')"
      />
      <FxButton :right="8" :y="8" style-name="Close" @click="close" />
      <FxLabel :x="24" :y="52" :w="350" :text="i18n('Announcement_Dialog_2')" />
      <FxText :x="24" :y="78" :w="350" :h="56" :html="report" />
      <FxLabel
        :x="24"
        :y="148"
        :w="350"
        style-name="ItemTitle"
        :text="i18n('Announcement_Dialog_9')"
      />
      <FxText :x="24" :y="178" :w="350" :h="42" :text="String(info.announcement.maxname ?? '')" />
      <FxText
        :x="24"
        :y="220"
        :w="350"
        :h="44"
        :text="`${i18n('Report_Announcement_16_1')}${info.announcement.maxpos ?? ''}   ${i18n('Report_Announcement_17_1')}${info.announcement.maxnob ?? ''}`"
      />
      <FxText :x="24" :y="272" :w="350" :h="60" :html="attack" />
      <FxText :x="24" :y="338" :w="350" :h="60" :html="defence" />
      <FxLabel :x="410" :y="52" :w="365" style-name="ItemTitle" :text="i18n('Daily_sign_1')" />
      <FxLabel
        v-if="info.sign"
        :x="410"
        :y="80"
        :w="365"
        :text="`${info.sign.year} / ${info.sign.month} / ${info.sign.day}`"
      />
      <FxLabel
        v-for="(key, i) in [3, 4, 5, 6, 7, 8, 9]"
        :key="key"
        :x="410 + i * 52"
        :y="110"
        :w="52"
        :text="i18n(`Daily_sign_${key}`)"
      />
      <DayItem
        v-for="(day, index) in days"
        :key="day.key"
        :day="day"
        :busy="pending"
        :x="410 + (index % 7) * 52"
        :y="138 + Math.floor(index / 7) * 34"
        @sign="sign"
      />
      <FxText :x="410" :y="317" :w="365" :h="82" :text="i18n('Daily_sign_11')" />
      <!-- The offline RewardFunc returns before generating or granting login rewards. -->
      <FxButton
        :x="24"
        :y="410"
        :w="180"
        :h="28"
        style-name="ButtonRed"
        :label="i18n('Announcement_Dialog_4')"
        :enabled="false"
        :tip="i18n('NotYetValid')"
      />
      <FxButton
        :x="520"
        :y="410"
        :w="145"
        :h="28"
        style-name="ButtonRed"
        :label="i18n('Daily_sign_10')"
        :enabled="!!info.sign && !signed && !pending"
        @click="sign"
      />
    </FxCanvas>
  </FxCanvas>
</template>
