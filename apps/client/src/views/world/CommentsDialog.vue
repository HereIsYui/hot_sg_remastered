<script setup lang="ts">
import { ref, watch } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Ground/CommentsDialog: edit the note (备注) on a favourite target, then submit
 * `setFavouritesComments [userid, text]`. `userid` is the favourite's own id in the original.
 */
const props = defineProps<{
  id: number;
  nameOfCity: string;
  location: string;
  comments: string;
}>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const text = ref(props.comments);
watch(
  () => props.comments,
  (v) => (text.value = v),
);

const g = (n: number) => i18n(`Ground_CommentsDialog_${n}_1`);

async function onSubmit(): Promise<void> {
  if (text.value.length > 50) {
    await showAlert(g(1) || '备注不能超过50个字');
    return;
  }
  game.sendWorldCommand('setFavouritesComments', [props.id, text.value]);
  emit('close');
}
</script>

<template>
  <FxCanvas :x="218" :y="101" :w="246" :h="280" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="66" :y="15" :w="114" :h="26" style-name="PopupTitle">
      <FxLabel
        :x="0"
        :y="4"
        :w="114"
        :fx="{ textAlign: 'center', color: 15007634 }"
        :text="g(4) || '备注'"
      />
    </FxCanvas>
    <FxCanvas :x="17" :y="53" :w="90" :h="26" style-name="BoardListUp">
      <FxLabel
        :x="7"
        :y="3"
        :w="73"
        :fx="{ color: 16777215, textAlign: 'center' }"
        :text="nameOfCity"
      />
    </FxCanvas>
    <FxCanvas :x="115" :y="53" :w="115" :h="26" style-name="BoardListDown">
      <FxLabel
        :x="10"
        :y="3"
        :w="95"
        :fx="{ color: 4783872, textAlign: 'center', fontWeight: 'bold' }"
        :text="location"
      />
    </FxCanvas>
    <FxCanvas :x="16" :y="85" :w="214" :h="140" style-name="BoardListDown">
      <textarea v-model="text" class="comments" maxlength="50" spellcheck="false" />
    </FxCanvas>
    <FxButton
      style-name="ButtonGreen"
      :right="163"
      :bottom="14"
      :fx="{ fontSize: 16 }"
      :label="g(3) || '确定'"
      @click="onSubmit"
    />
    <FxButton
      style-name="ButtonRed"
      :right="16"
      :bottom="13"
      :fx="{ fontSize: 16 }"
      :label="g(2) || '取消'"
      @click="emit('close')"
    />
  </FxCanvas>
</template>

<style scoped>
.comments {
  position: absolute;
  left: 4px;
  top: 4px;
  width: 206px;
  height: 133px;
  box-sizing: border-box;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: #fff;
  font: inherit;
}
</style>
