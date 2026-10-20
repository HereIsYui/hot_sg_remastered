<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import {
  armorInfo,
  armorPartName,
  dealWithOtherInfoOfArmor,
  parseArmor,
  type Armor,
} from '../../game/armor';
import { useGame } from '../../game/game';
import type { HeroDetail } from '../../game/hero';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import ChangeArmorItem from './ChangeArmorItem.vue';

/**
 * Armor.ChangeArmorDialog: the user's pieces for one slot, or with `skill` the books of the
 * hero's skill (`showUserSkillBook`); picking one puts it on the hero.
 */
const props = defineProps<{ hero: HeroDetail; spart: number; skill?: number }>();
const emit = defineEmits<{ equip: [sid: number, spart: number]; wear: [id: number]; close: [] }>();

const game = useGame();
const src = (n: number | string) => i18n(`Armor_ChangeArmorDialogSrc_${n}`);
const int = (v: unknown) => parseInt(String(v), 10) || 0;

const part = Math.floor(props.spart / 10);
const title = armorPartName(part) + i18n('Armor_ChangeArmorDialog_1_1');
const armors = ref<Armor[]>([]);
const books = ref<Record<string, unknown>[]>([]);
const isSkill = props.skill !== undefined;
/** `mSelectedIndex`: 0 shows strengthened pieces only. */
const showAll = ref(false);

const shown = computed(() =>
  armors.value
    .filter((a) => {
      const id = int(a.row.armorid);
      return props.hero.king || id < 15000 || id > 16000;
    })
    .filter((a) => showAll.value || int(a.row.strong_level) > 0),
);

const rowsOf = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

const unregister = isSkill
  ? game.addGlobalReceiver('skill', (command, data) => {
      if (command !== 'loadUserSkillBook' || !Array.isArray(data)) return;
      books.value = rowsOf(data[0]);
    })
  : game.addGlobalReceiver('armor', (command, data) => {
      if (command !== 'loadUserPartArmor' || !Array.isArray(data) || data.length === 0) return;
      const rest = [...(data as unknown[])];
      armors.value = rowsOf(rest.shift()).map(parseArmor);
      dealWithOtherInfoOfArmor(armorInfo, rest);
    });
onUnmounted(unregister);
if (isSkill) game.sendGlobalCommand('skill', 'loadUserSkillBook', [props.skill ?? 0]);
else game.sendGlobalCommand('armor', 'loadUserPartArmor', [part]);

/** `onClickArmor` */
function onPick(a: Armor) {
  if (a.heroLevel > props.hero.level) {
    void showAlert(src(1) + a.heroLevel + src(2));
  } else if (a.hp <= 0) {
    void showAlert(src(3));
  } else {
    emit('equip', a.sid, props.spart);
    emit('close');
  }
}

/** `onClickSkill` */
function onPickBook(book: Record<string, unknown>) {
  emit('wear', int(book.id));
  emit('close');
}
</script>

<template>
  <FxCanvas :x="0" :y="0" :w="682" :h="492" :fx="{ fontSize: 12, borderStyle: 'none' }">
    <FxCanvas
      :x="0"
      :y="86"
      :w="682"
      :h="308"
      style-name="PopupDialog"
      :fx="{ backgroundColor: 8026746 }"
    >
      <FxCanvas :x="284" :y="13" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="4"
          :w="114"
          :fx="{ textAlign: 'center', color: 15007634 }"
          :text="title"
        />
      </FxCanvas>
      <FxButton :x="587" :bottom="15" style-name="Close" @click="emit('close')" />
      <FxCanvas :x="20" :y="48" :w="642" :h="208" style-name="BoardListDown">
        <FxCanvas :x="10" :y="10" :w="627" :h="188" scroll-y>
          <template v-if="isSkill">
            <ChangeArmorItem
              v-for="(book, i) in books"
              :key="String(book.id)"
              :x="(i % 7) * 88"
              :y="5 + Math.floor(i / 7) * 93"
              :book="book"
              @pick="onPickBook(book)"
            />
          </template>
          <template v-else>
            <ChangeArmorItem
              v-for="(a, i) in shown"
              :key="a.sid"
              :x="(i % 7) * 88"
              :y="5 + Math.floor(i / 7) * 93"
              :armor="a"
              @pick="onPick(a)"
            />
          </template>
        </FxCanvas>
      </FxCanvas>
      <FxButton
        v-if="!isSkill"
        :x="20"
        :y="262"
        :w="120"
        :label="src(showAll ? 'SelectType_1' : 'SelectType_2')"
        @click="showAll = !showAll"
      />
    </FxCanvas>
  </FxCanvas>
</template>
