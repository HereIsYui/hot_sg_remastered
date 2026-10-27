<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { unionAreaText } from '../../game/union';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

const game = useGame();
const action = 'union_area';
const own = ref('');
const friendly = ref('');
const hostile = ref('');
const other = ref('');
const targetName = ref('');

const unregister = game.addGlobalReceiver(action, (command, data) => {
  const d = Array.isArray(data) ? data : [];
  if (command === 'getSelfUnionArea') own.value = unionAreaText(d[1]);
  else if (command === 'getFriendlyUnionArea') friendly.value = unionAreaText(d[1]);
  else if (command === 'getHostileUnionArea') hostile.value = unionAreaText(d[1]);
  else if (command === 'getOtherUnionAreaByName') other.value = unionAreaText(d[5]);
});
function search(): void {
  if (targetName.value.trim())
    game.sendGlobalCommand(action, 'getOtherUnionAreaByName', [targetName.value.trim()]);
}
game.sendGlobalCommand(action, 'getSelfUnionArea');
game.sendGlobalCommand(action, 'getFriendlyUnionArea');
game.sendGlobalCommand(action, 'getHostileUnionArea');
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :x="10" :y="105" :w="620" :h="300" style-name="BoardListDown">
    <FxLabel :x="15" :y="20" :w="100" text="本盟(黄)" />
    <FxLabel :x="130" :y="20" :w="470" :text="own || '暂无郡城'" />
    <FxLabel :x="15" :y="65" :w="100" text="友盟(绿)" />
    <FxLabel :x="130" :y="65" :w="470" :text="friendly || '暂无'" />
    <FxLabel :x="15" :y="110" :w="100" text="敌盟(红)" />
    <FxLabel :x="130" :y="110" :w="470" :text="hostile || '暂无'" />
    <FxLabel :x="15" :y="155" :w="100" text="其他(蓝)" />
    <FxLabel :x="130" :y="155" :w="470" :text="other || '暂无'" />
    <FxTextInput v-model="targetName" :x="15" :y="220" :w="160" :h="26" :max-chars="8" />
    <FxButton
      :x="190"
      :y="218"
      :w="120"
      style-name="ButtonGreen"
      label="查询联盟"
      @click="search"
    />
  </FxCanvas>
</template>
