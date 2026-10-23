<script setup lang="ts">
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';

/**
 * Ground.ManeuverDialog: the 演习 (sand-table battle). Its settlement is cfg_js.php::upManeuver,
 * the full battle simulation that belongs to the unported `battle` module, so 演习 is 暂未开放
 * until the battle engine lands.
 */
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <FxCanvas
    :x="0"
    :y="0"
    :w="682"
    :h="492"
    :fx="{ fontSize: 12, backgroundColor: 0, backgroundAlpha: 0.5 }"
  >
    <FxCanvas :x="191" :y="176" :w="300" :h="140" style-name="PanelGreyGreen">
      <FxCanvas :x="76" :y="10" :w="150" :h="27" style-name="PopupTitle">
        <FxLabel
          :x="5"
          :y="4"
          :w="140"
          :fx="{ fontSize: 12, fontWeight: 'normal', textAlign: 'center', color: 15007634 }"
          :text="i18n('Ground_ManeuverDialogSrc_0') || '演习'"
        />
      </FxCanvas>
      <FxLabel
        :x="20"
        :y="60"
        :w="260"
        :fx="{ textAlign: 'center', color: 0xe7d18d }"
        :text="i18n('Basic_not_open') || '暂未开放'"
      />
      <FxButton :x="120" :bottom="16" style-name="Return" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
