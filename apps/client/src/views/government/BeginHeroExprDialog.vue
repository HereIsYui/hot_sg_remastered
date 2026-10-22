<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  beginExprArgs,
  exprDescription,
  exprMoneyCost,
  type ExprHero,
  type ExprType,
} from '../../game/heroExpr';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';
import FxText from '../../ui/FxText.vue';

/**
 * Office.BeginHeroExprDialog: pick an idle hero, a 历练 type, the hours and carried 元宝, then
 * send `beginExprHero`. The parent (HeroExprDialog) owns the dialog command.
 */
const props = defineProps<{ heros: ExprHero[]; types: ExprType[] }>();
const emit = defineEmits<{ begin: [args: [number, number, number, number, number]]; close: [] }>();

const heroIndex = ref(0);
const typeIndex = ref(0);
const hours = ref(1);
const carrayMoney = ref(0);

const hero = computed<ExprHero | undefined>(() => props.heros[heroIndex.value]);
const type = computed<ExprType | undefined>(() => props.types[typeIndex.value]);

/** `init`: reset the pickers whenever the hero / type lists change. */
watch(
  () => [props.heros, props.types],
  () => {
    heroIndex.value = 0;
    typeIndex.value = 0;
    hours.value = type.value?.min_hour ?? 1;
    carrayMoney.value = 0;
  },
  { immediate: true },
);

/** `selectExprType`: clamp the hours to the new type's band. */
watch(type, (t) => {
  if (!t) return;
  hours.value = Math.min(t.max_hour, Math.max(t.min_hour, hours.value));
});

const heroNames = computed(() => props.heros.map((h) => h.heroname));
const typeNames = computed(() => props.types.map((t) => t.name));
const preview = computed(() =>
  hero.value && type.value ? exprDescription(type.value, hero.value.level) : '',
);

/** `onSubmit`: confirm when it costs 元宝, otherwise start straight away. */
async function onSubmit() {
  if (!hero.value) {
    void showAlert(i18n('Goods_WuhunUserSelectDialog_1'));
    return;
  }
  if (!type.value) return;
  const cost = exprMoneyCost(type.value, hours.value, carrayMoney.value);
  if (cost > 0) {
    const ok = await showAlert(
      `${i18n('BeginHeroExprDialog_11')}${i18n('BeginHeroExprDialog_15')}${cost}${i18n('BeginHeroExprDialog_16')}${i18n('BeginHeroExprDialog_17')}`,
      '',
      ['yes', 'no'],
    );
    if (ok !== 'yes') return;
  }
  emit('begin', beginExprArgs(hero.value, type.value, hours.value, carrayMoney.value));
}
</script>

<template>
  <FxCanvas :x="170" :y="75" :w="350" :h="317" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxButton
      :right="45"
      :bottom="14"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="emit('close')"
    />
    <FxCanvas :x="118" :y="12" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="6"
        :y="3"
        :w="102"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center' }"
        :text="i18n('BeginHeroExprDialog_10_1')"
      />
    </FxCanvas>

    <FxCanvas :x="34" :y="58" :w="100" :h="30" style-name="BoardListUp">
      <FxLabel
        :x="6"
        :y="3"
        :w="88"
        style-name="ItemTitle"
        :text="i18n('BeginHeroExprDialog_3_1')"
      />
    </FxCanvas>
    <FxComboBox
      v-model:selected-index="heroIndex"
      :x="143.5"
      :y="58"
      :w="127"
      :h="30"
      :items="heroNames"
    />

    <FxCanvas :x="34" :y="97" :w="100" :h="30" style-name="BoardListUp">
      <FxLabel
        :x="6"
        :y="3"
        :w="88"
        style-name="ItemTitle"
        :text="i18n('BeginHeroExprDialog_4_1')"
      />
    </FxCanvas>
    <FxComboBox
      v-model:selected-index="typeIndex"
      :x="143.5"
      :y="98"
      :w="127"
      :h="30"
      :row-count="6"
      :items="typeNames"
    />

    <FxCanvas :x="34" :y="134" :w="100" :h="30" style-name="BoardListUp">
      <FxLabel
        :x="6"
        :y="3"
        :w="88"
        style-name="ItemTitle"
        :text="i18n('BeginHeroExprDialog_5_1')"
      />
    </FxCanvas>
    <FxNumericStepper
      v-model="hours"
      :x="143.5"
      :y="135"
      :minimum="type?.min_hour ?? 1"
      :maximum="type?.max_hour ?? 1"
    />

    <FxText :x="34" :y="173" :w="255.5" :h="89" style-name="ItemValue" scroll :text="preview" />

    <FxButton
      :right="118.65"
      :bottom="14"
      :w="65"
      :h="36"
      style-name="ButtonGreen"
      :fx="{ fontSize: 16 }"
      :label="i18n('BeginHeroExprDialog_2_1')"
      @click="onSubmit"
    />
  </FxCanvas>
</template>
