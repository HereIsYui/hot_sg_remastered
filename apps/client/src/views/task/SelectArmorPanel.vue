<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import { useGame } from '../../game/game';
import { useUserStore } from '../../stores/user';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import UserArmorItem from '../armor/UserArmorItem.vue';
const props = defineProps<{
  tid: number;
  type: number;
  armorId: number;
  value: number;
  count: number;
}>();
const emit = defineEmits<{ close: [] }>();
const game = useGame();
const user = useUserStore();
const armors = shallowRef<Armor[]>([]);
const selected = ref<number[]>([]);
const t = (n: number) => i18n(`Task_SelectArmor_1_${n}`);
const unregister = game.addGlobalReceiver('task', (cmd, data) => {
  if (cmd !== 'getArmorsByPartOrType' || !Array.isArray(data)) return;
  armors.value = (Array.isArray(data[0]) ? (data[0] as Record<string, unknown>[]) : []).map(
    parseArmor,
  );
  dealWithOtherInfoOfArmor(armorInfo, data.slice(1));
  selected.value = [];
});
onMounted(() =>
  game.sendGlobalCommand('task', 'getArmorsByPartOrType', [
    user.cid,
    props.type,
    props.armorId,
    props.value,
    props.count,
  ]),
);
onUnmounted(unregister);
function toggle(sid: number) {
  selected.value = selected.value.includes(sid)
    ? selected.value.filter((v) => v !== sid)
    : [...selected.value, sid];
}
function submit() {
  if (selected.value.length !== props.count) {
    void showAlert(i18n('select_2_armor').replace('%d', String(props.count)));
    return;
  }
  game.sendGlobalCommand('task', 'getReward', [
    props.tid,
    ...armors.value.filter((armor) => selected.value.includes(armor.sid)).map((armor) => armor.sid),
  ]);
  emit('close');
}
</script>
<template>
  <FxCanvas :w="682" :h="492" :fx="{ backgroundColor: 0, backgroundAlpha: 0.5 }">
    <FxCanvas :x="45" :y="40" :w="592" :h="412" style-name="PopupDialog">
      <FxLabel :x="20" :y="15" :w="552" :text="t(1)" :fx="{ textAlign: 'center' }" />
      <FxCanvas :x="20" :y="50" :w="552" :h="290" scroll-y style-name="BoardListUp">
        <UserArmorItem
          v-for="(armor, index) in armors"
          :key="armor.sid"
          :armor="armor"
          :x="8 + (index % 6) * 88"
          :y="8 + Math.floor(index / 6) * 100"
          :selected="selected.includes(armor.sid)"
          @pick="toggle(armor.sid)"
        />
      </FxCanvas>
      <FxLabel :x="20" :bottom="20" :w="300" :text="`${selected.length} / ${count}`" />
      <FxButton :x="370" :bottom="20" :label="t(4)" @click="submit" />
      <FxButton :right="20" :bottom="20" style-name="Close" @click="emit('close')" />
    </FxCanvas>
  </FxCanvas>
</template>
