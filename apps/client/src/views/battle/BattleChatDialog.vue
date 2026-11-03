<script setup lang="ts">
import { computed, ref } from 'vue';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleChatDialog: the NPC conversation of `chatWithHero` / `questInCity` — the reply is
 * `[heroRow, text, heroRow, text, ...]`; `show()` shifts one pair per page (`onClose` steps
 * through), the portrait is `images/hero/hero_<sex>_<face>.jpg`.
 */
const props = defineProps<{ queue: unknown[] }>();
const emit = defineEmits<{ close: [] }>();

const pages = ref<unknown[]>([...props.queue]);
const heroInfo = computed(() => (pages.value[0] ?? {}) as Record<string, unknown>);
const text = computed(() => String(pages.value[1] ?? ''));
const heroImage = computed(
  () =>
    `images/hero/hero_${Number(heroInfo.value.sex) === 0 ? 'girl_' : 'boy_'}${Number(
      heroInfo.value.face ?? 0,
    )}.jpg`,
);
const nextLabel = computed(() =>
  pages.value.length > 2
    ? i18n('Battle_BattleChatDetailDialog_1_2')
    : i18n('Battle_BattleChatDetailDialog_1_3'),
);

/** `onClose`: the next pair, or hide. */
function next(): void {
  if (pages.value.length > 0) {
    pages.value = pages.value.slice(2);
    if (pages.value.length === 0) emit('close');
  } else {
    emit('close');
  }
}
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0 }">
    <FxCanvas :x="118" :y="113" :w="446" :h="204" style-name="PanelGreyGreen">
      <FxImage :x="19" :y="70" :w="64" :h="80" :source="heroImage" />
      <FxCanvas :x="154" :y="20" :w="138" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="14"
          :y="4"
          :w="112"
          :h="18"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Battle_BattleChatDetailDialog_1_1')"
        />
      </FxCanvas>
      <FxCanvas :x="91" :y="70" :w="336" :h="80" style-name="BoardListDown">
        <FxLabel
          :x="3"
          :y="3"
          :w="330"
          :h="64"
          style-name="ItemValue"
          :fx="{ color: 16777215, textAlign: 'center' }"
          :text="text"
        />
      </FxCanvas>
      <FxButton
        :x="327"
        :y="158"
        :w="65"
        :h="36"
        :fx="{ fontSize: 16 }"
        :label="nextLabel"
        @click="next"
      />
    </FxCanvas>
  </FxCanvas>
</template>
