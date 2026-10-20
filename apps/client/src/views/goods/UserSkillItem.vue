<script setup lang="ts">
import { computed } from 'vue';
import { skillTip, type SkillBook } from '../../game/skill';
import { i18n } from '../../i18n';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import { showMenu } from '../../ui/menu';
import { stagePoint, type TipValue } from '../../ui/tooltip';

/** Goods.UserSkillItem: a book's picture, name and level; a click offers 回收. */
const props = defineProps<{ x: number; y: number; book: SkillBook }>();
const emit = defineEmits<{ sell: [book: SkillBook] }>();

const tip = computed<TipValue>(() => ({ skill: skillTip(props.book.row) }));

async function onClick(e: MouseEvent) {
  const p = stagePoint(e.currentTarget as Element, e.clientX, e.clientY);
  const action = await showMenu(
    [{ label: i18n('Armor_UserArmorItem_3_1'), data: 'sell' }],
    p.x,
    p.y,
  );
  if (action === 'sell') emit('sell', props.book);
}
</script>

<template>
  <FxCanvas :x="x" :y="y" :w="68" :h="68" style-name="BoardListDown">
    <FxImage :x="2" :y="2" :w="64" :h="64" :source="book.image" :tip="tip" hand @click="onClick" />
    <FxLabel
      class="glow"
      :x="2"
      :y="4"
      :w="64"
      :h="28"
      :text="String(book.row.name ?? '')"
      :tip="tip"
      @click="onClick"
    />
    <FxLabel
      class="glow"
      :x="2"
      :y="25"
      :w="64"
      :h="28"
      :text="book.level + i18n('Hero_InfoHeroItem_1_1')"
      :tip="tip"
      @click="onClick"
    />
  </FxCanvas>
</template>

<style scoped>
.glow {
  text-shadow:
    0 0 2px #000,
    0 0 2px #000,
    0 0 3px #000;
}
</style>
