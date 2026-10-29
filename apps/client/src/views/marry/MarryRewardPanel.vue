<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { parseMarryInfo } from '../../game/marry';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * MarrySystem.MarryRewardPanel: the replay of a 历练 encounter's gains — `loadMarryInfo` again
 * lists the met girlfriends as the reward rows of the panel (`mRewardArr`), dismissed with the
 * quit button.
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const girlfriends = ref<Record<string, unknown>[]>([]);

game.sendGlobalCommand('MarrySystem', 'loadMarryInfo');
const unregister = game.addGlobalReceiver('MarrySystem', (command, data) => {
  if (command === 'loadMarryInfo') {
    girlfriends.value = parseMarryInfo(data).girlfriends as unknown as Record<string, unknown>[];
  }
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="730" :h="418" :fx="{ backgroundColor: 0, backgroundAlpha: 0.3 }">
    <FxCanvas :x="200" :y="121" :w="372" :h="287" style-name="PanelGreyGreen">
      <FxCanvas :x="16" :y="19" :w="333" :h="57" />
      <FxCanvas :x="16" :y="90" :w="338" :h="151" style-name="BoardListUp">
        <FxText
          :y="3"
          :w="338"
          :h="38"
          :fx="{ textAlign: 'center', fontSize: 15, color: 16777215, paddingTop: 5 }"
          :text="i18n('Hero_Battle_Dialog_battle_reward_text')"
        />
        <FxCanvas :x="16" :y="45" :w="304" :h="100" style-name="BoardListUp">
          <div class="rewards">
            <FxCanvas
              v-for="(girl, i) in girlfriends"
              :key="i"
              :w="70"
              :h="95"
              :fx="{ color: 16777215 }"
            >
              <FxCanvas :x="2" :y="4" :w="68" :h="90" style-name="FramePicture">
                <FxImage
                  :x="1"
                  :y="1"
                  :w="64"
                  :h="64"
                  :source="`images/hero/hero_${Number(girl.sex) === 0 ? 'girl_' : 'boy_'}${Number(girl.face ?? 0)}.jpg`"
                  :tip="String(girl.name ?? '')"
                />
                <FxLabel
                  :x="3"
                  :y="67"
                  :w="65"
                  :h="23"
                  :fx="{ textAlign: 'center' }"
                  :text="String(girl.name ?? '')"
                />
              </FxCanvas>
            </FxCanvas>
          </div>
        </FxCanvas>
      </FxCanvas>
      <FxButton :x="136" :y="237" :w="100" :h="40" style-name="quitBattle" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.rewards {
  display: flex;
  gap: 10px;
  padding: 5px;
}
</style>
