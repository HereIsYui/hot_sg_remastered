<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { serverTime } from '../../core/clock';
import { SKILL_SPART } from '../../game/armor';
import { useGame } from '../../game/game';
import {
  heroDetail,
  isHeroInCity,
  kingLevelColor,
  NO_POINTS,
  type PendingPoints,
} from '../../game/hero';
import { heroStateName } from '../../game/units';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useGlobalStore } from '../../stores/global';
import { useUserStore } from '../../stores/user';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import ArmorRenovatePayDialog from './ArmorRenovatePayDialog.vue';
import ChangeArmorDialog from './ChangeArmorDialog.vue';
import ChangeHeroNameDialog from './ChangeHeroNameDialog.vue';
import ChangeUserNameDialog from '../goods/ChangeUserNameDialog.vue';
import HeroArmorPanel from './HeroArmorPanel.vue';
import HeroBufferDialog from './HeroBufferDialog.vue';
import IntroduceDialog from './IntroduceDialog.vue';
import { useHeroArmor } from './heroArmor';
import { useHeroSkill } from './heroSkill';
import LargessDialog from './LargessDialog.vue';

/**
 * Hero.HeroDetailDialog: the city's heroes, the chosen one's attributes, upgrading, spending
 * and clearing potential, renaming, rewards, dismissal, gear and skills. Item bonuses, the
 * 君主 panel and summoning captives are not ported.
 */
const props = defineProps<{ hid: number }>();

const game = useGame();
const city = useCityStore();
const global = useGlobalStore();
const user = useUserStore();
const t = (n: number | string) => i18n(`Hero_HeroDetailDialog_${n}_1`);
const src = (n: number | string) => i18n(`Hero_HeroDetailDialogSrc_${n}`);
const notYet = () => void showAlert(i18n('NotYetValid'));

const int = (v: unknown) => parseInt(String(v), 10) || 0;

/** `setHero`: the hero asked for, else the first one. */
const mHid = ref(0);
function setHero(hid: number) {
  const found = city.heroes.some((h) => int(h.hid) === hid);
  mHid.value = found ? hid : int(city.heroes[0]?.hid);
  pending.value = { ...NO_POINTS };
}

const pending = ref<PendingPoints>({ ...NO_POINTS });
const index = computed(() => city.heroes.findIndex((h) => int(h.hid) === mHid.value));
const hero = computed(() => {
  const row = city.heroes[index.value];
  if (!row) return null;
  return heroDetail(
    row,
    {
      upgradeExp: global.heroUpgradeExp,
      totalExp: global.heroTotalExp,
      lordSex: user.usersex,
      lordFace: user.userface,
      kingLevel: user.kingLevel,
      now: serverTime(),
    },
    pending.value,
  );
});

setHero(props.hid);
const armor = useHeroArmor(hero);
const skill = useHeroSkill(hero);
watch(
  () => city.heroes,
  () => setHero(mHid.value),
);

interface ListRow {
  hid: number;
  name: string;
  level: number;
  statename: string;
  color: number;
}
const rows = computed<ListRow[]>(() =>
  city.heroes.map((h) => ({
    hid: int(h.hid),
    name: String(h.name ?? ''),
    level: int(h.level),
    statename: heroStateName(h),
    color: kingLevelColor(int(h.kingLevel)),
  })),
);
type Column = {
  header: string;
  field: keyof ListRow;
  width: number;
  color?: (r: ListRow) => number;
};
const columns: Column[] = [
  { header: t(3), field: 'name', width: 60, color: (r) => r.color },
  { header: t(4), field: 'level', width: 47 },
  { header: t(5), field: 'statename', width: 48 },
];

const inCity = computed(() => (hero.value ? isHeroInCity(hero.value.state) : false));
const canAddPoint = computed(() => (hero.value?.pointleft ?? 0) > 0);
const dirty = computed(
  () => pending.value.affairs + pending.value.bravery + pending.value.wisdom > 0,
);

function send(command: string, ...args: (number | string)[]) {
  game.sendGlobalCommand('hero', command, [city.cid, ...args]);
}

/** `onAddPoint`. */
function onAddPoint(attr: keyof PendingPoints) {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) {
    void showAlert(i18n('Hero_HeroArmorPanelSrc_22'));
    return;
  }
  if (h.pointleft <= 0) return;
  pending.value = { ...pending.value, [attr]: pending.value[attr] + 1 };
}

/** `onSavePoint`. */
function onSavePoint() {
  const h = hero.value;
  if (h) send('addHeroPoint', h.hid, h.affairs, h.bravery, h.wisdom);
}

function onUpgrade() {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) void showAlert(i18n('Hero_HeroArmorPanelSrc_20'));
  else send('upgradeHero', h.hid);
}

async function onClearPoint() {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) {
    void showAlert(i18n('Hero_HeroArmorPanelSrc_21'));
    return;
  }
  const need = Math.ceil(h.level / 10);
  if ((await showAlert(src(16) + need + src(17), '', ['yes', 'no'])) === 'yes') {
    send('clearHeroPoint', h.hid);
  }
}

async function onDismiss() {
  const h = hero.value;
  if (!h) return;
  if (h.king) {
    void showAlert(i18n('Hero_KingHeroInfoDialog_18'));
    return;
  }
  if (!h.healthy) {
    void showAlert(i18n('Hero_HeroArmorPanelSrc_18'));
    return;
  }
  if ((await showAlert(src(10) + h.name + src(11), '', ['yes', 'no'])) !== 'yes') return;
  const hid = h.hid;
  if (h.level >= 80) {
    game.requestUnlock('dismissHero', () => {
      game.showHeroDetail(hid);
      send('dismissHero', hid);
    });
  } else {
    send('dismissHero', hid);
  }
}

const panel = ref<'changeName' | 'kingName' | 'largess' | 'buffer' | null>(null);

/** `onShowChangeNamePanel`: the king opens the 君主改名 dialog (changeUserName), others rename the hero. */
function onShowChangeName() {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) void showAlert(i18n('Hero_HeroArmorPanelSrc_19'));
  else if (h.king) panel.value = 'kingName';
  else panel.value = 'changeName';
}

function onShowLargess() {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) void showAlert(i18n('Hero_HeroArmorPanelSrc_18'));
  else panel.value = 'largess';
}

/** `onClickBuffer`: the 宝物 button — the hero's active treasure buffs (getHeroBuffer). */
function onShowBuffer() {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) void showAlert(i18n('Hero_HeroArmorPanelSrc_18'));
  else panel.value = 'buffer';
}

/**
 * `showUseGoodsDialog(0, type, [hid])`: the item picker of the hero buttons. 体力/精力/经验
 * (`onAddForce` / `onAddEnergy` / `onAddExp`) open straight away; the attribute items
 * (`onAddCommand` / `onAddAttack` / `onAddDefence` / `onAddAffairs` / `onAddBravery` /
 * `onAddWisdom`) refuse a wounded hero first.
 */
function useItem(type: number) {
  const h = hero.value;
  if (h) game.showUseGoodsDialog(0, type, [h.hid]);
}
function useItemHealthy(type: number) {
  const h = hero.value;
  if (!h) return;
  if (!h.healthy) void showAlert(i18n('Hero_HeroArmorPanelSrc_18'));
  else game.showUseGoodsDialog(0, type, [h.hid]);
}

/** `onReleaseHero`: set a captive (state 5) free after confirming. */
async function onRelease() {
  const h = hero.value;
  if (!h) return;
  if ((await showAlert(src(12) + h.name + src(13), '', ['yes', 'no'])) === 'yes') {
    send('releaseHero', h.hid);
  }
}

/** `onRejectHero`: turn a defector (state 6) away after confirming. */
async function onReject() {
  const h = hero.value;
  if (!h) return;
  if ((await showAlert(src(14) + h.name + src(15), '', ['yes', 'no'])) === 'yes') {
    send('rejectHero', h.hid);
  }
}

/** `onTrySummonHero` / `onTryAcceptHero`: the server answers with the need, confirmed below. */
function onTrySummon() {
  const h = hero.value;
  if (h) send('trySummonHero', h.hid);
}
function onTryAccept() {
  const h = hero.value;
  if (h) send('tryAcceptHero', h.hid);
}

/** `onShowIntroducePanel`: the famous hero's biography. */
function onShowIntroduce() {
  const h = hero.value;
  if (h) send('getNpcIntroduce', h.hid);
}

/** `onCommand`: every reply carries the city's hero list. */
const unregister = game.addGlobalReceiver('hero', (command, data) => {
  const done: Record<string, string | null> = {
    dismissHero: null,
    upgradeHero: null,
    clearHeroPoint: null,
    releaseHero: null,
    rejectHero: null,
    addHeroPoint: src(1),
    changeHeroName: src(2),
    largessHero: src('3_1'),
    sureSummonHero: src(4),
    sureAcceptHero: src('4_1'),
  };
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'trySummonHero' || command === 'tryAcceptHero') {
    const hid = int(d.shift());
    const sure = command === 'trySummonHero' ? 'sureSummonHero' : 'sureAcceptHero';
    void showAlert(String(d.shift() ?? ''), '', ['yes', 'no']).then((button) => {
      if (button === 'yes') send(sure, hid);
    });
    return;
  }
  if (command === 'getNpcIntroduce') {
    introduce.value = (d[0] ?? null) as Record<string, unknown> | null;
    return;
  }
  if (!(command in done)) return;
  game.onLoadHeroList(data);
  const message = done[command];
  if (message) gameAlert(message);
});
onUnmounted(unregister);

/** `IntroduceDialog`: the famous hero's cfg_npc_hero row, shown on 说明. */
const introduce = ref<Record<string, unknown> | null>(null);

const TITLE = { textAlign: 'center' } as const;
const VALUE = { textAlign: 'center' } as const;

/** The titled value boxes: x, y, title key, title colour, value width, value, tooltip key. */
const boxes = computed(() => {
  const h = hero.value;
  return [
    [7, 109, 13, 2227243, 65, h?.forceText, 14],
    [128, 109, 16, 3119354, 65, h?.energyText, 17],
    [7, 136, 19, 16547361, 65, h?.commandText, 20],
    [128, 136, 21, 2227243, 65, h?.speedText, 22],
    [7, 163, 23, 16005176, 65, h?.attackText, 24],
    [128, 163, 25, 15057438, 65, h?.defenceText, 26],
    [7, 190, 27, undefined, 65, h?.king ? '--' : h?.goldNeed, 28],
    [128, 190, 29, 16547361, 65, h?.king ? '--' : h?.loyalty, 30],
  ] as const;
});

/** 内政 / 勇武 / 智谋 rows: y, title key, tooltip key, value, attribute, item button tooltip. */
const points = computed(() => {
  const h = hero.value;
  return [
    [270, 35, 36, h?.affairsText, 'affairs', '35_2', 44],
    [293, 37, 38, h?.braveryText, 'bravery', '37_2', 45],
    [316, 39, 40, h?.wisdomText, 'wisdom', '39_2', 46],
  ] as const;
});
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    style-name="PanelGreyGreen"
    :fx="{ fontSize: 12, borderStyle: 'none', backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxImage :x="215" :y="14" source="images/title.png" />
    <FxLabel :x="0" :y="20" :w="682" style-name="PopupDialogTitle" :fx="TITLE" :text="t(1)" />
    <FxButton
      :x="597"
      :y="444"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <FxButton :x="481" :y="444" :w="90" :label="t(48)" @click="game.showShop()" />

    <FxCanvas :x="15" :y="60" :w="652" :h="375">
      <FxCanvas :x="0" :y="0" :w="160" :h="375" style-name="BoardListDown">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="155"
          :h="369"
          :row-height="28"
          :columns="columns"
          :rows="rows"
          selectable
          :selected-index="index"
          @item-click="(r) => setHero(r.hid)"
        />
      </FxCanvas>

      <FxCanvas v-if="hero" :x="165" :y="0" :w="253" :h="375" style-name="BoardListDown">
        <FxCanvas :x="5" :y="9" :w="66" :h="82" style-name="BoardListDown">
          <FxImage :x="1" :y="1" :w="64" :h="80" :source="hero.image" />
        </FxCanvas>
        <FxCanvas :x="6" :y="99" :w="240" :h="2" style-name="BoardListDown" />
        <FxCanvas :x="6" :y="218" :w="240" :h="2" style-name="BoardListDown" />

        <FxLabel :x="75" :y="12" :w="35" style-name="ItemTitle" :fx="TITLE" :text="t(6)" />
        <FxCanvas :x="110" :y="12" :w="83" :h="20" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="0"
            :w="83"
            :h="20"
            style-name="ItemValue"
            :fx="{
              textAlign: 'center',
              fontWeight: hero.famous ? 'bold' : 'normal',
              color: hero.nameColor,
            }"
            :text="hero.name"
          />
        </FxCanvas>
        <FxButton
          v-if="!hero.famous"
          :x="195"
          :y="7"
          :w="50"
          :h="30"
          style-name="ButtonYellow"
          :label="t(7)"
          :enabled="inCity"
          @click="onShowChangeName"
        />
        <FxButton
          v-else
          :x="195"
          :y="7"
          :w="50"
          :h="30"
          style-name="ButtonYellow"
          :label="t(8)"
          @click="onShowIntroduce"
        />

        <FxLabel :x="75" :y="40" :w="35" style-name="ItemTitle" :fx="TITLE" :text="t(9)" />
        <FxCanvas :x="110" :y="40" :w="83" :h="20" style-name="BoardListDown">
          <FxLabel :x="0" :y="0" :w="83" style-name="ItemValue" :fx="VALUE" :text="hero.level" />
        </FxCanvas>
        <FxButton
          :x="195"
          :y="36"
          :w="50"
          :h="30"
          style-name="ButtonGreen"
          :label="t(10)"
          :enabled="inCity && hero.currentExp >= hero.upgradeExp"
          @click="onUpgrade"
        />

        <FxLabel :x="75" :y="68" :w="35" style-name="ItemTitle" :fx="TITLE" :text="t(12)" />
        <FxCanvas :x="110" :y="68" :w="118" :h="20" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="0"
            :w="118"
            style-name="ItemValue"
            :fx="{ fontSize: 11, textAlign: 'center' }"
            :text="hero.expText"
          />
        </FxCanvas>
        <FxButton
          :x="233"
          :y="73"
          style-name="Plus"
          :tip="t(11)"
          :enabled="hero.canAddExp && !hero.king"
          @click="useItem(11)"
        />

        <template v-for="[x, y, title, color, w, value, tip] in boxes" :key="`${x},${y}`">
          <FxLabel
            :x="x"
            :y="y"
            :w="35"
            style-name="ItemTitle"
            :fx="color === undefined ? TITLE : { ...TITLE, color }"
            :text="t(title)"
            :tip="t(tip)"
          />
          <FxCanvas :x="x + 35" :y="y" :w="w" :h="20" style-name="BoardListDown">
            <FxLabel :x="0" :y="0" :w="w" style-name="ItemValue" :fx="VALUE" :text="value" />
          </FxCanvas>
        </template>
        <FxButton :x="113" :y="114" style-name="Plus" :tip="t(15)" @click="useItem(2)" />
        <FxButton :x="233" :y="114" style-name="Plus" :tip="t(18)" @click="useItem(3)" />
        <FxButton
          :x="113"
          :y="141"
          style-name="Plus"
          :tip="t('20_2')"
          :enabled="!hero.king"
          @click="useItemHealthy(43)"
        />
        <FxButton
          :x="113"
          :y="171"
          style-name="Plus"
          :tip="t('20_3')"
          :enabled="!hero.king"
          @click="useItemHealthy(52)"
        />
        <FxButton
          :x="233"
          :y="169"
          style-name="Plus"
          :tip="t('20_4')"
          :enabled="!hero.king"
          @click="useItemHealthy(53)"
        />
        <FxButton
          :x="233"
          :y="196"
          style-name="Plus"
          :tip="t(31)"
          :enabled="inCity && !hero.king"
          @click="onShowLargess"
        />

        <FxLabel
          :x="9"
          :y="224"
          :w="35"
          style-name="ItemTitle"
          :fx="{ ...TITLE, color: 16547361 }"
          :text="t(49)"
        />
        <FxCanvas :x="44" :y="224" :w="65" :h="20" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="0"
            :w="65"
            style-name="ItemValue"
            :fx="VALUE"
            :text="skill.state.value.name"
            :tip="skill.state.value.description"
          />
        </FxCanvas>
        <FxButton
          :x="198"
          :y="222"
          :w="50"
          :h="28"
          style-name="ButtonYellow"
          :label="t(50)"
          @click="skill.onDigest"
        />

        <FxLabel
          :x="9"
          :y="247"
          :w="35"
          style-name="ItemTitle"
          :fx="{ ...TITLE, color: 2227243 }"
          :text="t(32)"
          :tip="t(33)"
        />
        <FxCanvas :x="44" :y="247" :w="65" :h="20" style-name="BoardListDown">
          <FxLabel
            :x="0"
            :y="0"
            :w="65"
            style-name="ItemValue"
            :fx="VALUE"
            :text="hero.pointleft"
          />
        </FxCanvas>
        <FxButton
          :x="198"
          :y="245"
          :w="50"
          :h="28"
          style-name="ButtonYellow"
          :label="t(34)"
          :enabled="inCity"
          @click="onClearPoint"
        />

        <template v-for="[y, title, tip, value, attr, itemTip, itemType] in points" :key="attr">
          <FxLabel
            :x="9"
            :y="y"
            :w="35"
            style-name="ItemTitle"
            :fx="TITLE"
            :text="t(title)"
            :tip="t(tip)"
          />
          <FxCanvas :x="44" :y="y" :w="65" :h="20" style-name="BoardListDown">
            <FxLabel :x="0" :y="0" :w="65" style-name="ItemValue" :fx="VALUE" :text="value" />
          </FxCanvas>
          <FxButton
            :x="114"
            :y="y - 2"
            :w="28"
            :h="28"
            label="+"
            :enabled="canAddPoint"
            @click="onAddPoint(attr)"
          />
          <FxButton
            :x="145"
            :y="y + 7"
            style-name="Plus"
            :tip="t(itemTip)"
            :enabled="!hero.king"
            @click="useItemHealthy(itemType)"
          />
        </template>
        <FxButton
          :x="198"
          :y="274"
          :w="50"
          :h="28"
          style-name="ButtonGreen"
          :label="t(47)"
          :enabled="dirty"
          @click="onSavePoint"
        />
        <FxButton
          :x="198"
          :y="304"
          :w="50"
          :h="28"
          style-name="ButtonGreen"
          :label="t(51)"
          :enabled="hero.king"
          @click="notYet"
        />
        <FxButton
          :x="198"
          :y="333"
          :w="50"
          :h="32"
          style-name="ButtonGreen"
          :label="t(46)"
          :enabled="!hero.king"
          @click="onShowBuffer"
        />

        <FxButton
          v-if="inCity"
          :x="10"
          :y="339"
          :w="60"
          :h="32"
          :label="t(41)"
          @click="onDismiss"
        />
        <template v-if="hero.state === 5">
          <FxButton :x="10" :y="339" :w="60" :h="32" :label="t(42)" @click="onTrySummon" />
          <FxButton :x="80" :y="339" :w="60" :h="32" :label="t(43)" @click="onRelease" />
        </template>
        <template v-if="hero.state === 6">
          <FxButton :x="10" :y="339" :w="60" :h="32" :label="t(44)" @click="onTryAccept" />
          <FxButton :x="80" :y="339" :w="60" :h="32" :label="t(45)" @click="onReject" />
        </template>
      </FxCanvas>

      <HeroArmorPanel :x="417" :y="0" :state="armor" :skill="skill" />
    </FxCanvas>

    <ChangeHeroNameDialog
      v-if="panel === 'changeName' && hero"
      :name="hero.name"
      @change="(name) => send('changeHeroName', hero!.hid, name)"
      @close="panel = null"
    />
    <ChangeUserNameDialog
      v-if="panel === 'kingName'"
      @change="(name) => game.sendGlobalCommand('user', 'changeUserName', [name])"
      @close="panel = null"
    />
    <IntroduceDialog v-if="introduce" :npc="introduce" @close="introduce = null" />
    <LargessDialog
      v-if="panel === 'largess' && hero"
      :hero="hero"
      @largess="(typeidx) => send('largessHero', hero!.hid, typeidx)"
      @close="panel = null"
    />
    <HeroBufferDialog
      v-if="panel === 'buffer' && hero"
      :hid="hero.hid"
      :cid="city.cid"
      @close="panel = null"
    />
    <ChangeArmorDialog
      v-if="armor.changePart.value !== null && hero"
      :hero="hero"
      :spart="armor.changePart.value"
      @equip="armor.equip"
      @close="armor.changePart.value = null"
    />
    <ChangeArmorDialog
      v-if="skill.choosing.value !== null && hero"
      :hero="hero"
      :spart="SKILL_SPART"
      :skill="skill.choosing.value"
      @wear="skill.wear"
      @close="skill.choosing.value = null"
    />
    <ArmorRenovatePayDialog
      v-if="armor.renovate.value"
      :all="armor.renovate.value.all"
      :cost="armor.renovate.value.cost"
      @pay="(byGift) => armor.payRenovation(armor.renovate.value!, byGift)"
      @close="armor.renovate.value = null"
    />
  </FxCanvas>
</template>
