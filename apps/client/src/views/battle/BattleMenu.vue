<script setup lang="ts">
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Battle.BattleMenu: the `btnBattleMenu` popup — 战场说明 (`getBattleInfor` / 战况视图),
 * 战场出征 (`getCurrentCityGroundLevel2`), 战场任务 (`getLastMainTask`), 战场成员
 * (`getBattleFieldUsers`), 贡献排行 (`getBattleHonourStat`), 退出战场 (`getQuitResult` →
 * `getQuitResult` reply) and 关闭 hides the menu again.
 */
const emit = defineEmits<{
  close: [];
  campaign: [];
  infor: [];
  task: [];
  member: [];
  honour: [];
  quit: [];
}>();
</script>

<template>
  <FxCanvas
    :w="736"
    :h="556"
    :fx="{ backgroundColor: 0, backgroundAlpha: 0 }"
    @click="emit('close')"
  >
    <FxCanvas :x="596" :y="304" :w="130" :h="252" style-name="PanelGreyGreen" @click.stop>
      <FxCanvas :x="8" :y="4" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :x="0"
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Battle_BattleMenu_1_1')"
        />
      </FxCanvas>
      <FxButton
        :x="12"
        :y="36"
        :w="106"
        :h="28"
        :label="i18n('Battle_BattleMenu_2_1')"
        @click="emit('campaign')"
      />
      <FxButton
        :x="12"
        :y="66"
        :w="106"
        :h="28"
        :label="i18n('Battle_BattleMenu_3_1')"
        @click="emit('infor')"
      />
      <FxButton
        :x="12"
        :y="96"
        :w="106"
        :h="28"
        :label="i18n('Battle_BattleMenu_4_1')"
        @click="emit('task')"
      />
      <FxButton
        :x="12"
        :y="126"
        :w="106"
        :h="28"
        :label="i18n('Battle_BattleMenu_5_1')"
        @click="emit('member')"
      />
      <FxButton
        :x="12"
        :y="156"
        :w="106"
        :h="28"
        :label="i18n('Battle_BattleMenu_8_1')"
        @click="emit('honour')"
      />
      <FxButton
        :x="12"
        :y="186"
        :w="106"
        :h="28"
        style-name="ButtonYellow"
        :label="i18n('Battle_BattleMenu_6_1')"
        @click="emit('quit')"
      />
      <FxButton
        :x="12"
        :y="216"
        :w="106"
        :h="28"
        style-name="Close"
        :label="i18n('Battle_BattleMenu_7_1')"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>
