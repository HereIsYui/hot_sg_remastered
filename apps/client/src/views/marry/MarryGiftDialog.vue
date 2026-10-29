<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import FxText from '../../ui/FxText.vue';
import FxToggle from '../../ui/FxToggle.vue';

/**
 * MarrySystem.MarryGiftDialog: the 聘礼 picker of the propose — 666 元宝 / 333 元宝 / 222 铜钱 /
 * 空手 (`Marry_king_price_1..4`), sent as `proposeMarry [hid, giftType]`; a drawn guard NPC
 * replays through MarryHeroBattlePanel.
 */
const props = defineProps<{ hid: number }>();
const emit = defineEmits<{ close: [] }>();

const game = useGame();
const giftType = ref(1);

const GIFTS = [
  {
    type: 1,
    image: 'images/gift_high.png',
    label: 'Marry_king_gift_high',
    price: 'Marry_king_price_1',
  },
  {
    type: 2,
    image: 'images/gift_medium.png',
    label: 'Marry_king_gift_medium',
    price: 'Marry_king_price_2',
  },
  {
    type: 3,
    image: 'images/gift_low.png',
    label: 'Marry_king_gift_low',
    price: 'Marry_king_price_3',
  },
  {
    type: 4,
    image: 'images/gift_none.png',
    label: 'Marry_king_gift_none',
    price: 'Marry_king_price_4',
  },
];

/** `onSubmit`. */
function onSubmit(): void {
  game.sendGlobalCommand('MarrySystem', 'proposeMarry', [props.hid, giftType.value]);
}
</script>

<template>
  <FxCanvas :w="625" :h="353" style-name="BoardListDown">
    <FxCanvas :x="80" :y="10" :w="500" :h="333" style-name="PopupDialog">
      <FxButton
        :right="77"
        :bottom="10"
        :w="96"
        :h="28"
        style-name="ButtonGreen"
        :fx="{ fontSize: 16 }"
        :label="i18n('Marry_king_propose_next_time')"
        @click="emit('close')"
      />
      <FxButton
        :right="320"
        :bottom="10"
        :w="96"
        :h="28"
        style-name="ButtonGreen"
        :fx="{ fontSize: 16 }"
        :label="i18n('Marry_king_propose_title')"
        @click="onSubmit"
      />
      <FxCanvas :y="12" :x="193" :w="114" :h="26" style-name="PopupTitle">
        <FxLabel
          :y="3"
          :w="102"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Marry_king_propose_title')"
        />
      </FxCanvas>
      <FxCanvas :x="49" :y="60" :w="391" :h="36" style-name="BoardListDown">
        <FxText :x="6" :y="7" :w="375" :h="23" :html="i18n('Marry_king_propose_guid')" />
      </FxCanvas>
      <template v-for="(gift, i) in GIFTS" :key="gift.type">
        <FxCanvas :x="30 + i * 120" :y="125" :w="80" :h="90" style-name="BoardListDown">
          <FxCanvas :x="6" :y="4" :w="68" :h="68" style-name="FramePicture">
            <FxImage :x="3" :y="2" :w="64" :h="64" :source="gift.image" />
          </FxCanvas>
          <FxLabel
            :x="3"
            :y="70"
            :w="75"
            :h="20"
            :fx="{ color: 16777215, textAlign: 'center' }"
            :text="i18n(gift.label)"
          />
        </FxCanvas>
        <FxToggle
          type="CheckBox"
          :x="25 + i * 120"
          :y="223"
          :w="95"
          :label="i18n(gift.price)"
          :selected="giftType === gift.type"
          @change="(v) => v && (giftType = gift.type)"
        />
      </template>
    </FxCanvas>
  </FxCanvas>
</template>
