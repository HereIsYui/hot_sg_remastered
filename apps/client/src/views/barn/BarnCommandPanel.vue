<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import {
  BARN_PORTED_TABS,
  BARN_TABS,
  EMBED_HOLE_POS,
  ZUOJI_ARMOR_TYPE,
  holeAction,
  parseZuojiArmor,
  type ZuojiArmor,
} from '../../game/barn';
import { useGame } from '../../game/game';
import { armorImage } from '../../game/goods';
import { i18n } from '../../i18n';
import { gameAlert, showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * Barn.BarnCommandDialog: the 粮仓 command dialog. 镶嵌 (坐骑装备) is ported — it picks a zuoji
 * armor (loadZuojiArmor) and unlades a pearl from a filled hole (doUnlade). 驯服 / 强化 / 升级
 * use server commands that are not ported yet and show a not-yet-open notice.
 */
const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

const tab = ref<number>(BARN_TABS.Active);

/** 镶嵌: the player's zuoji armors, the picked one, and the inline picker. */
const picked = shallowRef<ZuojiArmor | null>(null);
const picking = ref(false);
const zuojiList = shallowRef<ZuojiArmor[]>([]);

const TAB_BAR = [
  { id: BARN_TABS.Active, label: 'Barn_Active' },
  { id: BARN_TABS.Strong, label: 'Barn_Strong' },
  { id: BARN_TABS.Embed, label: 'Barn_Armor' },
  { id: BARN_TABS.Upgrade, label: 'Barn_Armor_upgrade' },
];

// --------------------------------------------------------------- receivers

const unregister = game.addGlobalReceiver('barn', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadZuojiArmor') {
    zuojiList.value = rowsOf(d.shift()).map(parseZuojiArmor);
  } else if (command === 'doUnlade') {
    const ok = int(d.shift());
    if (ok === 0) {
      d.shift(); // pos
      const pearls = str(d.shift());
      const a = picked.value;
      if (a) picked.value = parseZuojiArmor({ ...a.row, embed_pearls: pearls });
      gameAlert(i18n('Barn_EmbedSucc'));
    }
  }
});

onMounted(() => game.sendGlobalCommand('barn', 'loadBarnGoods', [0]));
onUnmounted(unregister);

// ------------------------------------------------------------------- tabs

function showTab(t: number) {
  tab.value = t;
  picking.value = false;
}

// ----------------------------------------------------------------- 镶嵌

/** `showMyArmor`: open the zuoji picker (loadZuojiArmor by 坐骑装备 type). */
function pickArmor() {
  picking.value = true;
  game.sendGlobalCommand('barn', 'loadZuojiArmor', [ZUOJI_ARMOR_TYPE, 0]);
}

function chooseArmor(a: ZuojiArmor) {
  picked.value = a.holes.join(',') === '' ? null : a;
  picking.value = false;
  if (!picked.value) void showAlert(i18n('Barn_InActiveHorse'));
}

/** `selectEmbedZuoji`: a filled hole unlades after confirming; an open hole's embed is not ported. */
async function selectHole(pos: number) {
  const a = picked.value;
  if (!a) {
    void showAlert(i18n('Barn_NoHorse'));
    return;
  }
  const action = holeAction(a, pos);
  if (action.kind === 'unlade') {
    const name = str(a.row[`pearl${pos}name`]) || '';
    if ((await showAlert(i18n('Barn_Unlade') + name, '', ['yes', 'no'])) === 'yes') {
      game.sendGlobalCommand('barn', 'doUnlade', [a.sid, action.gid, pos]);
    }
  } else if (action.kind === 'embed') {
    void showAlert(i18n('NotYetValid'));
  }
}
</script>

<template>
  <FxCanvas :x="14" :y="75" :w="650" :h="370" style-name="PopupDialog">
    <FxButton :right="8" :y="6" style-name="Close" @click="game.closeDialog()" />

    <!-- tab bar -->
    <FxCanvas :x="4" :y="8" :w="647" :h="43" style-name="BoardListUp">
      <FxButton
        v-for="(t, i) in TAB_BAR"
        :key="t.id"
        :x="2 + i * 85"
        :y="2"
        :w="74"
        :h="37"
        style-name="ButtonYellow"
        :label="i18n(t.label)"
        :selected="tab === t.id"
        @click="showTab(t.id)"
      />
    </FxCanvas>

    <!-- not-ported tabs (驯服 / 强化 / 升级) -->
    <FxCanvas
      v-if="!BARN_PORTED_TABS.has(tab)"
      :x="4"
      :y="55"
      :w="646"
      :h="310"
      style-name="BoardListUp"
    >
      <FxLabel
        :x="40"
        :y="140"
        :w="560"
        :fx="{ textAlign: 'center' }"
        :text="i18n('NotYetValid')"
      />
    </FxCanvas>

    <!-- 镶嵌 -->
    <FxCanvas v-else :x="4" :y="55" :w="647" :h="310" style-name="BoardListUp">
      <FxCanvas :x="10" :y="7" :w="419" :h="257" style-name="BoardListUp">
        <FxImage
          v-if="picked"
          :x="168"
          :y="115"
          :w="64"
          :h="64"
          :source="armorImage(picked.row)"
          @click="pickArmor()"
        />
        <FxButton v-else :x="168" :y="115" :w="64" :h="64" label="+" @click="pickArmor()" />
        <FxButton
          v-for="(p, pos) in EMBED_HOLE_POS"
          :key="pos"
          :x="p.x"
          :y="p.y"
          :w="32"
          :h="32"
          :label="
            picked && picked.pearls[pos] ? '●' : picked && picked.holes[pos] === 0 ? '○' : '×'
          "
          @click="selectHole(pos)"
        />
        <FxLabel
          :x="171"
          :y="211"
          :w="79"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Barn_ZuojiSelect')"
        />
      </FxCanvas>
      <FxCanvas :x="438" :y="7" :w="197" :h="255" style-name="BoardListUp">
        <FxText :x="17" :y="10" :w="170" :h="219" :html="i18n('Barn_EmbedDesc')" />
      </FxCanvas>

      <!-- inline zuoji picker (loadZuojiArmor) -->
      <FxCanvas v-if="picking" :x="20" :y="20" :w="610" :h="280" style-name="PopupDialog">
        <FxButton :right="6" :y="6" style-name="Close" @click="picking = false" />
        <FxCanvas :x="10" :y="40" :w="590" :h="230" style-name="BoardListDown" scroll-y>
          <FxImage
            v-for="(a, i) in zuojiList"
            :key="a.sid"
            :x="10 + (i % 7) * 82"
            :y="10 + Math.floor(i / 7) * 82"
            :w="64"
            :h="64"
            :source="a.image"
            @click="chooseArmor(a)"
          />
          <FxLabel
            v-if="zuojiList.length === 0"
            :x="20"
            :y="100"
            :w="550"
            :fx="{ textAlign: 'center' }"
            :text="i18n('Barn_InActiveHorse')"
          />
        </FxCanvas>
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
