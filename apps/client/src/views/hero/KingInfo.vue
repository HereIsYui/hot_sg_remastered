<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { parseKingTactic } from '../../game/heroPraise';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const user = useUserStore();
const state = ref(parseKingTactic(null));
const ready = ref(false);
const sending = ref(false);
const limits = [1, 10, 20, 30, 40, 50, 60, 70, 80, 100];
const unregister = game.addGlobalReceiver('kingHero', (command, data) => {
  if (command !== 'loadKingTactic' && command !== 'addUserLevelTimes') return;
  state.value = parseKingTactic(data);
  ready.value = true;
  user.kingLevel = state.value.level;
  if (command === 'addUserLevelTimes') {
    if (state.value.message) void showAlert(state.value.message);
    game.loadUserInfo();
    void game.cmd.sendCityCommand(1);
    game.refreshResource();
    game.sendGlobalCommand('goods', 'loadUserGoods');
  }
});
onMounted(() => game.sendGlobalCommand('kingHero', 'loadKingTactic'));
onUnmounted(unregister);
async function study(times: number) {
  if (!ready.value || sending.value || state.value.level >= 10) return;
  sending.value = true;
  try {
    if (
      times > 1 &&
      (await showAlert(i18n('Hero_KingHeroInfoDialog_17'), '', ['yes', 'no'])) !== 'yes'
    )
      return;
    await game.cmd.sendGlobalCommand('kingHero', 'addUserLevelTimes', [times]);
  } finally {
    sending.value = false;
  }
}
</script>
<template>
  <FxCanvas
    :w="682"
    :h="492"
    style-name="PanelGreyGreen"
    :fx="{ backgroundColor: 0, backgroundAlpha: 0.8 }"
  >
    <FxLabel
      :x="20"
      :y="20"
      :w="642"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center' }"
      :text="i18n('Hero_KingHeroInfoDialog_1')"
    />
    <FxText :x="30" :y="55" :w="622" :h="90" :text="i18n('Hero_KingHeroInfoDialog_19')" />
    <FxCanvas :x="22" :y="150" :w="300" :h="287" style-name="BoardListDown">
      <FxImage
        :x="118"
        :y="20"
        :w="64"
        :h="64"
        :source="`images/item_${state.book.gid}.png`"
        :tip="{ goods: { title: state.book.name, text: state.book.description } }"
      />
      <FxLabel
        :x="20"
        :y="94"
        :w="260"
        :fx="{ textAlign: 'center' }"
        :text="`${state.book.name} × ${state.count}`"
      />
      <FxLabel
        :x="20"
        :y="125"
        :w="260"
        :fx="{ textAlign: 'center' }"
        :text="`已学习战术：${state.level} / 10`"
      />
      <FxButton
        v-for="(times, index) in [1, 10, 50]"
        :key="times"
        :x="12 + index * 96"
        :y="182"
        :w="87"
        :h="40"
        :label="i18n(`Hero_KingHeroInfoDialog_16_${index + 1}`)"
        :enabled="ready && !sending && state.level < 10"
        @click="study(times)"
      />
    </FxCanvas>
    <FxCanvas :x="332" :y="150" :w="327" :h="287" style-name="BoardListDown" scroll-y>
      <FxCanvas
        v-for="(limit, index) in limits"
        :key="limit"
        :x="5"
        :y="index * 70"
        :w="310"
        :h="66"
        :style-name="index < state.level ? 'BoardListUp' : 'BoardListDown'"
      >
        <FxLabel
          :x="8"
          :y="4"
          :w="294"
          :text="`${index < state.level ? '✓ ' : ''}${i18n(`King_Info_level_instr_${index + 1}`)} ${i18n('King_Info_Active_limitLevel')}${limit}`"
        />
        <FxText
          :x="8"
          :y="25"
          :w="294"
          :h="38"
          :text="i18n(`Hero_KingHeroInfoDialog_KingBookTip_${index}`)"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton :right="20" :bottom="15" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
