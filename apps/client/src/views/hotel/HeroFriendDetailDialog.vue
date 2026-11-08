<script setup lang="ts">
import { computed, onUnmounted } from 'vue';
import { useGame } from '../../game/game';
import { ID_BUILDING_HOTEL, type LionizeHero } from '../../game/hotelLionize';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
const props = defineProps<{
  param: number;
  hero: LionizeHero;
  detail: Record<string, unknown>;
  persuadeClosed: boolean;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const game = useGame();
const t = (n: number) => i18n(`Hotel_HeroFriendDetailDialog_${n}_1`);
const stats = computed(() => [
  [i18n('Hotel_HeroRecruitDialog_5_1'), props.hero.level],
  [i18n('Hotel_HeroRecruitDialog_6_1'), props.hero.bravery_base + props.hero.bravery_add],
  [i18n('Hotel_HeroRecruitDialog_9_1'), props.hero.affairs_base + props.hero.affairs_add],
  [i18n('Hotel_HeroRecruitDialog_10_1'), props.hero.wisdom_base + props.hero.wisdom_add],
  [i18n('Hotel_HeroRecruitDialog_8_1'), String(props.detail.loyalty ?? '')],
  [i18n('Hotel_HeroRecruitDialog_11_1'), props.hero.level * 20],
  [t(1), props.hero.npcname],
  [t(2), props.hero.npcstate],
  [t(3), String(props.detail.count ?? 0)],
  [i18n('Hotel_JiejiaoHeroDialog_12_1'), props.hero.friend],
]);
async function persuade() {
  if ((await showAlert(t(6), '', ['yes', 'no'])) !== 'yes') return;
  game.sendDialogCommand('PersuadeHero', ID_BUILDING_HOTEL, props.param, [props.hero.hid], 21);
}
function cancelFriend() {
  game.sendDialogCommand('onCancelFriend', ID_BUILDING_HOTEL, props.param, [props.hero.hid], 21);
}
const unregister = game.addDialogReceiver({
  isTarget: (id, p) => id === ID_BUILDING_HOTEL && p === props.param,
  onData(data, ttype) {
    if (ttype === 21 && Array.isArray(data)) {
      void showAlert(String(data[0] ?? ''));
      emit('changed');
      emit('close');
    }
  },
});
onUnmounted(unregister);
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5, fontSize: 12 }">
    <FxCanvas :x="125" :y="45" :w="432" :h="405" style-name="PopupDialog">
      <FxLabel
        :x="20"
        :y="15"
        :w="392"
        :text="hero.name"
        :fx="{ textAlign: 'center', fontSize: 16 }"
      />
      <FxImage
        :x="20"
        :y="55"
        :w="64"
        :h="80"
        :source="`images/hero/hero_${Number(detail.sex) === 0 ? 'girl' : 'boy'}_${detail.face ?? 0}.jpg`"
      />
      <template v-for="(stat, index) in stats" :key="index">
        <FxLabel
          :x="100 + (index % 2) * 155"
          :y="55 + Math.floor(index / 2) * 35"
          :w="100"
          :text="String(stat[0])"
        />
        <FxLabel
          :x="195 + (index % 2) * 155"
          :y="55 + Math.floor(index / 2) * 35"
          :w="60"
          :text="String(stat[1])"
        />
      </template>
      <FxText :x="20" :y="245" :w="392" :h="80" scroll :text="String(detail.introduce ?? '')" />
      <FxButton
        v-if="hero.state !== 2 && !persuadeClosed"
        :x="20"
        :bottom="20"
        :label="t(5)"
        @click="persuade"
      />
      <FxButton
        v-if="hero.state !== 2"
        :x="220"
        :bottom="20"
        style-name="ButtonRed"
        :label="t(4)"
        @click="cancelFriend"
      />
      <FxButton :right="15" :bottom="20" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
