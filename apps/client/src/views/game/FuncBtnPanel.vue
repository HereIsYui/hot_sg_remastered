<script setup lang="ts">
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useUserStore } from '../../stores/user';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';

/**
 * Bar.FuncBtnPanel (the 功能按钮区 the openBtn opens): the combined function buttons. This round
 * wires 过关斩将 (firstEnterBattle), 竞技场 (enterAssemble, 爵位上造+), 洛阳归属 (enterLuoyang) and
 * 喜结良缘 (XJLYBtn); 决战天下 and the king-reward button stay inert until their modules are
 * ported (they are part of the original panel layout).
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const user = useUserStore();

/** `FuncBtnPanel.doShowZhanjiangDialog`. */
function zhanjiang(): void {
  game.openZhanjiang();
  emit('close');
}
/** `FuncBtnPanel.openLuoyangPanel`. */
function luoyangBelong(): void {
  game.openLuoyangBelong();
  emit('close');
}
/** `FuncBtnPanel.openArenaPanel` (visible={User.nobilityPos > 1}). */
function arena(): void {
  game.openArena();
  emit('close');
}
/** `FuncBtnPanel.openMarryMainPanel`. */
function marry(): void {
  game.openMarry();
  emit('close');
}
</script>

<template>
  <FxCanvas :x="398" :y="320" :w="308" :h="173" style-name="BoardListUp">
    <!-- 决战天下 / 君主奖励: modules not ported yet — the buttons keep their slots -->
    <FxButton :x="7" :y="20" style-name="JueZhan" />
    <FxButton :x="84" :y="20" style-name="kingRewardBtn" />
    <FxButton
      :x="161"
      :y="23"
      style-name="firstEnterBattle"
      :tip="i18n('Hero_Battle_Dialog_title')"
      @click="zhanjiang"
    />
    <FxButton
      :x="232"
      :y="23"
      style-name="enterLuoyang"
      :tip="i18n('LuoYang_Belong_start_troop')"
      @click="luoyangBelong"
    />
    <FxButton
      v-if="user.nobilityPos > 1"
      :x="13"
      :y="100"
      style-name="enterAssemble"
      :tip="i18n('Arena_Battle_first_title')"
      @click="arena"
    />
    <FxButton
      :x="84"
      :y="100"
      :w="74"
      style-name="XJLYBtn"
      :tip="i18n('Marry_System_title')"
      @click="marry"
    />
  </FxCanvas>
</template>
