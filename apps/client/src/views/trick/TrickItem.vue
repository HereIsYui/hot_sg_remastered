<script setup lang="ts">
import { computed, ref } from 'vue';
import { assets } from '../../assets/registry';
import type { TrickItemRow } from '../../game/trick';
import TrickTip from './TrickTip.vue';

/**
 * Trick/TrickItem: one 78x90 trick cell of the trickPanel grid (7 per row). The image shows
 * `images/trick_<id>.png`; an invalid trick (usetype != the dialog's tricktype) is dimmed by the
 * 66% black overlay of the original. Hovering shows the TrickTip (`onCreateTrickTip`), clicking
 * reports the cell to the TrickDialog (`onClickTrick`).
 */
const props = defineProps<{
  item: TrickItemRow;
  /** The cell's grid column (0-6): the tip flips to the left edge near the panel's right side. */
  column: number;
}>();

const emit = defineEmits<{ click: [item: TrickItemRow] }>();

const hover = ref(false);

const image = computed(() => assets.url(`images/trick_${props.item.id}.png`));
/** `TrickDialog.onGetTrickList`: cells sit at x=10 + col*86, y=10 + row*98 within trickPanel. */
const tipLeft = computed(() => props.column < 4);
</script>

<template>
  <div
    class="trick-item"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @click="emit('click', item)"
  >
    <div class="frame">
      <img class="pic" :src="image" alt="" draggable="false" />
      <div v-if="item.invalid" class="dim" />
    </div>
    <div class="name">{{ item.name }}</div>
    <TrickTip
      v-if="hover"
      class="tip"
      :class="{ 'tip-left': tipLeft, 'tip-right': !tipLeft }"
      :name="item.name"
      :description="item.description"
      :cost="item.cost"
    />
  </div>
</template>

<style scoped>
.trick-item {
  position: relative;
  width: 78px;
  height: 90px;
  background: #26301b;
  border: 1px solid #4c5c33;
  cursor: pointer;
}

.frame {
  position: absolute;
  left: 5px;
  top: 4px;
  width: 68px;
  height: 68px;
  border: 1px solid #93967f;
  background: #10130a;
}

.pic {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 64px;
  height: 64px;
}

.dim {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 64px;
  height: 64px;
  background: rgba(0, 0, 0, 0.66);
}

.name {
  position: absolute;
  left: 3px;
  top: 72px;
  width: 75px;
  color: #fff;
  font-size: 12px;
  text-align: center;
}

.tip {
  top: 16px;
}

.tip-left {
  left: 40px;
}

.tip-right {
  right: 86px;
}
</style>
