<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { MAX_FACE_COUNT, validateLordName } from '../game/createRole';
import { useGame } from '../game/game';
import { loadMask, maskHit, type PixelMask } from '../game/hitTest';
import { provinceInfo, provinceOptions } from '../game/province';
import { i18n } from '../i18n';
import { playerFace } from '../stores/user';
import { showAlert } from '../ui/alert';
import FxButton from '../ui/FxButton.vue';
import FxCanvas from '../ui/FxCanvas.vue';
import FxComboBox from '../ui/FxComboBox.vue';
import FxImage from '../ui/FxImage.vue';
import FxLabel from '../ui/FxLabel.vue';
import FxText from '../ui/FxText.vue';
import FxTextInput from '../ui/FxTextInput.vue';
import FxToggle from '../ui/FxToggle.vue';

/** Login.CreateRoleDialog: new role (first time) or a new capital after losing every city. */
const game = useGame();
const session = game.session;
const firstTime = computed(() => session.createRoleFirstTime);

/** Overlays of the 13 provinces on the world map, in the frame's coordinates. */
const PROVINCES = [
  { x: 208.5, y: 159, w: 179, h: 93, source: 'images/silv.png' },
  { x: 361, y: 90, w: 102, h: 105, source: 'images/jizhou.png' },
  { x: 331, y: 190, w: 123, h: 101, source: 'images/yuzhou.png' },
  { x: 374, y: 155, w: 96, h: 92, source: 'images/yunzhou.png' },
  { x: 421, y: 183, w: 118, h: 96, source: 'images/xuzhou.png' },
  { x: 428, y: 121, w: 119, h: 81, source: 'images/qingzhou.png' },
  { x: 254, y: 235, w: 152, h: 172, source: 'images/jingzhou.png' },
  { x: 373, y: 239, w: 204, h: 175, source: 'images/yangzhou.png' },
  { x: 40, y: 220, w: 270, h: 204, source: 'images/yizhou.png' },
  { x: 0, y: 7, w: 260, h: 244, source: 'images/liangzhou.png' },
  { x: 219, y: 45, w: 153, h: 155, source: 'images/bingzhou.png' },
  { x: 360, y: 4, w: 253, h: 118, source: 'images/youzhou.png' },
  { x: 135, y: 363, w: 328, h: 136, source: 'images/jiaozhou.png' },
] as const;
const FRAME_WIDTH = 618;

const sex = ref(game.user.usersex);
const face = ref(firstTime.value ? 0 : game.user.userface);
const name = ref(firstTime.value ? '' : game.user.username);
const province = ref(0);
const hovered = ref(-1);
const masks = shallowRef<(PixelMask | null)[]>([]);
if (firstTime.value) sex.value = 0;

const provinces = computed(() => (session.provinceLoaded ? provinceOptions() : []));
const counts = computed(() => ({
  users: game.global.provinceUsers,
  cities: game.global.provinceCities,
  lands: game.global.provinceLands,
}));
const info = computed(() => provinceInfo(province.value, counts.value));
const hoverTip = computed(() =>
  hovered.value > 0 ? { html: provinceInfo(hovered.value, counts.value) } : null,
);

onMounted(async () => {
  masks.value = await Promise.all(PROVINCES.map((p) => loadMask(p.source)));
});

/** `getOnProvince`: first province whose overlay has a non-empty pixel under the pointer. */
function provinceAt(e: MouseEvent): number {
  const frame = e.currentTarget as HTMLElement;
  const rect = frame.getBoundingClientRect();
  const scale = rect.width / FRAME_WIDTH || 1;
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;
  for (let i = 0; i < PROVINCES.length; i++) {
    const p = PROVINCES[i]!;
    const mask = masks.value[i];
    if (!mask || x < p.x || y < p.y || x >= p.x + p.w || y >= p.y + p.h) continue;
    if (maskHit(mask, ((x - p.x) * mask.width) / p.w, ((y - p.y) * mask.height) / p.h))
      return i + 1;
  }
  return -1;
}

function onMapMove(e: MouseEvent) {
  hovered.value = provinceAt(e);
}

function onMapClick(e: MouseEvent) {
  const i = provinceAt(e);
  if (i > 0 && provinces.value.length) province.value = i;
}

function changeFace(step: number) {
  face.value = (face.value + step + MAX_FACE_COUNT) % MAX_FACE_COUNT;
}

function onSubmit() {
  const lord = name.value.trim();
  const error = validateLordName(lord);
  if (error) {
    void showAlert(i18n(error));
    return;
  }
  const cityName = i18n('Login_CreateRoleDialog_16');
  if (firstTime.value) game.createRole(lord, cityName, province.value, sex.value, face.value);
  else game.createCity(cityName, province.value);
}
</script>

<template>
  <FxCanvas :w="1000" :h="600" style-name="PopupDialog" :fx="{ fontSize: 12 }">
    <FxImage :x="374" :y="12" source="images/title.png" />
    <FxLabel
      :x="418.5"
      :y="16"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('Login_CreateRoleDialog_1_1')"
    />
    <FxCanvas :x="333" :y="63" :w="618" :h="500" style-name="FramePicture" hand :tip="hoverTip">
      <div class="map-hit" @mousemove="onMapMove" @mouseleave="hovered = -1" @click="onMapClick">
        <FxImage :x="5" :y="5" :w="608" :h="490" source="images/sanguo_worldmap.png" />
        <template v-for="(p, i) in PROVINCES" :key="p.source">
          <FxImage
            v-show="hovered === i + 1"
            :x="p.x"
            :y="p.y"
            :w="p.w"
            :h="p.h"
            :source="p.source"
          />
        </template>
      </div>
    </FxCanvas>
    <FxCanvas :x="50" :y="63" :w="262" :h="500" style-name="BoardListUp">
      <FxCanvas :x="75.5" :y="12" :w="120" :h="28" background-image="images/select_headimg.png">
        <FxLabel
          :x="1.5"
          :y="4"
          :w="118.5"
          :h="20"
          style-name="PopupDialogTitle"
          :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
          :text="i18n('Login_CreateRoleDialog_14_1')"
        />
      </FxCanvas>
      <FxCanvas :x="15" :y="258" :w="81" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="10"
          :y="4"
          :w="61"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Login_CreateRoleDialog_4_1')"
        />
      </FxCanvas>
      <FxCanvas :x="14.5" :y="52" :w="233" :h="160" style-name="BoardListDown">
        <FxCanvas :x="72.5" :y="13" :w="87" :h="100" style-name="FramePicture">
          <FxImage :x="10" :y="10" :w="66" :h="82" :source="playerFace(sex, face)" />
        </FxCanvas>
        <template v-if="firstTime">
          <FxButton
            :x="34.5"
            :y="47.5"
            :w="21"
            :h="30"
            style-name="ButtonPrev"
            @click="changeFace(-1)"
          />
          <FxButton
            :x="175"
            :y="47.5"
            :w="21"
            :h="30"
            style-name="ButtonNext"
            @click="changeFace(1)"
          />
          <FxToggle
            type="RadioButton"
            :x="75"
            :y="121"
            :w="47"
            :h="24"
            :selected="sex === 1"
            :label="i18n('Login_CreateRoleDialog_8')"
            @change="sex = 1"
          />
          <FxToggle
            type="RadioButton"
            :x="131.5"
            :y="121"
            :w="47"
            :h="24"
            :selected="sex === 0"
            :label="i18n('Login_CreateRoleDialog_9')"
            @change="sex = 0"
          />
        </template>
      </FxCanvas>
      <FxButton
        :x="67.5"
        :y="449.3"
        :w="115"
        :h="42"
        :fx="{ fontSize: 16, textAlign: 'center' }"
        :label="i18n('Login_CreateRoleDialog_10_1')"
        @click="onSubmit"
      />
      <FxCanvas :x="15" :y="291" :w="237" :h="120" style-name="BoardListDown">
        <FxText :x="10" :y="10" :w="225" :h="110" style-name="EmptyTextInput" :html="info" />
      </FxCanvas>
      <FxCanvas :x="15" :y="223" :w="81" :h="26" style-name="BoardListUp">
        <FxLabel
          :x="10"
          :y="4"
          :w="61"
          style-name="ItemTitle"
          :fx="{ textAlign: 'center' }"
          :text="i18n('Login_CreateRoleDialog_2_1')"
        />
      </FxCanvas>
      <FxCanvas :x="103" :y="223" :w="144" :h="26" style-name="BoardListDown">
        <FxTextInput
          v-model="name"
          :x="3"
          :y="2"
          :w="140"
          :h="23"
          style-name="EmptyTextInput"
          :tabindex="1"
          :editable="firstTime"
          @enter="onSubmit"
        />
      </FxCanvas>
      <FxToggle
        v-if="firstTime"
        type="RadioButton"
        :x="27.5"
        :y="417.3"
        :w="213"
        :h="24"
        :selected="true"
        :label="i18n('Login_CreateRoleDialog_15_1')"
      />
      <FxComboBox
        v-model:selected-index="province"
        :items="provinces"
        :x="104"
        :y="259"
        :w="144"
        :row-count="7"
      />
    </FxCanvas>
  </FxCanvas>
</template>

<style scoped>
.map-hit {
  position: absolute;
  inset: 0;
}
</style>
