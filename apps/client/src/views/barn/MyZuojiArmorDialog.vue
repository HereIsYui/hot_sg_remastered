<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import { goodsImage, itemPosition } from '../../game/goods';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Barn.MyZuojiArmorDialog: the 马装 the player owns for hole `pos` of a mount
 * (loadZuojiArmor `[pos + 1, armorid]`); clicking one embeds it.
 */
type Row = Record<string, unknown>;
const props = defineProps<{ pos: number; armorid: number }>();
const emit = defineEmits<{ close: []; pick: [row: Row] }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const goods = shallowRef<Row[]>([]);

const unregister = game.addGlobalReceiver('barn', (command, data) => {
  if (command !== 'loadZuojiArmor' || !Array.isArray(data)) return;
  goods.value = Array.isArray(data[0]) ? (data[0] as Row[]) : [];
});

onMounted(() => game.sendGlobalCommand('barn', 'loadZuojiArmor', [props.pos + 1, props.armorid]));
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="4" :y="4" :w="642" :h="362" style-name="PopupDialog">
    <FxButton :right="6" :y="6" style-name="Close" @click="emit('close')" />
    <FxLabel
      :x="12"
      :y="10"
      :w="300"
      style-name="ItemTitle"
      :text="`${i18n('Barn_MyEmbedArmor')} - ${i18n(`Barn_ToolTip_${pos}`)}`"
    />
    <FxCanvas :x="3" :y="36" :w="636" :h="320" style-name="BoardListDown" scroll-y>
      <FxCanvas
        v-for="(g, i) in goods"
        :key="String(g.gid)"
        v-bind="itemPosition(i)"
        :w="78"
        :h="90"
        style-name="BoardListDown"
      >
        <FxImage
          :x="7"
          :y="4"
          :w="64"
          :h="64"
          :source="goodsImage(g)"
          hand
          @click="emit('pick', g)"
        />
        <FxLabel
          :x="0"
          :y="70"
          :w="78"
          :fx="{ textAlign: 'center' }"
          :text="`${str(g.name)}×${int(g.count)}`"
        />
      </FxCanvas>
    </FxCanvas>
  </FxCanvas>
</template>
