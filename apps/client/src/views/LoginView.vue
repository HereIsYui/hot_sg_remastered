<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useGame } from '../game/game';
import { i18n } from '../i18n';
import { showAlert } from '../ui/alert';
import FxButton from '../ui/FxButton.vue';
import FxCanvas from '../ui/FxCanvas.vue';
import FxImage from '../ui/FxImage.vue';
import FxLabel from '../ui/FxLabel.vue';
import FxText from '../ui/FxText.vue';
import FxTextInput from '../ui/FxTextInput.vue';
import FxToggle from '../ui/FxToggle.vue';

/** Login.LoginDialog. */
const game = useGame();
const session = game.session;

const prefs = game.loginPrefs();
const passport = ref(prefs.username);
const password = ref(prefs.password);
const saveUsername = ref(prefs.saveUsername);
const savePassword = ref(prefs.savePassword);
const passportInput = ref<InstanceType<typeof FxTextInput>>();

const registerUrl = import.meta.env.VITE_REGISTER_URL ?? '';
const homeUrl = import.meta.env.VITE_HOME_URL ?? '';
const homeLabel = import.meta.env.VITE_HOME_LABEL ?? '';

function onChangeSavePassword(selected: boolean) {
  if (selected) void showAlert(i18n('Login_LoginDialogSrc_8'));
}

function onLogin() {
  void game.doLogin(passport.value.trim(), password.value, {
    saveUsername: saveUsername.value,
    savePassword: savePassword.value,
  });
}

function open(url: string) {
  if (url) window.open(url, '_blank', 'noopener');
}

onMounted(() => passportInput.value?.focus());
</script>

<template>
  <FxCanvas :w="1000" :h="600" :fx="{ backgroundColor: 0, backgroundAlpha: 1, fontSize: 12 }">
    <FxImage :x="0" :y="0" :w="1000" :h="600" source="images/board_login.jpg" />
    <template v-if="session.queuePeople === 0">
      <FxToggle
        v-model:selected="saveUsername"
        :x="403"
        :y="504"
        :w="97"
        style-name="NormalCheckBox"
        label="          "
      />
      <FxToggle
        v-model:selected="savePassword"
        :x="508"
        :y="504"
        :w="94"
        style-name="NormalCheckBox"
        label="          "
        @change="onChangeSavePassword"
      />
      <FxButton
        :x="453"
        :y="530"
        :w="92.75"
        :h="39"
        style-name="NormalButton"
        :fx="{ fontSize: 12 }"
        :label="i18n('Login_Other_7')"
        @click="onLogin"
      />
      <FxCanvas :x="444" :y="439" :w="140.5" :h="22" style-name="BoardListDown">
        <FxTextInput
          ref="passportInput"
          v-model="passport"
          :x="2"
          :y="2"
          :w="136"
          :h="20"
          style-name="EmptyTextInput"
          :tabindex="1"
          @enter="onLogin"
        />
      </FxCanvas>
      <FxCanvas :x="444" :y="469" :w="140.5" :h="22" style-name="BoardListDown">
        <FxTextInput
          v-model="password"
          :x="2"
          :y="2"
          :w="136"
          :h="20"
          style-name="EmptyTextInput"
          password
          :tabindex="2"
          @enter="onLogin"
        />
      </FxCanvas>
    </template>
    <FxButton
      v-if="registerUrl"
      :x="35"
      :y="489"
      :w="92.75"
      :h="39"
      style-name="NormalButton"
      :fx="{ fontSize: 12 }"
      :label="i18n('Login_Other_9')"
      @click="open(registerUrl)"
    />
    <FxButton
      v-if="homeLabel"
      :x="35"
      :y="529"
      :w="92.75"
      :h="39"
      style-name="NormalButton"
      :fx="{ fontSize: 12 }"
      :label="homeLabel"
      @click="open(homeUrl)"
    />
    <FxLabel
      :x="124"
      :y="178"
      :fx="{ color: 16512139, fontWeight: 'bold', fontSize: 16 }"
      :text="i18n('Login_Other_10')"
    />
    <FxText
      :x="42"
      :y="200"
      :w="235"
      :h="255"
      scroll
      style-name="EmptyTextInput"
      :fx="{ color: 16777215 }"
      :html="session.loginAnnouncement"
    />
    <FxCanvas v-if="session.queuePeople > 0" :x="367" :y="427">
      <FxImage source="images/sequence.jpg" />
      <FxLabel
        :x="136"
        :y="71"
        :w="61"
        :fx="{ color: 16777215, textAlign: 'center', fontWeight: 'bold', fontSize: 14 }"
        :text="session.queuePeople"
      />
    </FxCanvas>
  </FxCanvas>
</template>
