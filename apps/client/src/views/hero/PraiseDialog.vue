<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import type { HeroDetail } from '../../game/hero';
import {
  parseHeroPraiseGoods,
  praiseConfirmationKey,
  praiseHeroArgs,
  type HeroPraiseGoods,
} from '../../game/heroPraise';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

const props = defineProps<{ hero: HeroDetail }>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const city = useCityStore();
const goods = ref<HeroPraiseGoods[]>([]);
const selected = ref(0);
const sending = ref(false);
const item = computed(() => goods.value[selected.value]);
const unregister = game.addGlobalReceiver('hero', (command, data) => {
  if (command === 'praiseHero') emit('close');
  if (command === 'loadHeroGoods') {
    goods.value = parseHeroPraiseGoods(data);
    selected.value = 0;
  }
});
onMounted(() => game.sendGlobalCommand('hero', 'loadHeroGoods'));
onUnmounted(unregister);
async function praise() {
  const chosen = item.value;
  if (!chosen || sending.value) return;
  sending.value = true;
  try {
    const confirmation = praiseConfirmationKey(chosen.gid);
    if (confirmation && (await showAlert(i18n(confirmation), '', ['yes', 'no'])) !== 'yes') return;
    await game.cmd.sendGlobalCommand(
      'hero',
      'praiseHero',
      praiseHeroArgs(city.cid, props.hero.hid, chosen.gid),
    );
    game.refreshResource();
    game.sendGlobalCommand('goods', 'loadUserGoods');
  } finally {
    sending.value = false;
  }
}
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="181" :y="76" :w="320" :h="340" style-name="PopupDialog">
      <FxLabel
        :x="20"
        :y="16"
        :w="280"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="i18n('Hero_PraiseDialog_1_1')"
      />
      <FxLabel
        :x="25"
        :y="55"
        :w="270"
        :text="`${props.hero.name} / ${i18n('Hero_LargessDialog_4_1')} ${props.hero.level} / ${i18n('Hero_LargessDialog_5_1')} ${props.hero.loyalty}`"
      />
      <FxLabel :x="25" :y="96" :text="i18n('Hero_PraiseDialog_6_1')" />
      <FxComboBox
        v-model:selected-index="selected"
        :x="90"
        :y="94"
        :w="205"
        :items="goods.map((g) => g.name)"
        :enabled="!sending"
      />
      <FxText :x="25" :y="130" :w="270" :h="135" scroll :text="item?.description ?? ''" />
      <FxButton
        :x="145"
        :y="285"
        :w="75"
        :h="34"
        style-name="ButtonGreen"
        :label="i18n('Hero_PraiseDialog_2_1')"
        :enabled="!!item && !sending"
        @click="praise"
      />
      <FxButton :right="15" :bottom="15" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
