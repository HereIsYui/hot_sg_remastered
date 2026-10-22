<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useGame } from '../../game/game';
import {
  HUA_SHI_FEN_GID,
  WU_CAI_HUA_SHI_FEN_GID,
  huaShiFenUse,
  parseTypeGoods,
  type TypeGoodsItem,
} from '../../game/goods';
import { i18n, substitute } from '../../i18n';
import { useCityStore } from '../../stores/city';
import { showAlert } from '../../ui/alert';
import type { TipValue } from '../../ui/tooltip';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * Goods.UseHuaShiFenDialog (type 26, 化石粉 / 五彩化石粉): clears a pearl out of a hole from the
 * smithy. Picks 化石粉 (gid 201) or 五彩化石粉 (gid 12156), and a use way — one copy (`useType`
 * 0) or the full count needed to keep the pearl (`useType` 1). `onUseGoods` sends useTypeGoods
 * `[26, gid, cid, sid, pos, useType, count]` and the reply carries the updated armor + pearls.
 */
const props = defineProps<{
  /** The smithy's `[sid, pos]` the pearl sits in, and the full count to keep it. */
  sid: number;
  pos: number;
  count: number;
}>();
const emit = defineEmits<{ done: [reply: unknown[], useType: number]; close: [] }>();

const game = useGame();
const city = useCityStore();
const TYPE = 26;
/** The two 化石粉 kinds (`UseHuaShiFenDialog.onGetGoods`). */
const HUASHIFEN = HUA_SHI_FEN_GID;
const WUCAI = WU_CAI_HUA_SHI_FEN_GID;

const items = shallowRef<TypeGoodsItem[]>([]);
/** `_goodType`: 0 = 化石粉, 1 = 五彩化石粉. */
const goodType = ref(0);
/** `_useType`: 0 = one copy, 1 = the full count (keep the pearl). */
const useType = ref(0);
const visible = ref(false);

const item1 = computed(() => items.value.find((i) => i.gid === HUASHIFEN) ?? null);
const item2 = computed(() => items.value.find((i) => i.gid === WUCAI) ?? null);
const tip = (item: TypeGoodsItem | null): TipValue =>
  item ? { goods: { title: item.name, text: item.description } } : null;

/** `loadData`. */
function loadData() {
  game.sendGlobalCommand('user', 'getUserTypeGoods', [TYPE]);
}

/** `onGetGoods`. */
function onGetGoods(d: unknown[]) {
  items.value = parseTypeGoods(d.shift());
  visible.value = true;
}

/** `onUse` → `onUseGoods`: confirm, then send useTypeGoods. */
async function onUse() {
  const use = huaShiFenUse(goodType.value, useType.value, props.count);
  if (use.gid === HUASHIFEN ? !item1.value : !item2.value) return;
  const prompt = substitute(i18n(use.promptKey), use.amount);
  if ((await showAlert(prompt, '', ['yes', 'no'])) !== 'yes') return;
  game.sendGlobalCommand('user', 'useTypeGoods', [
    TYPE,
    use.gid,
    city.cid,
    props.sid,
    props.pos,
    useType.value,
    use.count,
  ]);
}

const unregister = game.addGlobalReceiver('user', (command, data) => {
  const d = Array.isArray(data) ? [...(data as unknown[])] : [];
  if (command === 'getUserTypeGoods') onGetGoods(d);
  else if (command === 'useTypeGoods') {
    emit('done', d, useType.value);
    emit('close');
  }
});
onMounted(loadData);
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" class="huashifen" :fx="{ fontSize: 12 }">
    <FxCanvas
      v-if="visible"
      class="popup"
      :x="(682 - 398) / 2"
      :y="(492 - 221) / 2 - 24"
      :w="398"
      :h="221"
      style-name="PopupDialog"
    >
      <FxCanvas :x="(398 - 114) / 2" :y="12" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="3"
          :w="114"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Goods_UseGoodsDialog_1_1')"
        />
      </FxCanvas>

      <!-- 化石粉 -->
      <FxCanvas :x="44" :y="46" :w="80" :h="76" style-name="BoardListDown">
        <FxCanvas :x="6" :y="4" :w="68" :h="68" style-name="FramePicture">
          <FxImage :x="3" :y="2" :w="64" :h="64" :source="item1?.imageName" :tip="tip(item1)" />
          <FxLabel
            :x="0"
            :y="49"
            :w="68"
            :h="19"
            class="count"
            :fx="{ color: 16777215, textAlign: 'right' }"
            :text="item1?.count ?? '0'"
          />
        </FxCanvas>
      </FxCanvas>
      <FxToggle
        type="RadioButton"
        :x="44"
        :y="128"
        :w="90"
        :fx="{ color: 16777215, textAlign: 'center' }"
        :label="item1?.name"
        :selected="goodType === 0"
        @change="goodType = 0"
      />

      <!-- 五彩化石粉 -->
      <FxCanvas :x="148" :y="46" :w="80" :h="76" style-name="BoardListDown">
        <FxCanvas :x="6" :y="4" :w="68" :h="68" style-name="FramePicture">
          <FxImage :x="3" :y="2" :w="64" :h="64" :source="item2?.imageName" :tip="tip(item2)" />
          <FxLabel
            :x="0"
            :y="49"
            :w="68"
            :h="19"
            class="count"
            :fx="{ color: 16777215, textAlign: 'right' }"
            :text="item2?.count ?? '0'"
          />
        </FxCanvas>
      </FxCanvas>
      <FxToggle
        type="RadioButton"
        :x="148"
        :y="128"
        :w="90"
        :fx="{ color: 16777215, textAlign: 'center' }"
        :label="item2?.name"
        :selected="goodType === 1"
        @change="goodType = 1"
      />

      <!-- use ways -->
      <FxToggle
        type="RadioButton"
        :x="253"
        :y="63"
        :w="113"
        :label="i18n('HuaShiFen_Use_Way_1')"
        :selected="useType === 0"
        @change="useType = 0"
      />
      <FxToggle
        type="RadioButton"
        :x="253"
        :y="112"
        :w="113"
        :label="i18n('HuaShiFen_Use_Way_2')"
        :selected="useType === 1"
        @change="useType = 1"
      />

      <FxButton
        style-name="ButtonYellow"
        :x="136"
        :y="175"
        :w="74"
        :fx="{ fontSize: 13 }"
        :label="i18n('BlackSmith_chaxie_use')"
        @click="onUse"
      />
      <FxButton
        style-name="ButtonGreen"
        :right="282"
        :bottom="10"
        :w="71"
        :fx="{ fontSize: 16 }"
        :label="i18n('Goods_UseGoodsDialog_2_1')"
        @click="game.showShop()"
      />
      <FxButton
        style-name="Close"
        :right="32"
        :bottom="10"
        :fx="{ fontSize: 16 }"
        @click="emit('close')"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.huashifen {
  pointer-events: none !important;
}

.huashifen > :deep(*) {
  pointer-events: auto;
}

.count {
  text-shadow:
    0 0 3px #000,
    0 0 3px #000,
    0 0 3px #000;
}
</style>
