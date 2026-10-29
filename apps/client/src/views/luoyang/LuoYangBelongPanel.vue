<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { battleIntro, parseBelongInfo } from '../../game/luoyang';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import IntroTip from './IntroTip.vue';

/**
 * LuoYang.LuoYangBelongPanel (`showLuoYangBelongPanel`, the 功能按钮区 enterLuoyang button): the
 * 洛阳归属 overview. `getLYBelongInfo` (action LuoYangInitBattle) fills the year/union/owner
 * lines; the owner's buttons dispatch 发公告 (sendBelongInform), 诏安 (openUnionZhaoAn) and
 * 洛阳政令 (getLuoyangGovernCount → GovernPanel), the others alert LuoYang_Belong_open_later as
 * in the original. 进攻洛阳 opens the LuoYangBattlePanel.
 */
const emit = defineEmits<{ battle: []; close: [] }>();

const game = useGame();

const yearName = ref('');
const unionName = ref('');
const userName = ref('');
const isCanSend = ref(false);
const battle = ref<Record<string, unknown>>({});
const showIntro = ref(false);

/** `loadBelongInfo`. */
onMounted(() => game.sendGlobalCommand('LuoYangInitBattle', 'getLYBelongInfo'));

const unregister = game.addGlobalReceiver('LuoYangInitBattle', (command, data) => {
  if (command === 'getLYBelongInfo') {
    const parsed = parseBelongInfo(data, i18n);
    yearName.value = parsed.yearName;
    unionName.value = parsed.unionName;
    userName.value = parsed.userName;
    isCanSend.value = parsed.isCanSend;
    battle.value = parsed.battle;
  } else if (command === 'sendBelongInform' || command === 'openUnionZhaoAn') {
    void showAlert(i18n('LuoYang_Belong_send_succ'));
  } else if (command === 'governLuoyangOthers') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    void showAlert(String(d.shift() ?? ''));
  }
});
onUnmounted(unregister);

/** `dealWithEvent`: 1 发公告, 2 诏安, 3 政令, the rest stay 相关功能等待后续开放. */
function dealWithEvent(kind: number): void {
  if (kind === 1) {
    game.sendGlobalCommand('LuoYangInitBattle', 'sendBelongInform');
  } else if (kind === 2) {
    game.sendGlobalCommand('LuoYangInitBattle', 'openUnionZhaoAn');
  } else if (kind === 3) {
    game.showLuoyangGovern();
  } else {
    void showAlert(i18n('LuoYang_Belong_open_later'));
  }
}

const intro = computed(() => battleIntro(battle.value, i18n));
</script>

<template>
  <FxCanvas :w="733" :h="535" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage source="images/luoyangBattle/luoyang_bg.jpg" />
    <FxLabel
      :x="22"
      :y="39"
      :w="172"
      :h="33"
      style-name="ItemValue"
      :fx="{ textAlign: 'center', fontSize: 14, fontWeight: 'bold', paddingTop: 5 }"
      :tip="i18n('LuoYang_Belong_cur_year_name')"
      :text="yearName"
    />
    <FxLabel
      :x="533"
      :y="39"
      :w="172"
      :h="33"
      style-name="ItemValue"
      :fx="{ textAlign: 'center', fontSize: 14, fontWeight: 'bold', paddingTop: 5 }"
      :tip="i18n('LuoYang_Belong_cur_own_union')"
      :text="unionName"
    />
    <FxLabel
      :x="293"
      :y="163"
      :w="147"
      :h="33"
      :fx="{
        textAlign: 'center',
        fontSize: 14,
        color: 16777215,
        fontWeight: 'bold',
        paddingTop: 5,
      }"
      :tip="i18n('LuoYang_Belong_cur_own_user')"
      :text="userName"
    />
    <FxButton
      :x="333"
      :y="189"
      style-name="luoyangKing"
      :tip="i18n('LuoYang_Belong_open_later')"
      @click="dealWithEvent(0)"
    />
    <FxButton
      :x="287"
      :y="165"
      style-name="characterOne"
      :tip="i18n('LuoYang_Belong_has_send_1')"
      @click="dealWithEvent(1)"
    />
    <FxButton
      :x="383"
      :y="165"
      style-name="characterTwo"
      :tip="i18n('LuoYang_Belong_1_2')"
      @click="dealWithEvent(2)"
    />
    <FxButton
      :x="235"
      :y="199"
      style-name="characterThree"
      :tip="i18n('LuoYang_Belong_1_3')"
      @click="dealWithEvent(3)"
    />
    <FxButton
      :x="435"
      :y="199"
      style-name="characterFour"
      :tip="i18n('LuoYang_Belong_open_later')"
      @click="dealWithEvent(4)"
    />
    <FxButton
      :x="187"
      :y="255"
      style-name="characterFive"
      :tip="i18n('LuoYang_Belong_open_later')"
      @click="dealWithEvent(5)"
    />
    <FxButton
      :x="485"
      :y="255"
      style-name="characterSix"
      :tip="i18n('LuoYang_Belong_open_later')"
      @click="dealWithEvent(6)"
    />
    <FxLabel
      :x="10"
      :y="503"
      :fx="{ color: 16247152, fontSize: 13, fontWeight: 'bold' }"
      :tip="intro"
      hand
      :text="i18n('LuoYang_Belong_add_intro')"
      @mouseover="showIntro = true"
      @mouseout="showIntro = false"
    />
    <FxButton
      :x="541"
      :y="485"
      style-name="luoyangInvade"
      :tip="i18n('LuoYang_Belong_start_troop')"
      @click="emit('battle')"
    />
    <FxButton :x="638" :y="485" style-name="luoyangClose" @click="emit('close')" />
    <IntroTip v-if="showIntro" :battle="battle" />
  </FxCanvas>
</template>
