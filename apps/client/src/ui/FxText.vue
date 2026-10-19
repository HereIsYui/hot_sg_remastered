<script setup lang="ts">
import { computed } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { flexHtml } from '../core/flexHtml';
import { boxStyle, textStyle } from './skin';

/** mx.controls.Text / TextArea: wrapping (html)text; `scroll` for TextArea's scrollbar. */
const props = defineProps<{
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  styleName?: string;
  fx?: StyleDecl;
  text?: string;
  html?: string | null;
  scroll?: boolean;
  type?: 'Text' | 'TextArea';
}>();

const emit = defineEmits<{ link: [string] }>();

const decl = computed(() =>
  assets.style(props.type ?? (props.scroll ? 'TextArea' : 'Text'), props.styleName, props.fx),
);
const content = computed(() => (props.html != null ? flexHtml(props.html) : null));

function onClick(e: MouseEvent) {
  const link = (e.target as HTMLElement).closest('a[data-event]');
  if (link) emit('link', link.getAttribute('data-event') ?? '');
}
</script>

<template>
  <div
    v-if="content !== null"
    class="fx-text"
    :class="{ scroll }"
    :style="{ ...boxStyle(props), ...textStyle(decl) }"
    @click="onClick"
    v-html="content"
  />
  <div
    v-else
    class="fx-text"
    :class="{ scroll }"
    :style="{ ...boxStyle(props), ...textStyle(decl) }"
  >
    {{ text ?? '' }}
  </div>
</template>

<style scoped>
.fx-text {
  white-space: pre-wrap;
  word-break: break-all;
  overflow: hidden;
  padding: 2px;
  box-sizing: border-box;
  line-height: 1.4;
}

.fx-text.scroll {
  overflow-y: auto;
}

.fx-text :deep(a) {
  color: inherit;
  cursor: pointer;
}
</style>
