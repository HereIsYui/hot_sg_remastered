<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { assets, type StyleDecl } from '../assets/registry';
import { boxStyle, cssColor, styleNumber, textStyle } from './skin';

/** mx.controls.TextInput (the game only uses borderless `EmptyTextInput`-style inputs on skins). */
const props = withDefaults(
  defineProps<{
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    styleName?: string;
    fx?: StyleDecl;
    password?: boolean;
    maxChars?: number;
    /** Allowed characters as the body of a regex character class, e.g. `a-zA-Z0-9`. */
    restrict?: string;
    editable?: boolean;
    tabindex?: number;
  }>(),
  { editable: true },
);

const model = defineModel<string>({ default: '' });
const emit = defineEmits<{ enter: []; keydown: [KeyboardEvent] }>();
const input = ref<HTMLInputElement>();

watch(model, (value) => {
  if (!props.restrict) return;
  const kept = value.replace(new RegExp(`[^${props.restrict}]`, 'g'), '');
  if (kept !== value) model.value = kept;
});

const decl = computed(() => assets.style('TextInput', props.styleName, props.fx));
const style = computed(() => {
  const d = decl.value;
  const alpha = styleNumber(d, 'backgroundAlpha') ?? 1;
  return {
    ...boxStyle(props),
    ...textStyle(d),
    backgroundColor: alpha > 0 ? cssColor(d.backgroundColor ?? 0xffffff, alpha) : 'transparent',
    border: d.borderStyle === 'none' ? 'none' : '1px inset #b7babc',
  };
});

function onKeydown(e: KeyboardEvent) {
  emit('keydown', e);
  if (e.key === 'Enter' && !e.isComposing) emit('enter');
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <input
    ref="input"
    v-model="model"
    class="fx-input"
    :style="style"
    :type="password ? 'password' : 'text'"
    :maxlength="maxChars"
    :readonly="!editable"
    :tabindex="tabindex"
    autocomplete="off"
    spellcheck="false"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.fx-input {
  box-sizing: border-box;
  margin: 0;
  padding: 0 2px;
  outline: none;
  font: inherit;
}
</style>
