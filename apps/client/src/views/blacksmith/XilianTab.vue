<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { Armor } from '../../game/armor';
import { XILIAN_GOODS, parseBestQuality, xilianBlockReason } from '../../game/blacksmith';
import { useGame } from '../../game/game';
import { armorImage } from '../../game/goods';
import { i18n, substitute } from '../../i18n';
import { showAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';

/**
 * BSCommandDialog's 洗练 tab: pick a stone (祝融之符 adds a 极品 attribute, 清洗符 wipes it,
 * 洗练符 re-rolls it), then use it on the chosen piece (doXilian).
 */
const props = defineProps<{ armor: Armor | null }>();
const emit = defineEmits<{ pick: []; best: [quality: string] }>();

const game = useGame();
const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

const index = ref(0);
const stone = shallowRef<Record<string, unknown> | null>(null);
/** The piece's 极品 attribute, refreshed by each doXilian reply. */
const best = ref('');

const bestText = computed(() => parseBestQuality(best.value));
watch(
  () => props.armor,
  (a) => (best.value = str(a?.row.best_quality)),
  { immediate: true },
);

const unregister = game.addGlobalReceiver('blacksmith', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'loadXilianGoods') {
    stone.value = (d[0] as Record<string, unknown> | undefined) ?? null;
  } else if (command === 'doXilian' && d.length > 0) {
    const quality = str(d.shift());
    const spent = int(d.shift());
    emit('best', quality);
    best.value = quality;
    if (stone.value) {
      stone.value = { ...stone.value, count: Math.max(0, int(stone.value.count) - spent) };
    }
    void showAlert(quality ? parseBestQuality(quality) : i18n('xilian_not_exist'));
  }
});

function choose(i: number) {
  index.value = i;
  game.sendGlobalCommand('blacksmith', 'loadXilianGoods', [i]);
}

onMounted(() => choose(0));
onUnmounted(unregister);

/** `doXilian` / `useZhurong` / `useQingxi` / `useXilian`: guard, confirm, send. */
async function use() {
  const a = props.armor;
  if (!a) {
    void showAlert(i18n('BlackSmith_NoArmor'));
    return;
  }
  const block = xilianBlockReason(index.value, int(stone.value?.count), best.value);
  if (block) {
    void showAlert(block);
    return;
  }
  const tip =
    index.value === 0
      ? i18n('xilian_zhurong_tip')
      : index.value === 1
        ? i18n('xilian_qingxi_tip')
        : substitute(i18n('xilian_xilian_tip'), XILIAN_GOODS[2]!.count(int(a.row.type)));
  if ((await showAlert(tip, '', ['yes', 'no'])) !== 'yes') return;
  game.sendGlobalCommand('blacksmith', 'doXilian', [
    index.value,
    XILIAN_GOODS[index.value]!.gid,
    a.sid,
  ]);
}
</script>

<template>
  <FxCanvas :x="4" :y="55" :w="642" :h="310" style-name="BoardListUp">
    <FxCanvas :x="10" :y="10" :w="150" :h="140" style-name="BoardListDown">
      <FxButton
        v-for="(g, i) in XILIAN_GOODS"
        :key="g.gid"
        :x="10"
        :y="10 + i * 42"
        :w="130"
        style-name="ButtonYellow"
        :selected="index === i"
        :label="i18n(g.label)"
        @click="choose(i)"
      />
    </FxCanvas>
    <FxLabel :x="10" :y="160" :w="150" :text="`${str(stone?.name)}: ${int(stone?.count)}`" />

    <FxLabel :x="200" :y="10" :w="160" :text="i18n('BlackSmith_ArmorSelect')" />
    <FxImage
      v-if="armor"
      :x="230"
      :y="40"
      :w="64"
      :h="64"
      :source="armorImage(armor.row)"
      @click="emit('pick')"
    />
    <FxButton v-else :x="230" :y="40" :w="64" :h="64" label="+" @click="emit('pick')" />
    <FxLabel :x="180" :y="115" :w="250" :fx="{ color: 16762880 }" :text="bestText" />
    <FxButton
      :x="230"
      :y="210"
      style-name="ButtonYellow"
      :label="i18n('xilian_button')"
      @click="use()"
    />
    <FxText :x="440" :y="20" :w="190" :h="270" :html="i18n('BlackSmith_xilian_guid')" />
  </FxCanvas>
</template>
