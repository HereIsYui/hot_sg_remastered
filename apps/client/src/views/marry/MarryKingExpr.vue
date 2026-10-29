<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  exprLeftTime,
  FAVOR_STAGES,
  favorStage,
  parseAddFavor,
  parseKingExpr,
  parseMarryInfo,
  parseProposeReply,
  proposeBattleHeroes,
  type Girlfriend,
} from '../../game/marry';
import { parsePkBattle } from '../../game/campaign-pk';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import BeginKingExprDialog from './BeginKingExprDialog.vue';
import MarryGiftDialog from './MarryGiftDialog.vue';
import MarryHeroBattlePanel from './MarryHeroBattlePanel.vue';
import MarryRewardPanel from './MarryRewardPanel.vue';

/**
 * MarrySystem.MarryKingExpr: the 缔结姻缘 tab. `loadMarryInfo` fills the king expr row (state 0
 * free / 10-11 running) and the nine-per-page girlfriend list; a selected girl shows her
 * portrait, attributes and the favour frame. 寻访红颜 (BeginKingExprDialog → beginKingExpr),
 * 加速/取消 (fasterKingExpr / cancelKingExpr), 提亲 (MarryGiftDialog → proposeMarry, a drawn
 * guard NPC replays in MarryHeroBattlePanel), 赠送礼品 (addMadamFavor) and 道别 (byebye).
 */
const game = useGame();
const user = useUserStore();

const king = ref<Record<string, unknown> | null>(null);
const girlfriends = ref<Girlfriend[]>([]);
const page = ref(1);
const selectIndex = ref(0);
const showBegin = ref(false);
const showGift = ref(false);
const showReward = ref(false);
const battle = ref<ReturnType<typeof parsePkBattle>>(null);
const battleHeroes = ref<{
  king: Record<string, unknown> | null;
  npc: Record<string, unknown> | null;
}>({
  king: null,
  npc: null,
});

const PAGE_SIZE = 9;
const curGirls = computed(() =>
  girlfriends.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
const totalPage = computed(() => Math.max(1, Math.ceil(girlfriends.value.length / PAGE_SIZE)));
const selected = computed(
  () => girlfriends.value[(page.value - 1) * PAGE_SIZE + selectIndex.value] ?? null,
);
const favor = computed(() => selected.value?.favor ?? 0);
const stage = computed(() => favorStage(favor.value));
const canPropose = computed(() => (selected.value?.proposeLeftTime ?? 0) <= 0);
const leftTime = ref(0);
const timer = setInterval(() => {
  if (leftTime.value > 0) leftTime.value--;
}, 1000);
onUnmounted(() => clearInterval(timer));

const stages = computed(() => FAVOR_STAGES.map((k) => i18n(k)));
const stageColors = [7699268, 5409106, 1863876, 6710937];

/** `MarryKingExpr` initial load; MarryMainPanel sends loadMarryInfo when the tab opens. */
const unregister = game.addGlobalReceiver('MarrySystem', (command, data) => {
  if (command === 'loadMarryInfo') {
    const parsed = parseMarryInfo(data);
    king.value = parsed.kingExpr;
    girlfriends.value = parsed.girlfriends;
    leftTime.value = exprLeftTime(parsed.kingExpr);
  } else if (
    command === 'loadMarryKingExpr' ||
    command === 'fasterKingExpr' ||
    command === 'cancelKingExpr'
  ) {
    king.value = parseKingExpr(data);
    leftTime.value = exprLeftTime(king.value);
  } else if (command === 'beginKingExpr') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      gameAlert(String(d.shift() ?? ''));
      king.value = parseKingExpr((d.shift() as unknown[] | undefined)?.[0]);
      leftTime.value = exprLeftTime(king.value);
    }
    showBegin.value = false;
  } else if (command === 'addMadamFavor') {
    const reply = parseAddFavor(data);
    gameAlert(reply.message);
    if (selected.value) selected.value.favor = reply.favor;
  } else if (command === 'byebye') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) {
      gameAlert(String(d.shift() ?? ''));
      girlfriends.value = girlfriends.value.filter((g) => g.hid !== selected.value?.hid);
      selectIndex.value = 0;
    }
  } else if (command === 'proposeMarry') {
    showGift.value = false;
    const reply = parseProposeReply(data);
    if (!reply) return;
    if (reply.kind === 1) {
      void showAlert(i18n('Marry_king_propose_no_npc').replace('{0}', reply.name));
      removeGirl();
      return;
    }
    const heroes = proposeBattleHeroes(reply.heroes);
    battleHeroes.value = heroes;
    battle.value = reply.battle;
    if (reply.battle?.winer === 1) removeGirl();
  }
});
onUnmounted(unregister);

/** `proposeMarry`: the gift dialog opens for the selected girl. */
function propose(): void {
  if (!selected.value) return;
  showGift.value = true;
}

/** `removeSelectGirl`: the girl left the list after a win / a farewell. */
function removeGirl(): void {
  const hid = selected.value?.hid;
  if (hid != null) girlfriends.value = girlfriends.value.filter((g) => g.hid !== hid);
  selectIndex.value = 0;
}

/** `sendGift`: one step of favour per gift (`addMadamFavor [type, hid]`, type 1 红颜). */
function sendGift(): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'addMadamFavor', [1, selected.value.hid]);
}

/** `byebye`. */
function farewell(): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'byebye', [selected.value.hid]);
}

/** `onPrev` / `onNext`. */
function onPrev(): void {
  if (page.value > 1) page.value--;
}
function onNext(): void {
  if (page.value < totalPage.value) page.value++;
}

/** `onKingExp` / `onFasterKingExpr` / `onCancelKingExpr` (inlineComponent6). */
function onKingExp(): void {
  showBegin.value = true;
}
function onFasterKingExpr(): void {
  game.sendGlobalCommand('MarrySystem', 'fasterKingExpr');
}
function onCancelKingExpr(): void {
  game.sendGlobalCommand('MarrySystem', 'cancelKingExpr');
}
</script>

<template>
  <FxCanvas :w="625" :h="353" style-name="BoardListDown">
    <!-- king expr row -->
    <FxCanvas :x="17" :y="2" :w="597" :h="60" style-name="BoardListUp">
      <FxCanvas :x="0" :y="5" :w="597" :h="49" style-name="BoardListDown">
        <FxLabel
          :x="8"
          :y="12"
          :w="90"
          :fx="{ color: 16777215 }"
          :text="`${i18n('Marry_king_name')}: ${user.username}`"
        />
        <FxLabel
          :x="110"
          :y="12"
          :w="220"
          :fx="{ color: 16777215 }"
          :text="
            leftTime > 0
              ? `${i18n('Office_HeroExprDialog_10_1')} ${leftTime}`
              : i18n('Marry_king_can_not_expr')
          "
        />
        <FxButton
          v-if="Number(king?.state ?? 0) === 0"
          :x="380"
          :y="10"
          :w="70"
          :h="25"
          style-name="ButtonYellow"
          :label="i18n('Marry_king_exp_search_wife')"
          @click="onKingExp"
        />
        <FxButton
          v-else-if="Number(king?.state ?? 0) === 10 || Number(king?.state ?? 0) === 11"
          :x="340"
          :y="10"
          :w="50"
          :h="25"
          style-name="ButtonYellow"
          :label="i18n('Office_HeroExprDialog_11_1')"
          @click="onFasterKingExpr"
        />
        <FxButton
          v-if="Number(king?.state ?? 0) === 10"
          :x="400"
          :y="10"
          :w="50"
          :h="25"
          style-name="ButtonRed"
          :label="i18n('Office_HeroExprDialog_12_1')"
          @click="onCancelKingExpr"
        />
      </FxCanvas>
    </FxCanvas>
    <!-- girlfriend list -->
    <FxCanvas :x="17" :y="64" :w="597" :h="285" style-name="BoardListUp">
      <FxCanvas :x="5" :y="5" :w="100" :h="240" style-name="BoardListUp">
        <FxCanvas
          v-for="(girl, i) in curGirls"
          :key="girl.hid"
          :x="2"
          :y="i * 26"
          :w="96"
          :h="25"
          :fx="{
            backgroundColor: i === selectIndex ? 5409106 : 0,
            backgroundAlpha: i === selectIndex ? 0.6 : 0,
          }"
          hand
          @click="selectIndex = i"
        >
          <FxLabel
            :x="4"
            :y="4"
            :w="60"
            :fx="{ color: 16777215 }"
            :text="String(girl.name ?? '')"
          />
          <FxLabel
            :x="60"
            :y="4"
            :w="32"
            :fx="{ color: 16247152, textAlign: 'right' }"
            :text="String(girl.favor ?? '')"
          />
        </FxCanvas>
        <FxCanvas v-if="totalPage > 1" :x="5" :y="245" :w="115" :h="35">
          <FxButton
            :y="1"
            :w="50"
            :h="33"
            style-name="ButtonRed"
            :fx="{ fontSize: 12 }"
            :label="i18n('Shop_ShopDialog_2_1')"
            @click="onPrev"
          />
          <FxButton
            :x="52"
            :y="1"
            :w="50"
            :h="33"
            style-name="ButtonRed"
            :fx="{ fontSize: 12 }"
            :label="i18n('Shop_ShopDialog_3_1')"
            @click="onNext"
          />
        </FxCanvas>
      </FxCanvas>
      <FxCanvas :x="123" :y="10" :w="67" :h="82" style-name="BoardListDown">
        <FxImage
          :x="1"
          :y="1"
          :w="64"
          :h="80"
          :source="selected?.heroImage ?? null"
          :tip="String(selected?.introduce ?? '')"
        />
      </FxCanvas>
      <FxCanvas :x="203" :y="10" :w="118" :h="95" style-name="BoardListDown">
        <FxLabel
          :x="4"
          :y="3"
          :w="46"
          :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
          :text="i18n('Marry_heroine_command')"
        />
        <FxLabel
          :x="49"
          :y="3"
          :w="57"
          :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
          :text="selected?.attribute[0] ?? ''"
        />
        <FxLabel
          :x="4"
          :y="25"
          :w="46"
          :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
          :text="i18n('Marry_heroine_affairs')"
        />
        <FxLabel
          :x="49"
          :y="27"
          :w="57"
          :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
          :text="selected?.attribute[1] ?? ''"
        />
        <FxLabel
          :x="4"
          :y="47"
          :w="46"
          :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
          :text="i18n('Marry_heroine_bravery')"
        />
        <FxLabel
          :x="49"
          :y="49"
          :w="57"
          :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
          :text="selected?.attribute[2] ?? ''"
        />
        <FxLabel
          :x="4"
          :y="69"
          :w="46"
          :fx="{ color: 16247152, textAlign: 'right', fontSize: 13 }"
          :text="i18n('Marry_heroine_wisdom')"
        />
        <FxLabel
          :x="49"
          :y="71"
          :w="57"
          :fx="{ color: 16777215, textAlign: 'center', fontSize: 13 }"
          :text="selected?.attribute[3] ?? ''"
        />
      </FxCanvas>
      <FxCanvas :x="344" :y="10" :w="243" :h="95" style-name="BoardListDown">
        <FxText :x="6" :y="7" :w="229" :h="78" :html="i18n('Marry_king_guid')" />
      </FxCanvas>
      <!-- favour frame -->
      <FxCanvas :x="127" :y="125" :w="60" :h="50">
        <FxImage :w="55" :h="50" source="images/madam_favor_frame.png" />
        <FxLabel
          :x="6"
          :y="2"
          :w="45"
          :fx="{ color: 7915430, fontSize: 12, textAlign: 'center' }"
          :text="i18n('Hotel_JiejiaoHeroDialog_6_1')"
        />
        <FxLabel
          :x="7"
          :y="18"
          :w="45"
          :fx="{ color: 16777215, fontSize: 12, textAlign: 'center' }"
          :text="String(favor)"
        />
      </FxCanvas>
      <FxCanvas
        v-for="i in 4"
        :key="i"
        :x="[148, 228, 348, 428][i - 1]"
        :y="169"
        :w="[80, 120, 120, 80][i - 1]"
        :h="40"
        style-name="BoardListUp"
        :fx="{ backgroundAlpha: 0.8 }"
      >
        <FxCanvas
          :x="3"
          :y="3"
          :w="[75, 115, 115, 75][i - 1]"
          :h="27"
          :fx="{ backgroundColor: stageColors[i - 1]!, backgroundAlpha: stage >= i - 1 ? 1 : 0.4 }"
        >
          <FxLabel
            :w="[75, 115, 115, 75][i - 1]"
            :h="27"
            :fx="{ textAlign: 'center', fontSize: 13, color: 15660323, paddingTop: 3 }"
            :text="stages[i - 1]"
          />
        </FxCanvas>
      </FxCanvas>
      <FxLabel
        :x="223"
        :y="208"
        :fx="{ fontSize: 12, color: 13421772, textAlign: 'center' }"
        text="20"
      />
      <FxLabel
        :x="343"
        :y="208"
        :fx="{ fontSize: 12, color: 13421772, textAlign: 'center' }"
        text="50"
      />
      <FxLabel
        :x="463"
        :y="208"
        :fx="{ fontSize: 12, color: 13421772, textAlign: 'center' }"
        text="80"
      />
      <FxLabel
        :x="540"
        :y="208"
        :fx="{ fontSize: 12, color: 13421772, textAlign: 'center' }"
        text="100"
      />
      <FxButton
        :x="131"
        :y="242"
        :w="80"
        :h="39"
        style-name="ButtonYellow"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_System_culture_function_3')"
        :enabled="canPropose && !!selected"
        @click="propose"
      />
      <FxCanvas v-if="leftTime > 0" :x="214" :y="247" :w="203" :h="30">
        <FxLabel
          :x="0"
          :y="2"
          :w="92"
          :h="25"
          style-name="ItemValue"
          :fx="{ fontSize: 13, paddingTop: 3 }"
          :text="i18n('Marry_king_propose_cooling_time')"
        />
        <FxText
          :x="87"
          :y="2"
          :w="103"
          :h="25"
          :fx="{ fontSize: 13, color: 16777215, paddingTop: 3 }"
          :text="String(leftTime)"
        />
      </FxCanvas>
      <FxButton
        :x="422"
        :y="241"
        :w="80"
        :h="39"
        style-name="ButtonRed"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_king_bye')"
        :enabled="!!selected"
        @click="farewell"
      />
      <FxButton
        :x="507"
        :y="242"
        :w="80"
        :h="39"
        style-name="ButtonYellow"
        :fx="{ fontSize: 13 }"
        :label="i18n('Marry_System_add_good')"
        :enabled="!!selected && favor < 100"
        @click="sendGift"
      />
    </FxCanvas>

    <BeginKingExprDialog v-if="showBegin" @close="showBegin = false" />
    <MarryGiftDialog v-if="showGift && selected" :hid="selected.hid" @close="showGift = false" />
    <MarryHeroBattlePanel
      v-if="battle"
      :battle="battle"
      :king="battleHeroes.king"
      :npc="battleHeroes.npc"
      @close="battle = null"
    />
    <MarryRewardPanel v-if="showReward" @close="showReward = false" />
  </FxCanvas>
</template>
