<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { useCityStore } from '../../stores/city';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxNumericStepper from '../../ui/FxNumericStepper.vue';

/**
 * Troop/EnemyTroopSetPanel: the 敌军警报过滤 pop-up. For each hostile action (占领=4, 掠夺=3,
 * 侦察=2) the player sets a minimum soldier count below which incoming troops are not alarmed.
 * Loads / saves through `ExternService.getEnemyTroopSet(cid)` / `saveEnemyTroopSet(cid, actions)`,
 * exactly as the AS3 panel's `CallEvent`s do.
 */
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const city = useCityStore();

const zhanling = ref(0); // action 4 占领
const lueduo = ref(0); // action 3 掠夺
const zhencha = ref(0); // action 2 侦察

type FilterRow = { action: number; count: number };

async function load(): Promise<void> {
  const res = await game.callExtern('getEnemyTroopSet', [city.cid]);
  const rows = Array.isArray(res) ? (res as FilterRow[]) : [];
  for (const r of rows) {
    const count = Number(r.count) || 0;
    if (Number(r.action) === 4) zhanling.value = count;
    else if (Number(r.action) === 3) lueduo.value = count;
    else if (Number(r.action) === 2) zhencha.value = count;
  }
}

function submit(): void {
  const actions: FilterRow[] = [
    { action: 4, count: zhanling.value },
    { action: 3, count: lueduo.value },
    { action: 2, count: zhencha.value },
  ];
  void game.callExtern('saveEnemyTroopSet', [city.cid, actions]);
  emit('close');
}

onMounted(load);
</script>

<template>
  <FxCanvas :x="200" :y="100" :w="282" :h="230" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxCanvas :x="66" :y="12" :w="150" :h="24" style-name="PopupTitle">
      <FxLabel
        :x="5"
        :y="3"
        :w="140"
        style-name="PopupDialogTitle"
        :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
        :text="i18n('Enemy_Troop_Set_1') || '警报过滤'"
      />
    </FxCanvas>

    <FxLabel
      :x="30"
      :y="60"
      :w="120"
      :fx="{ color: 0xffffff }"
      :text="i18n('Enemy_Troop_Set_2') || '占领兵力下限'"
    />
    <FxNumericStepper v-model="zhanling" :x="160" :y="56" :minimum="0" :maximum="999999" />

    <FxLabel
      :x="30"
      :y="100"
      :w="120"
      :fx="{ color: 0xffffff }"
      :text="i18n('Enemy_Troop_Set_3') || '掠夺兵力下限'"
    />
    <FxNumericStepper v-model="lueduo" :x="160" :y="96" :minimum="0" :maximum="999999" />

    <FxLabel
      :x="30"
      :y="140"
      :w="120"
      :fx="{ color: 0xffffff }"
      :text="i18n('Enemy_Troop_Set_4') || '侦察兵力下限'"
    />
    <FxNumericStepper v-model="zhencha" :x="160" :y="136" :minimum="0" :maximum="999999" />

    <FxButton
      :x="40"
      :y="186"
      :h="32"
      style-name="ButtonGreen"
      :label="i18n('Enemy_Troop_Set_5') || '确定'"
      @click="submit"
    />
    <FxButton :x="170" :y="186" :h="32" style-name="Close" @click="emit('close')" />
  </FxCanvas>
</template>
