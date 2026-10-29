<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { parseChildCulture, type Child } from '../../game/marry';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * MarrySystem.MarryChildCulture: one child's 培养 — the attribute totals with their 成长值 bonus
 * columns (`loadChildCulture [hid, room]`), the 周游列国/前往培养 mode combo (`startCulture
 * [hid, type]` consumes one 培养丹) and 完成 (`completeCulture [hid]` lands the child hero).
 */
const props = defineProps<{ child: Child | null }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();

type Row = Record<string, unknown>;
const culture = ref<Row | null>(null);
const cultureType = ref(0);

const attrs = computed(() => [
  {
    label: 'Hero_HeroDetailDialog_19_1',
    total: culture.value?.commandTotal,
    add: culture.value?.commandUpgradeAdd,
  },
  {
    label: 'Hero_HeroDetailDialog_35_1',
    total: culture.value?.affairsTotal,
    add: culture.value?.affairsUpgradeAdd,
  },
  {
    label: 'Hero_HeroDetailDialog_37_1',
    total: culture.value?.braveryTotal,
    add: culture.value?.braveryUpgradeAdd,
  },
  {
    label: 'Hero_HeroDetailDialog_39_1',
    total: culture.value?.wisdomTotal,
    add: culture.value?.wisdomUpgradeAdd,
  },
]);

const childImage = computed(() =>
  props.child
    ? `images/child/child_${Number(props.child.sex) === 0 ? 'girl' : 'boy'}_${Number(props.child.face ?? 1)}.png`
    : null,
);

const unregister = game.addGlobalReceiver('MarrySystem', (command, data) => {
  if (command === 'loadChildCulture') {
    culture.value = parseChildCulture(data);
  } else if (command === 'startCulture' || command === 'completeCulture') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) gameAlert(String(d.shift() ?? ''));
    if (props.child) {
      game.sendGlobalCommand('MarrySystem', 'loadChildCulture', [
        props.child.hid,
        Number(props.child.roomindex),
      ]);
    }
  }
});
onUnmounted(unregister);

/** `startCulture [hid, type]`: 0 周游列国, 1 前往培养. */
function doCulture(): void {
  if (!props.child) return;
  game.sendGlobalCommand('MarrySystem', 'startCulture', [props.child.hid, cultureType.value]);
}

/** `completeCulture [hid]`. */
function complete(): void {
  if (!props.child) return;
  game.sendGlobalCommand('MarrySystem', 'completeCulture', [props.child.hid]);
}
</script>

<template>
  <FxCanvas :w="625" :h="353" style-name="BoardListDown" :fx="{ fontSize: 12 }">
    <FxCanvas :x="89" :y="26" :w="90" :h="95" style-name="BoardListDown">
      <FxImage :x="2" :y="2" :w="85" :h="90" :source="childImage" />
      <FxImage :x="2" :y="2" :w="85" :h="90" source="images/child_pre_frame.png" />
    </FxCanvas>
    <FxCanvas :x="89" :y="130" :w="100" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="100"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(props.child?.name ?? '')"
      />
    </FxCanvas>
    <FxCanvas :x="17" :y="178" :w="246" :h="155" style-name="BoardListDown">
      <template v-for="(attr, i) in attrs" :key="attr.label">
        <FxText
          :x="5"
          :y="5 + i * 39"
          :w="59"
          :h="28"
          style-name="ItemTitle"
          :fx="{ color: 16547361, fontSize: 13, paddingTop: 3, textAlign: 'center' }"
          :text="i18n(attr.label)"
        />
        <FxCanvas :x="67" :y="6 + i * 39" :w="50" :h="28" style-name="BoardListDown">
          <FxText
            :x="0"
            :y="0"
            :w="50"
            :h="28"
            style-name="ItemValue"
            :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
            :text="String(attr.total ?? '')"
          />
        </FxCanvas>
        <FxText
          :x="125"
          :y="5 + i * 39"
          :w="64"
          :h="28"
          :fx="{ color: 13421772, fontSize: 13, paddingTop: 3, textAlign: 'center' }"
          :text="i18n('Marry_System_attri_upgrade')"
        />
        <FxCanvas :x="192" :y="6 + i * 39" :w="50" :h="28" style-name="BoardListDown">
          <FxText
            :x="0"
            :y="0"
            :w="50"
            :h="28"
            style-name="ItemValue"
            :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
            :text="String(attr.add ?? '')"
          />
        </FxCanvas>
      </template>
    </FxCanvas>
    <FxCanvas :x="300" :y="26" :w="300" :h="150" style-name="BoardListDown">
      <FxLabel
        :x="8"
        :y="10"
        :w="284"
        :fx="{ color: 16777215 }"
        :text="i18n('Marry_System_culture_instr')"
      />
      <FxToggle
        type="RadioButton"
        :x="20"
        :y="50"
        :w="120"
        :label="i18n('Marry_System_culture_type_1')"
        :selected="cultureType === 0"
        @change="(v) => v && (cultureType = 0)"
      />
      <FxToggle
        type="RadioButton"
        :x="20"
        :y="85"
        :w="120"
        :label="i18n('Marry_System_culture_type_2')"
        :selected="cultureType === 1"
        @change="(v) => v && (cultureType = 1)"
      />
    </FxCanvas>
    <FxButton
      :x="300"
      :y="200"
      :w="110"
      :h="40"
      style-name="ButtonYellow"
      :label="i18n('Marry_System_culture')"
      @click="doCulture"
    />
    <FxButton
      :x="430"
      :y="200"
      :w="110"
      :h="40"
      style-name="ButtonGreen"
      :label="i18n('Marry_System_culture_finish')"
      @click="complete"
    />
    <FxButton :x="560" :y="200" :w="70" :h="36" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
