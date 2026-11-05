<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Armor } from '../../game/armor';
import { PAGE_ITEM_COUNT, itemPosition, pageCount } from '../../game/goods';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import UserArmorItem from './UserArmorItem.vue';

/**
 * The paged piece grid of the smithy / barn pickers (UnActiveArmorDialog, UnActiveHorseDialog,
 * the part pickers): 21 pieces a page, 7 to a row, as in ArmorDialog.
 */
const props = defineProps<{ x?: number; y?: number; armors: Armor[]; empty?: string }>();
const emit = defineEmits<{ pick: [a: Armor, e: MouseEvent] }>();

const page = ref(0);
const pages = computed(() => pageCount(props.armors.length));
const shown = computed(() =>
  props.armors.slice(page.value * PAGE_ITEM_COUNT, (page.value + 1) * PAGE_ITEM_COUNT),
);
watch(
  () => props.armors,
  () => (page.value = 0),
);
</script>

<template>
  <FxCanvas :x="x ?? 0" :y="y ?? 0" :w="636" :h="330">
    <FxCanvas v-if="pages > 1" :x="420" :y="0" :w="210" :h="30">
      <FxCanvas :x="8" :y="3" :w="70" :h="25" style-name="BoardListDown">
        <FxLabel
          :y="3"
          :w="70"
          style-name="ItemValue"
          :fx="{ textAlign: 'center', fontWeight: 'bold' }"
          :text="`${page + 1}/${pages}`"
        />
      </FxCanvas>
      <FxButton
        :x="78"
        :y="0"
        :w="65"
        :label="i18n('Armor_ArmorDialog_2_1')"
        @click="page = Math.max(0, page - 1)"
      />
      <FxButton
        :x="141"
        :y="0"
        :w="65"
        :label="i18n('Armor_ArmorDialog_3_1')"
        @click="page = Math.min(pages - 1, page + 1)"
      />
    </FxCanvas>
    <FxCanvas :x="0" :y="32" :w="636" :h="298" style-name="BoardListDown">
      <FxCanvas :x="8" :y="2" :w="620" :h="292">
        <UserArmorItem
          v-for="(a, i) in shown"
          :key="a.sid"
          v-bind="itemPosition(i)"
          :armor="a"
          @pick="emit('pick', a, $event)"
        />
      </FxCanvas>
      <FxLabel
        v-if="armors.length === 0 && empty"
        :x="20"
        :y="130"
        :w="596"
        :fx="{ textAlign: 'center' }"
        :text="empty"
      />
    </FxCanvas>
  </FxCanvas>
</template>
