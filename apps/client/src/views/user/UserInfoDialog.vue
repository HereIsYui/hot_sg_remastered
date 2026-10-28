<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useGame } from '../../game/game';
import { i18n } from '../../i18n';
import { parseCities, useUserStore } from '../../stores/user';
import FxButton from '../../ui/FxButton.vue';
import FxCanvas from '../../ui/FxCanvas.vue';
import FxDataGrid from '../../ui/FxDataGrid.vue';
import FxImage from '../../ui/FxImage.vue';
import FxLabel from '../../ui/FxLabel.vue';
import ChangeDesignationDialog from './ChangeDesignationDialog.vue';
import ChangeFlagDialog from '../goods/ChangeFlagDialog.vue';
import ChangeUserNameDialog from '../goods/ChangeUserNameDialog.vue';

/**
 * UserInfo/UserInfoDialog (682x492): the 君主信息 panel (InfoPanel's portrait click). The left
 * board shows the lord's ranks; the right board lists the cities (clicking switches). 更改 opens
 * the ChangeNameDialog (名帖), 旗号's 更改 the ChangeFlagDialog (旌旗), 称号 the
 * ChangeDesignationDialog (`loadDetailInfo` refreshes 总人口/将领数/状态, AS3 1059-1061). The
 * 免战 更改 of ChangeStateDialog is not ported yet.
 */
const game = useGame();
const user = useUserStore();

const allPeople = ref(0);
const allHeroes = ref(0);
/** `USER_STATE` (UserInfoDialog.as:1000): 正常 / 新手 / 免战. */
const stateNames = [
  i18n('UserInfo_UserInfoDialogSrc_2'),
  i18n('UserInfo_UserInfoDialogSrc_3'),
  i18n('UserInfo_UserInfoDialogSrc_4'),
];
const userState = computed(() =>
  user.ustate < 3 ? (stateNames[user.ustate] ?? '') : (stateNames[2] ?? ''),
);

const popup = ref<'name' | 'flag' | 'designation' | null>(null);

const cityColumns = [
  { header: i18n('UserInfo_UserInfoDialog_16_1') || '城池', field: 'name' as const, width: 140 },
  {
    header: i18n('UserInfo_UserInfoDialog_17_1') || '坐标',
    field: 'position' as const,
    width: 100,
  },
  { header: i18n('UserInfo_UserInfoDialog_18_1') || '人口', field: 'people' as const, width: 100 },
];

/** `UserInfoDialog.onItemClick`: switch to the clicked city. */
function onCityClick(row: Record<string, unknown>): void {
  const cid = parseInt(String(row.cid ?? 0), 10) || 0;
  if (cid > 0) game.switchCity(cid);
}

/** `UserInfoDialog.loadDetailInfo` → `onLoadData` (AS3 1309-1333): the reply of
 *  `user/loadUserDetailInfo` is `[总人口, 将领数, 状态, (免战结束), cities]`; the cities go
 *  through `BloodWar.parseCities`. */
const unregister = game.addGlobalReceiver('user', (command, data) => {
  if (command !== 'loadUserDetailInfo' || !Array.isArray(data)) return;
  const arr = [...data];
  allPeople.value = parseInt(String(arr.shift() ?? 0), 10) || 0;
  allHeroes.value = parseInt(String(arr.shift() ?? 0), 10) || 0;
  arr.shift(); // the account state; the dialog reads User.ustate for the button visibility
  arr.shift(); // the 免战 endtime of ChangeStateDialog (not ported)
  user.cities = parseCities(arr.shift());
});
onUnmounted(unregister);
</script>

<template>
  <FxCanvas :w="682" :h="492" style-name="PanelGreyGreen" :fx="{ fontSize: 12 }">
    <FxImage :x="215" :y="25" source="images/title.png" />
    <FxLabel
      :x="264"
      :y="29"
      :w="151"
      :h="18"
      :fx="{ textAlign: 'center', color: 15192461, fontWeight: 'normal' }"
      :text="i18n('UserInfo_UserInfoDialog_1_1')"
    />
    <FxCanvas :x="23" :y="79" :w="640" :h="350" style-name="BoardListUp">
      <FxCanvas :x="10" :y="10" :w="260" :h="330" style-name="BoardListUp">
        <FxCanvas :x="10" :y="7" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_2_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="7" :w="105" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="100"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="user.username"
          />
        </FxCanvas>
        <FxButton
          :x="193"
          :y="5"
          :w="60"
          :h="30"
          style-name="ButtonGreen"
          :fx="{ fontWeight: 'bold' }"
          :label="i18n('UserInfo_UserInfoDialog_3_1')"
          @click="popup = 'name'"
        />
        <FxButton
          :x="193"
          :y="34"
          :w="60"
          :h="30"
          style-name="ButtonYellow"
          :fx="{ fontWeight: 'bold' }"
          :label="i18n('UserInfo_UserInfoDialog_19_1')"
          @click="popup = 'designation'"
        />
        <FxCanvas :x="10" :y="36" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_5_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="36" :w="105" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="97"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="user.officepos"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="65" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_6_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="65" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="user.nobility"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="94" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_4_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="94" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="user.unionname"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="123" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_7_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="123" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="String(user.rank)"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="152" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_8_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="152" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="String(user.prestige)"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="181" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_9_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="181" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="String(user.cities.length)"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="210" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_10_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="210" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="String(allPeople)"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="239" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_11_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="239" :w="162" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="4"
            :y="3"
            :w="150"
            style-name="ItemValue"
            :fx="{ color: 16777215 }"
            :text="String(allHeroes)"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="268" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_12_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="268" :w="76" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="10"
            :y="3"
            :w="56"
            style-name="ItemValue"
            :fx="{ color: 65292, fontWeight: 'bold', textAlign: 'center' }"
            :text="userState"
          />
        </FxCanvas>
        <FxCanvas :x="10" :y="298" :w="70" :h="26" style-name="BoardListUp">
          <FxLabel
            :x="3"
            :y="3"
            :w="64"
            style-name="ItemTitle"
            :fx="{ textAlign: 'center' }"
            :text="i18n('UserInfo_UserInfoDialog_14_1')"
          />
        </FxCanvas>
        <FxCanvas :x="88" :y="298" :w="76" :h="26" style-name="BoardListDown">
          <FxLabel
            :x="10"
            :y="3"
            :w="56"
            style-name="ItemValue"
            :fx="{ color: 65292, fontWeight: 'bold', textAlign: 'center' }"
            :text="user.flagchar"
          />
        </FxCanvas>
        <FxButton
          :x="172"
          :y="297"
          :w="60"
          :h="30"
          style-name="ButtonGreen"
          :fx="{ fontWeight: 'bold' }"
          :label="i18n('UserInfo_UserInfoDialog_15_1')"
          @click="popup = 'flag'"
        />
      </FxCanvas>
      <FxCanvas :x="278" :y="10" :w="352" :h="330" style-name="BoardListUp">
        <FxDataGrid
          :x="3"
          :y="3"
          :w="346"
          :h="324"
          :columns="cityColumns"
          :rows="user.cities"
          :row-height="24"
          selectable
          @item-click="onCityClick"
        />
      </FxCanvas>
    </FxCanvas>
    <FxButton
      :x="597"
      :bottom="10"
      style-name="Close"
      :fx="{ fontSize: 16 }"
      @click="game.closeDialog()"
    />
    <ChangeUserNameDialog
      v-if="popup === 'name'"
      @change="(name) => game.sendGlobalCommand('user', 'changeUserName', [name])"
      @close="popup = null"
    />
    <ChangeFlagDialog
      v-if="popup === 'flag'"
      @change="(flag) => game.sendGlobalCommand('user', 'changeUserFlagchar', [flag])"
      @close="popup = null"
    />
    <ChangeDesignationDialog
      v-if="popup === 'designation'"
      @submit="(id, prev) => game.sendGlobalCommand('user', 'changeUserDesignation', [id, prev])"
      @close="popup = null"
    />
  </FxCanvas>
</template>
