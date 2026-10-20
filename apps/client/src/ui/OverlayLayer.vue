<script setup lang="ts">
import { computed } from 'vue';
import { assets } from '../assets/registry';
import { flexHtml } from '../core/flexHtml';
import { alertState, closeAlert } from './alert';
import ArmorTipView from './ArmorTip.vue';
import FxButton from './FxButton.vue';
import GoodsTip from './GoodsTip.vue';
import PopupMenu from './PopupMenu.vue';
import ResourceTip from './ResourceTip.vue';
import { cssColor, skinStyle, styleString, textStyle } from './skin';
import { tooltip } from './tooltip';

/** Top-most stage layer: modal Alerts, the floating AlertPanel, popup menus and tooltips. */

const alertDecl = computed(() => assets.style('Alert'));
const titleDecl = computed(() => assets.style('', styleString(alertDecl.value, 'titleStyleName')));
const messageDecl = computed(() =>
  assets.style('', styleString(alertDecl.value, 'messageStyleName')),
);
const controlBarDecl = computed(() =>
  assets.style('', styleString(alertDecl.value, 'controlBarStyleName')),
);
const buttonStyleName = computed(() => styleString(alertDecl.value, 'buttonStyleName'));
const panelDecl = computed(() => assets.style('AlertPanel'));
const tipDecl = computed(() => assets.style('ToolTip'));
const tipStyle = computed(() => ({
  ...textStyle(tipDecl.value),
  ...skinStyle(styleString(tipDecl.value, 'borderSkin')),
  left: `${Math.min(tooltip.x, 1000 - 20)}px`,
  top: `${Math.min(tooltip.y, 600 - 20)}px`,
}));
</script>

<template>
  <div class="overlay">
    <div
      v-if="alertState.panel.visible"
      class="alert-panel"
      :style="skinStyle(styleString(panelDecl, 'borderSkin'))"
    >
      <div class="alert-panel-text">{{ alertState.panel.text }}</div>
    </div>

    <div v-for="item in alertState.items" :key="item.id" class="modal">
      <div class="alert" :style="{ backgroundColor: cssColor(0x869ca7, 0.9) }">
        <div class="alert-title" :style="textStyle(titleDecl)">{{ item.title }}</div>
        <div class="alert-message" :style="textStyle(messageDecl)" v-html="flexHtml(item.text)" />
        <div class="alert-buttons" :style="skinStyle(styleString(controlBarDecl, 'borderSkin'))">
          <FxButton
            v-for="b in item.buttons"
            :key="b"
            class="alert-button"
            :w="50"
            :h="28"
            :style-name="buttonStyleName"
            :label="alertState.labels[b]"
            @click="closeAlert(item.id, b)"
          />
        </div>
      </div>
    </div>

    <PopupMenu />

    <ResourceTip
      v-if="tooltip.visible && tooltip.resource"
      :tip="tooltip.resource"
      :x="tooltip.x"
      :y="tooltip.y"
    />
    <GoodsTip
      v-else-if="tooltip.visible && tooltip.goods"
      :tip="tooltip.goods"
      :x="tooltip.x"
      :y="tooltip.y"
    />
    <ArmorTipView
      v-else-if="tooltip.visible && tooltip.armor"
      :tip="tooltip.armor"
      :x="tooltip.x"
      :y="tooltip.y"
    />
    <div v-else-if="tooltip.visible" class="tooltip" :style="tipStyle">
      <span v-if="tooltip.html" v-html="flexHtml(tooltip.html)" />
      <template v-else>{{ tooltip.text }}</template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none !important;
  z-index: 1000;
}

.alert-panel {
  position: absolute;
  left: 245px;
  top: 70px;
  width: 735px;
  height: 50px;
  box-sizing: border-box;
  animation: fade-out 0.5s ease-in 2.5s forwards;
}

.alert-panel-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  color: #fff58c;
}

@keyframes fade-out {
  to {
    opacity: 0;
  }
}

.modal {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.alert {
  min-width: 220px;
  max-width: 420px;
  padding: 4px 10px 0;
  box-shadow: 5px 5px 6px rgba(0, 0, 0, 0.5);
}

.alert-title {
  min-height: 18px;
  padding: 2px 0;
}

.alert-message {
  padding: 8px 6px 12px;
  text-align: center;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}

.alert-buttons {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 0 -10px;
  padding: 6px 0;
}

.alert-buttons :deep(.alert-button) {
  position: relative !important;
  left: auto !important;
  top: auto !important;
}

.tooltip {
  position: absolute;
  max-width: 300px;
  padding: 2px 5px;
  white-space: pre-wrap;
  background-color: rgba(0, 0, 0, 0.8);
  border-radius: 3px;
}
</style>
