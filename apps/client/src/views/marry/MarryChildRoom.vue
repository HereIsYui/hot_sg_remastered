<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { parseMarryChild, type Child } from '../../game/marry';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { gameAlert } from '../../ui/alert';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import MarryChangeChildName from './MarryChangeChildName.vue';

/**
 * MarrySystem.MarryChildRoom: the 教馆培养 tab's room view — the three room slots (a locked one
 * opens via `openChildRoom`), the selected child's portrait/name/sex/state/mother, the rename
 * (MarryChangeChildName → changeChildName), and 培养 → `loadChildCulture [hid, room]` hands the
 * child to MarryChildCulture.
 */
const emit = defineEmits<{ culture: [child: Child] }>();

const game = useGame();

const roomCount = ref(1);
const children = ref<Child[]>([]);
const selectedIndex = ref(0);
const showRename = ref(false);

const selected = computed(() => children.value[selectedIndex.value] ?? null);
const childImage = (child: Child | null): string | null =>
  child
    ? `images/child/child_${Number(child.sex) === 0 ? 'girl' : 'boy'}_${Number(child.face ?? 1)}.png`
    : null;

const unregister = game.addGlobalReceiver('MarrySystem', (command, data) => {
  if (command === 'loadMarryChild') {
    const parsed = parseMarryChild(data);
    roomCount.value = parsed.roomCount;
    children.value = parsed.children;
    selectedIndex.value = 0;
  } else if (command === 'changeChildName' || command === 'deleteSpecialChild') {
    const d = Array.isArray(data) ? [...(data as unknown[])] : [];
    if (d.length > 0) gameAlert(String(d.shift() ?? ''));
    game.sendGlobalCommand('MarrySystem', 'loadMarryChild');
  }
});
onUnmounted(unregister);

/** `openChildRoom`: the 200/400 元宝 of room 2/3. */
function openRoom(): void {
  game.sendGlobalCommand('MarrySystem', 'openChildRoom');
}

/** `selectChild(slot)`. */
function selectChild(index: number): void {
  if (index < children.value.length) selectedIndex.value = index;
}

/** `openChangName`. */
function openRename(): void {
  if (selected.value) showRename.value = true;
}

/** `MarryChildRoom` 培养 button → `loadChildCulture [hid, roomindex]`. */
function startCulture(): void {
  if (!selected.value) return;
  game.sendGlobalCommand('MarrySystem', 'loadChildCulture', [
    selected.value.hid,
    Number(selected.value.roomindex),
  ]);
  emit('culture', selected.value);
}

const stateText = (child: Child): string =>
  Number(child.culture) > 0
    ? i18n('Marry_System_culture_finish')
    : i18n('Marry_System_child_state_1');
</script>

<template>
  <FxCanvas :w="625" :h="353" style-name="BoardListDown" :fx="{ fontSize: 12 }">
    <FxCanvas :x="11" :y="7" :w="162" :h="336" style-name="BoardListDown">
      <FxCanvas
        v-for="i in 3"
        :key="i"
        :x="27"
        :y="10 + (i - 1) * 110"
        :w="90"
        :h="95"
        style-name="BoardListDown"
      >
        <FxImage
          :x="2"
          :y="2"
          :w="85"
          :h="90"
          :source="childImage(children[i - 1] ?? null) ?? null"
          hand
          @click="selectChild(i - 1)"
        />
        <FxImage :x="2" :y="2" :w="85" :h="90" source="images/child_pre_frame.png" />
        <FxImage
          v-if="selectedIndex === i - 1"
          :x="2"
          :y="2"
          :w="85"
          :h="90"
          source="images/child_selected_frame.png"
        />
      </FxCanvas>
      <FxButton
        v-if="roomCount < 3"
        :x="27"
        :y="10 + roomCount * 110"
        :w="90"
        :h="30"
        style-name="ButtonYellow"
        :fx="{ fontSize: 12 }"
        :label="i18n('Marry_System_open_room')"
        @click="openRoom"
      />
    </FxCanvas>
    <FxCanvas :x="210" :y="16" :w="90" :h="95" style-name="BoardListDown">
      <FxImage :x="2" :y="2" :w="85" :h="90" :source="childImage(selected)" />
      <FxImage :x="2" :y="2" :w="85" :h="90" source="images/child_pre_frame.png" />
    </FxCanvas>
    <FxText
      :x="317"
      :y="22"
      :w="60"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Hero_HeroDetailDialog_6_1')"
    />
    <FxCanvas :x="385" :y="22" :w="120" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="120"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(selected?.name ?? '')"
      />
    </FxCanvas>
    <FxButton
      :x="511"
      :y="18"
      :w="71"
      :tip="'只有一次修改机会'"
      :label="i18n('NewUnion_Dialog_modify')"
      :enabled="!!selected"
      @click="openRename"
    />
    <FxText
      :x="317"
      :y="58"
      :w="60"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Marry_System_attri_sex')"
    />
    <FxCanvas :x="385" :y="56" :w="120" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="120"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="
          Number(selected?.sex ?? 0) === 0
            ? i18n('Marry_System_madam_type_1')
            : i18n('Marry_System_madam_type_2')
        "
      />
    </FxCanvas>
    <FxText
      :x="317"
      :y="86"
      :w="60"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('World_WorldActionDialogSrc_1')"
    />
    <FxCanvas :x="385" :y="86" :w="80" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="80"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="selected ? stateText(selected) : ''"
      />
    </FxCanvas>
    <FxText
      :x="467"
      :y="86"
      :w="60"
      :h="28"
      style-name="ItemTitle"
      :fx="{ fontSize: 13, paddingTop: 3, textAlign: 'center' }"
      :text="i18n('Marry_System_madam_name')"
    />
    <FxCanvas :x="511" :y="86" :w="100" :h="28" style-name="BoardListDown">
      <FxText
        :x="0"
        :y="0"
        :w="100"
        :h="28"
        style-name="ItemValue"
        :fx="{ textAlign: 'center', paddingTop: 3, fontSize: 13 }"
        :text="String(selected?.motherName ?? '')"
      />
    </FxCanvas>
    <FxButton
      :x="300"
      :y="290"
      :w="100"
      :h="40"
      style-name="ButtonYellow"
      :label="i18n('Marry_System_culture')"
      :enabled="!!selected"
      @click="startCulture"
    />
    <MarryChangeChildName
      v-if="showRename && selected"
      :child="selected"
      @close="showRename = false"
    />
  </FxCanvas>
</template>
