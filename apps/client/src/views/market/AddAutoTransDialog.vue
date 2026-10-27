<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  autoTransArgs,
  autoTransError,
  defaultAutoTransClock,
  marketResourceName,
  type AutoTransForm,
} from '../../game/market';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { useUserStore } from '../../stores/user';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxComboBox from '../../ui/FxComboBox.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';
import FxToggle from '../../ui/FxToggle.vue';

const emit = defineEmits<{ close: []; submit: [args: ReturnType<typeof autoTransArgs>] }>();
const city = useCityStore();
const user = useUserStore();
const fromIndex = ref(Math.max(0, user.cityIndex));
const toIndex = ref(Math.max(0, user.cityIndex));
const resIndex = ref(0);
const cities = computed(() => user.cities.map((c) => `${c.name}${c.position}`));
const resources = [0, 1, 2, 3, 4].map(marketResourceName);
const form = reactive<AutoTransForm>({
  fromcid: city.cid || user.cid,
  tocid: city.cid || user.cid,
  resType: 0,
  count: '0',
  daily: false,
  ...defaultAutoTransClock(Date.now()),
});

function changeCity(which: 'from' | 'to', index: number): void {
  const selected = user.cities[index];
  if (!selected) return;
  if (which === 'from') form.fromcid = selected.cid;
  else form.tocid = selected.cid;
}

function submit(): void {
  const error = autoTransError(form, Date.now());
  if (error) {
    void showAlert(i18n(error));
    return;
  }
  emit('submit', autoTransArgs(form));
}
</script>

<template>
  <FxCanvas :x="100" :y="50" :w="468" :h="378" style-name="PopupDialog">
    <FxCanvas :x="179.5" :y="17" :w="137" :h="23" style-name="PopupTitle">
      <FxLabel
        :y="2"
        :w="137"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Market_AddAutoTransDialog_8_1')"
      />
    </FxCanvas>
    <FxCanvas :x="10" :y="48" :w="448" :h="285" style-name="BoardListUp">
      <FxLabel
        :x="26"
        :y="33"
        style-name="ItemTitle"
        :text="i18n('Market_AddAutoTransDialog_5_1')"
      />
      <FxLabel
        :x="26"
        :y="81"
        style-name="ItemTitle"
        :text="i18n('Market_AddAutoTransDialog_6_1')"
      />
      <FxLabel
        :x="26"
        :y="122.5"
        :w="47"
        style-name="ItemTitle"
        :text="i18n('Market_AddAutoTransDialog_2_1')"
      />
      <FxLabel
        :x="26"
        :y="166"
        :w="47"
        style-name="ItemTitle"
        :text="i18n('Market_AddAutoTransDialog_3_1')"
      />
      <FxLabel
        :x="26"
        :y="203"
        :w="47"
        style-name="ItemTitle"
        :text="i18n('Market_AddAutoTransDialog_1_1')"
      />
      <FxLabel
        :x="26"
        :y="248"
        :w="60"
        style-name="ItemTitle"
        :text="i18n('Market_AddAutoTransDialog_4_1')"
      />
      <FxToggle
        v-model:selected="form.daily"
        :x="333"
        :y="24"
        :w="79"
        :h="30"
        :label="i18n('Market_AddAutoTransDialog_7_1')"
      />

      <FxCanvas :x="92" :y="24" :w="50" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.year"
          :y="4"
          :w="40"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
          :max-chars="4"
        />
      </FxCanvas>
      <FxLabel :x="148" :y="24" :w="16" style-name="ItemTitle" text="-" />
      <FxCanvas :x="172" :y="24" :w="50" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.month"
          :y="4"
          :w="40"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
          :max-chars="2"
        />
      </FxCanvas>
      <FxLabel :x="228" :y="24" :w="16" style-name="ItemTitle" text="-" />
      <FxCanvas :x="252" :y="24" :w="50" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.day"
          :y="4"
          :w="40"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
          :max-chars="2"
        />
      </FxCanvas>

      <FxCanvas :x="92" :y="70" :w="50" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.hour"
          :y="4"
          :w="40"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
          :max-chars="2"
        />
      </FxCanvas>
      <FxLabel :x="148" :y="70" :w="16" style-name="ItemTitle" text=":" />
      <FxCanvas :x="172" :y="70" :w="50" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.minute"
          :y="4"
          :w="40"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
          :max-chars="2"
        />
      </FxCanvas>
      <FxLabel :x="228" :y="70" :w="16" style-name="ItemTitle" text=":" />
      <FxCanvas :x="252" :y="70" :w="50" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.second"
          :y="4"
          :w="40"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
          :max-chars="2"
        />
      </FxCanvas>

      <FxComboBox
        v-model:selected-index="fromIndex"
        :items="cities"
        :x="92"
        :y="119"
        :w="210"
        :h="25"
        @change="changeCity('from', $event)"
      />
      <FxComboBox
        v-model:selected-index="toIndex"
        :items="cities"
        :x="92"
        :y="162.5"
        :w="210"
        :h="25"
        @change="changeCity('to', $event)"
      />
      <FxComboBox
        v-model:selected-index="resIndex"
        :items="resources"
        :x="92"
        :y="199.5"
        :w="210"
        :h="25"
        @change="form.resType = $event"
      />
      <FxCanvas :x="92" :y="243" :w="210" :h="30" style-name="BoardListDown">
        <FxTextInput
          v-model="form.count"
          :y="4"
          :w="210"
          :h="22"
          style-name="EmptyTextInput"
          restrict="0-9"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton
      :x="305"
      :bottom="7"
      :w="80"
      style-name="ButtonGreen"
      :label="i18n('Market_AddAutoTransDialog_9_1')"
      @click="submit"
    />
    <FxButton
      :x="393"
      :bottom="8"
      style-name="Return"
      :fx="{ fontSize: 16 }"
      @click="emit('close')"
    />
  </FxCanvas>
</template>
