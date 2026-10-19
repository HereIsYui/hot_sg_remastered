<script setup lang="ts">
import {
  defenceTip,
  dissolveDefenceTip,
  reinforceTip,
  type WallDefenceState,
} from '../../game/defences';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Wall.WallDefenceItem: a defence type with its 建造 and 拆除 buttons. */
const props = defineProps<{ x: number; y: number; defence: WallDefenceState }>();
const emit = defineEmits<{ reinforce: [WallDefenceState]; dissolve: [WallDefenceState] }>();

const city = useCityStore();
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
    <FxButton
      :x="83"
      :y="9"
      :w="64"
      :h="32"
      style-name="ButtonGreen"
      :fx="{ fontSize: 12, fontWeight: 'normal' }"
      :label="i18n('Wall_WallDefenceItem_1_1')"
      :enabled="defence.can_reinforce"
      :tip="{ resource: () => reinforceTip(props.defence, city) }"
      @click="emit('reinforce', defence)"
    />
    <FxButton
      :x="83"
      :y="43"
      :w="64"
      :h="32"
      style-name="ButtonRed"
      :fx="{ fontSize: 12, fontWeight: 'normal' }"
      :label="i18n('Wall_WallDefenceItem_2_1')"
      :tip="{ resource: () => dissolveDefenceTip(props.defence, city) }"
      @click="emit('dissolve', defence)"
    />
    <FxCanvas :x="11" :y="8" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="`images/defence_${defence.did}_big.png`"
        :tip="defenceTip(defence)"
      />
    </FxCanvas>
    <FxCanvas :x="152" :y="24" :w="206" :h="52" style-name="BoardListDown">
      <FxText
        :x="3"
        :y="1"
        :w="200"
        :h="50"
        type="TextArea"
        :fx="{ color: 16777215 }"
        :text="defence.description"
      />
    </FxCanvas>
    <FxLabel
      :x="153"
      :y="4"
      :w="199"
      :h="20"
      :fx="{ color: 15925146, fontWeight: 'bold' }"
      :text="`${defence.dname}(${defence.count})`"
    />
  </FxCanvas>
</template>
