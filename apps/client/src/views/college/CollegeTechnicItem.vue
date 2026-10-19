<script setup lang="ts">
import { computed } from 'vue';
import { timeLeftText } from '../../core/clock';
import { technicTip, type TechnicState } from '../../game/technics';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** College.CollegeTechnicItem: one technic with its research button or countdown. */
const props = defineProps<{ x: number; y: number; technic: TechnicState; now: number }>();
const emit = defineEmits<{ start: [tid: number]; stop: [tid: number] }>();

const city = useCityStore();
const s = (n: number) => i18n(`College_CollegeTechnicItemSrc_${n}`);

const upgrading = computed(() => props.technic.state === 1);
const ownResearch = computed(() => upgrading.value && props.technic.cid === city.cid);
const title = computed(() => {
  const t = props.technic;
  return `${t.tname}${s(2)}${t.level}${s(3)}${s(4)}${t.sharelevel}${s(5)}`;
});
const stateText = computed(() =>
  upgrading.value
    ? s(1) + timeLeftText(Math.max(0, props.technic.state_endtime - props.now), i18n)
    : '',
);

const tip = () => technicTip(props.technic, city);

async function stop() {
  const t = props.technic;
  const answer = await showAlert(`${s(6)}${t.tname}${s(7)}${t.level + 1})?`, '', ['yes', 'no']);
  if (answer === 'yes') emit('stop', t.tid);
}
</script>

<template>
  <FxCanvas
    :x="x"
    :y="y"
    :w="366"
    :h="84"
    style-name="BoardListUp"
    :fx="{ fontSize: 12, borderStyle: 'outset' }"
  >
    <FxCanvas :x="11" :y="8" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="`images/tech_${technic.tid}.png`"
        :tip="technic.levelDescription"
      />
    </FxCanvas>
    <FxButton
      v-if="!upgrading"
      :x="83"
      :y="25"
      :w="64"
      :h="32"
      :fx="{ fontSize: 12, fontWeight: 'normal' }"
      :label="i18n('College_CollegeTechnicItem_1_1')"
      :enabled="technic.can_upgrade"
      :tip="{ resource: () => tip() ?? i18n('College_CollegeTechnicItem_2_1') }"
      @click="emit('start', technic.tid)"
    />
    <template v-else>
      <!-- 加速 needs the item dialogs (UseGoodsDialog) of the shop. -->
      <FxButton
        :x="83"
        :y="9"
        :w="64"
        :h="32"
        style-name="ButtonGreen"
        :fx="{ fontSize: 12, fontWeight: 'normal' }"
        :label="i18n('College_CollegeTechnicItem_3_1')"
        :enabled="false"
        :tip="{ resource: tip }"
      />
      <FxButton
        :x="83"
        :y="43"
        :w="64"
        :h="32"
        :fx="{ fontSize: 12, fontWeight: 'normal' }"
        :label="i18n('College_CollegeTechnicItem_4_1')"
        :enabled="ownResearch"
        @click="stop"
      />
    </template>
    <FxLabel :x="153" :y="4" :w="199" :text="title" :tip="technic.levelDescription" />
    <FxCanvas :x="152" :y="24" :w="206" :h="52" style-name="BoardListDown">
      <FxText
        :left="2"
        :right="0"
        :y="0"
        :h="36"
        :fx="{ borderThickness: 0, color: 16777215 }"
        type="TextArea"
        :text="technic.description"
      />
      <FxLabel :x="4" :y="30" :text="stateText" />
    </FxCanvas>
  </FxCanvas>
</template>
