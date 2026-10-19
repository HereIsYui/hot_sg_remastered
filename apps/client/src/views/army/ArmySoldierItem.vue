<script setup lang="ts">
import { draftTip, dissolveTip, soldierTip, type ArmySoldierState } from '../../game/soldiers';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/** Army.ArmySoldierItem: a soldier type with its 招募 and 解散 buttons. */
const props = defineProps<{ x: number; y: number; soldier: ArmySoldierState }>();
const emit = defineEmits<{ draft: [ArmySoldierState]; dissolve: [ArmySoldierState] }>();

const city = useCityStore();
</script>

<template>
  <FxCanvas
    :x="x"
    :y="y"
    :w="366"
    :h="90"
    style-name="BoardListUp"
    :fx="{ fontSize: 12, borderStyle: 'outset' }"
  >
    <FxButton
      :x="86"
      :y="11"
      :w="64"
      :h="32"
      style-name="ButtonGreen"
      :fx="{ fontSize: 12, fontWeight: 'normal' }"
      :label="i18n('Army_ArmySoldierItem_1_1')"
      :enabled="soldier.can_draft"
      :tip="{ resource: () => draftTip(props.soldier, city) }"
      @click="emit('draft', soldier)"
    />
    <FxButton
      :x="86"
      :y="46"
      :w="64"
      :h="32"
      style-name="ButtonRed"
      :fx="{ fontSize: 12, fontWeight: 'normal' }"
      :label="i18n('Army_ArmySoldierItem_2_1')"
      :tip="{ resource: () => dissolveTip(props.soldier, city) }"
      @click="emit('dissolve', soldier)"
    />
    <FxCanvas :x="11" :y="11" :w="68" :h="68" style-name="FramePicture">
      <FxImage
        :x="2"
        :y="2"
        :w="64"
        :h="64"
        :source="`images/army_${soldier.sid}_big.png`"
        :tip="soldierTip(soldier)"
      />
    </FxCanvas>
    <FxCanvas :x="157" :y="7" :w="145" :h="30" style-name="BoardListDown">
      <FxLabel :x="8" :y="5" :w="71" :fx="{ color: 13484397 }" :text="soldier.sname" />
      <FxLabel :x="59.5" :y="5" :w="85" :fx="{ textAlign: 'right' }" :text="soldier.count" />
    </FxCanvas>
    <FxCanvas :x="157" :y="41" :w="204" :h="40" style-name="BoardListDown">
      <FxText :x="0" :y="0" :w="204" :h="40" type="TextArea" :text="soldier.description" />
    </FxCanvas>
  </FxCanvas>
</template>
