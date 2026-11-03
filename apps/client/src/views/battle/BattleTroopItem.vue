<script setup lang="ts">
import { computed } from 'vue';
import { parseSoldierPairs } from '../../game/battlefield';
import type { BattleTroop } from '../../game/battlefield';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { showMenu } from '../../ui/menu';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';

/**
 * Battle.BattleTroopItem: one own battlefield troop in the map's heroPanel — the hero portrait
 * (`images/herox/hero_<sex>_<face>.jpg`) with the soldiers tip (`showTroopTip`); the click opens
 * the `onClickMenu` popup menu: 选择军队 / 军队详情 / 调遣援军 / (跨服 only 战术) / 撤出战场.
 */
const props = defineProps<{
  troop: BattleTroop;
  selected: boolean;
}>();
const emit = defineEmits<{
  select: [troop: BattleTroop];
  detail: [troop: BattleTroop];
  callArmy: [troop: BattleTroop];
  quit: [troop: BattleTroop];
}>();

const game = useGame();

const image = computed(
  () =>
    `images/herox/hero_${Number(props.troop.sex) === 0 ? 'girl' : 'boy'}_${Number(
      props.troop.face ?? 0,
    )}.jpg`,
);
const soldiers = computed(() => parseSoldierPairs(props.troop.soldiers));
const tip = computed(
  () =>
    `${props.troop.heroname} ${props.troop.level}${i18n('Battle_BattleTroopItem_6')} ` +
    soldiers.value.map((p) => `${game.global.soldierNames[p.sid] ?? ''}${p.count}`).join(' '),
);

/** `onClickMenu` + `menuHandler` (the local-field menu has no 战术 entry). */
async function onMenu(event: MouseEvent): Promise<void> {
  emit('select', props.troop);
  const data = await showMenu(
    [
      { label: i18n('Battle_BattleTroopItem_2_1'), data: 'selectArmy' },
      { label: i18n('Battle_BattleTroopItem_3_1'), data: 'viewArmy' },
      { label: i18n('Battle_BattleTroopItem_4_1'), data: 'getEnhance' },
      { label: i18n('Battle_BattleTroopItem_5_1'), data: 'exit' },
    ],
    event.clientX + window.scrollX,
    event.clientY + window.scrollY,
  );
  if (data === 'viewArmy') emit('detail', props.troop);
  else if (data === 'getEnhance') emit('callArmy', props.troop);
  else if (data === 'exit') emit('quit', props.troop);
}
</script>

<template>
  <FxCanvas :w="41" :h="40" hand @click="onMenu">
    <FxCanvas
      :x="4"
      :y="0"
      :w="33"
      :h="40"
      :style-name="props.selected ? 'BattleFramePicture' : ''"
    >
      <FxImage :x="2" :y="2" :w="29" :h="36" :source="image" :tip="tip" />
    </FxCanvas>
  </FxCanvas>
</template>
