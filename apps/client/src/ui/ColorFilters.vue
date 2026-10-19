<script setup lang="ts">
import { GREY_MATRIX, HILIGHT_MATRIX, svgMatrix } from './colorFilters';

const grey = svgMatrix(GREY_MATRIX);
const hilight = svgMatrix(HILIGHT_MATRIX);
</script>

<template>
  <svg class="color-filters" aria-hidden="true">
    <defs>
      <filter id="fx-grey" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" :values="grey" />
      </filter>
      <filter id="fx-hilight" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" :values="hilight" />
      </filter>
      <filter id="fx-grey-hilight" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" :values="grey" />
        <feColorMatrix type="matrix" :values="hilight" />
      </filter>
    </defs>
  </svg>
</template>

<style scoped>
.color-filters {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
