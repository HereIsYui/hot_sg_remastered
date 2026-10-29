<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { parseAllocate } from '../../game/luoyang';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxTextInput from '../../ui/FxTextInput.vue';

/**
 * Union.AssignLuoYangPanel: the 分配洛阳 popup of the union manage dialog — the 盟主 writes a
 * member name and `union/luoyangAllocate [name]` hands the city over (`luoyang.assign_succ`).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const name = ref('');

/** `AssignLuoYangPanel.doAssign`. */
function doAssign(): void {
  if (!name.value.trim()) return;
  game.sendGlobalCommand('union', 'luoyangAllocate', [name.value.trim()]);
}

const unregister = game.addGlobalReceiver('union', (command, data) => {
  if (command === 'luoyangAllocate') {
    gameAlert(parseAllocate(data));
    emit('close');
  }
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 16777215, backgroundAlpha: 0 }">
    <FxCanvas :x="180" :y="110" :w="334" :h="281" style-name="PanelGreyGreen">
      <FxImage :x="43" :y="15" source="images/title.png" />
      <FxLabel
        :x="93"
        :y="20"
        :w="151"
        :h="18"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Union_UnionManagePanel_16_1')"
      />
      <FxCanvas :x="32" :y="70" :w="272" :h="163" style-name="BoardListDown">
        <FxLabel
          :x="13"
          :y="15"
          :w="203"
          :h="29"
          style-name="ItemTitle"
          :fx="{ fontSize: 15, paddingTop: 3, textAlign: 'left' }"
          :text="i18n('Union_UnionManagePanel_assign_1')"
        />
        <FxCanvas :x="40" :y="51" :w="163" :h="33" style-name="BoardListDown">
          <FxTextInput
            v-model="name"
            :w="163"
            :h="33"
            style-name="EmptyTextInput"
            :fx="{ textAlign: 'center', fontSize: 14, paddingTop: 5 }"
          />
        </FxCanvas>
        <FxButton
          :x="83"
          :y="99"
          :w="96"
          :h="38"
          style-name="ButtonYellow"
          :fx="{ fontSize: 15 }"
          :label="i18n('Union_UnionManagePanel_assign_btn')"
          @click="doAssign"
        />
      </FxCanvas>
      <FxButton :x="260" :y="237" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
