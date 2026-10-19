<script setup lang="ts">
import { computed } from 'vue';
import { colorFilter } from '../../ui/colorFilters';
import FxImage from '../../ui/FxImage.vue';

/**
 * Building.BuildingGrid: one building slot of the city views. Shows the building image, or the
 * empty-slot shadow, plus an optional level badge; grey while upgrading, highlighted on hover.
 */
const props = defineProps<{
  x: number;
  y: number;
  /** Building image; drawn at natural size unless `imageW`/`imageH` are given. */
  image?: string;
  imageW?: number;
  imageH?: number;
  /** Top-left of the empty-slot shadow (104x50); none for slots that are never empty. */
  shadow?: readonly [number, number];
  /** Level badge, hidden when null. */
  level?: number | null;
  levelAt?: readonly [number, number];
  grey?: boolean;
  hilight?: boolean;
}>();

const filter = computed(() => ({
  filter: colorFilter(props.grey ?? false, props.hilight ?? false),
}));
</script>

<template>
  <div class="building-grid" :style="{ left: `${x}px`, top: `${y}px` }">
    <FxImage
      v-if="!image && shadow"
      source="swf/scene.swf#empty_shadow"
      :x="shadow[0]"
      :y="shadow[1]"
      :w="104"
      :h="50"
      :style="filter"
    />
    <FxImage v-if="image" :source="image" :w="imageW" :h="imageH" :style="filter" />
    <FxImage
      v-if="level != null && levelAt"
      :source="`images/level_${level}.png`"
      :x="levelAt[0]"
      :y="levelAt[1]"
      :w="19"
      :h="14"
    />
  </div>
</template>

<style scoped>
.building-grid {
  position: absolute;
  pointer-events: none;
}
</style>
