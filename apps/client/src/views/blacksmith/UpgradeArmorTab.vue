<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { armorInfo, dealWithOtherInfoOfArmor, parseArmor, type Armor } from '../../game/armor';
import { GOODS_UPGRADE_PROTECT, upgradeMaterials } from '../../game/blacksmith';
import { useGame } from '../../game/game';
import { armorImage } from '../../game/goods';
import { i18n } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * The 装备升级 tab of BSCommandDialog and the 坐骑升级 tab of BarnCommandDialog: a 名将 / 冰封 /
 * 神武 piece (or 骠骑 / 灭寂驹 mount) plus its two materials becomes the next set
 * (doUpgradeArmor); the 升级保护符 keeps it on failure.
 */
type Row = Record<string, unknown>;
const props = defineProps<{
  action: 'blacksmith' | 'barn';
  armor: Armor | null;
  /** gid -> goods row with `count`, from loadEquitmentInfor / loadBarnGoods. */
  goods: Record<number, Row>;
  desc: string;
}>();
const emit = defineEmits<{ pick: []; replace: [a: Armor | null]; refresh: [] }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

const useProtect = ref(false);

/** `setUpgradeArmorMater`: a piece outside the three sets is not a target. */
const materials = computed(() =>
  props.armor ? upgradeMaterials(int(props.armor.row.tieid)) : null,
);
const target = computed(() => (materials.value ? props.armor : null));

const unregister = game.addGlobalReceiver(props.action, (command, data) => {
  if (command !== 'doUpgradeArmor' || !Array.isArray(data)) return;
  const d = [...(data as unknown[])];
  const msg = str(d.shift());
  d.shift(); // left-over goods; the refresh below reloads them
  const isProtected = !!d.shift();
  const isSucc = !!int(d.shift());
  void showAlert(msg);
  if (isSucc) {
    const reply = Array.isArray(d[0]) ? [...(d[0] as unknown[])] : [];
    const rows = reply.shift();
    dealWithOtherInfoOfArmor(armorInfo, reply);
    const row = Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
    emit('replace', row ? parseArmor(row) : null);
  } else if (!isProtected) {
    emit('replace', null);
  }
  emit('refresh');
});
onUnmounted(unregister);

/** `doUpgradeArmor` */
function upgrade() {
  const a = target.value;
  const m = materials.value;
  if (!a || !m) {
    void showAlert(i18n('BlackSmith_upgradeArmor_not_upgrade'));
    return;
  }
  if (int(props.goods[m[0]]?.count) === 0 || int(props.goods[m[1]]?.count) === 0) {
    void showAlert(i18n('BlackSmith_material_not_enough'));
    return;
  }
  game.sendGlobalCommand(props.action, 'doUpgradeArmor', [a.sid, useProtect.value]);
}
</script>

<template>
  <FxCanvas :x="4" :y="55" :w="642" :h="310" style-name="BoardListUp">
    <FxImage
      v-if="target"
      :x="186"
      :y="30"
      :w="64"
      :h="64"
      :source="armorImage(target.row)"
      hand
      @click="emit('pick')"
    />
    <FxButton v-else :x="186" :y="30" :w="64" :h="64" label="+" @click="emit('pick')" />
    <FxLabel
      v-if="target"
      :x="118"
      :y="98"
      :w="200"
      :fx="{ textAlign: 'center' }"
      :text="str(target.row.name)"
    />
    <template v-if="materials">
      <FxLabel
        v-for="(gid, i) in materials"
        :key="gid"
        :x="40 + i * 200"
        :y="130"
        :w="180"
        :fx="{ textAlign: 'center' }"
        :text="`${str(goods[gid]?.name)} ×${int(goods[gid]?.count)}`"
      />
    </template>
    <FxButton
      :x="40"
      :y="200"
      :w="170"
      style-name="ButtonYellow"
      :selected="useProtect"
      :label="`${str(goods[GOODS_UPGRADE_PROTECT]?.name)}(${int(goods[GOODS_UPGRADE_PROTECT]?.count)})`"
      @click="useProtect = !useProtect"
    />
    <FxButton
      :x="240"
      :y="200"
      :w="90"
      style-name="ButtonYellow"
      :label="i18n('BlackSmith_upgradeArmorBtn')"
      @click="upgrade()"
    />
    <FxText :x="440" :y="20" :w="190" :h="270" :html="desc" />
  </FxCanvas>
</template>
