<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import type { PkBattle } from '../../game/campaign-pk';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * MarrySystem.MarryHeroBattlePanel: the 1v1 playback of the propose fight (the king hero against
 * the girlfriend's guard NPC, `MarryKingExpr.proposeMarry` reply). Same engine and report shape
 * as the 过关斩将 HeroBattlePanel (`getBattleData`), so the playback is shared and this panel
 * adds the two fighters' portraits over the battle background.
 */
const props = defineProps<{
  battle: PkBattle | null;
  king: Record<string, unknown> | null;
  npc: Record<string, unknown> | null;
}>();
const emit = defineEmits<{ close: [] }>();

const roundIndex = ref(-1);
const timer = setInterval(step, 700);
onUnmounted(() => clearInterval(timer));
const rounds = computed(() => props.battle?.report ?? []);

function step(): void {
  if (roundIndex.value + 1 >= rounds.value.length) return;
  roundIndex.value++;
}

const kingImage = computed(() => {
  const k = props.king;
  if (!k) return null;
  return `images/hero/hero_${Number(k.sex) === 0 ? 'girl_' : 'boy_'}${Number(k.face ?? 0)}.jpg`;
});
const npcImage = computed(() => {
  const n = props.npc;
  if (!n) return null;
  return `images/hero/hero_${Number(n.sex) === 0 ? 'girl_' : 'boy_'}${Number(n.face ?? 0)}.jpg`;
});
const curRound = computed(() => rounds.value[roundIndex.value] ?? []);
const win = computed(() => props.battle?.winer === 1);

const blowText = (b: { attackhid: unknown; damage: unknown }): string =>
  `${i18n('Hero_Battle_Dialog_battle_report_attack')} ${String(b.attackhid ?? '')}${i18n('Hero_Battle_Dialog_battle_report_1')}<font color='#e88817'>${Number(b.damage ?? 0)}</font>${i18n('Hero_Battle_Dialog_battle_report_2')}`;
</script>

<template>
  <FxCanvas :w="733" :h="525" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.75 }">
    <FxImage source="images/hero_battle_bg.jpg" />
    <FxLabel
      :x="0"
      :y="8"
      :w="733"
      :h="20"
      style-name="PopupDialogTitle"
      :fx="{ textAlign: 'center' }"
      :text="i18n('Marry_System_title')"
    />
    <FxCanvas :x="60" :y="60" :w="64" :h="80" style-name="FramePicture">
      <FxImage :x="2" :y="2" :w="60" :h="76" :source="kingImage" />
    </FxCanvas>
    <FxCanvas :x="609" :y="60" :w="64" :h="80" style-name="FramePicture">
      <FxImage :x="2" :y="2" :w="60" :h="76" :source="npcImage" />
    </FxCanvas>
    <FxCanvas :x="33" :y="160" :w="667" :h="60" style-name="BoardListUp">
      <FxText
        :x="8"
        :y="6"
        :w="650"
        :h="48"
        :html="curRound.map(blowText).join('<br />')"
        :fx="{ color: 16777215 }"
      />
    </FxCanvas>
    <FxLabel
      :x="0"
      :y="240"
      :w="733"
      :h="24"
      :fx="{ textAlign: 'center', fontSize: 14, color: win ? 65280 : 16711680, fontWeight: 'bold' }"
      :text="
        roundIndex + 1 >= rounds.length
          ? win
            ? i18n('Hero_Battle_Dialog_battle_report_result_1')
            : i18n('Hero_Battle_Dialog_battle_report_result_2')
          : `${i18n('Hero_Battle_Dialog_battle_panel_1')}${roundIndex + 1}`
      "
    />
    <FxButton :x="330" :y="450" :w="80" :h="36" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
