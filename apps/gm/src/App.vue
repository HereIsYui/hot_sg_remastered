<script setup lang="ts">
import { onMounted, ref } from 'vue';
import * as api from './gm-api';

type Row = Record<string, unknown>;
type Tab = 'players' | 'cities' | 'heroes' | 'goods' | 'announce' | 'world';

const TABS: { key: Tab; label: string }[] = [
  { key: 'players', label: '玩家' },
  { key: 'cities', label: '城池' },
  { key: 'heroes', label: '将领' },
  { key: 'goods', label: '宝物' },
  { key: 'announce', label: '公告' },
  { key: 'world', label: '状态' },
];

const serverStatus = ref('检测中…');
const tab = ref<Tab>('players');
const info = ref('');
const error = ref('');
const busy = ref(false);

function notify(message: string): void {
  info.value = message;
  error.value = '';
}

async function run(action: () => Promise<string | void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const message = await action();
    if (typeof message === 'string') notify(message);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  if (!api.tokenConfigured) {
    error.value = '未配置 VITE_GM_TOKEN，请求将被服务端拒绝（见 apps/gm/.env.local）';
  }
  try {
    const res = await fetch('/api/health');
    serverStatus.value = res.ok ? '服务端正常' : `服务端异常（${res.status}）`;
  } catch {
    serverStatus.value = '无法连接服务端';
  }
});

// ---------------------------------------------------------------- players

const playerBy = ref<'name' | 'passport'>('name');
const playerName = ref('');
const players = ref<api.PlayerRow[]>([]);
const player = ref<api.PlayerRow | null>(null);
const form = ref({ money: '', gift: '', prestige: '', nobility: '', officepos: '' });
const forbidDelemail = ref(false);
const forbidden = ref<api.PlayerRow[] | null>(null);

function pickPlayer(row: api.PlayerRow): void {
  player.value = row;
  form.value = {
    money: String(row.money ?? ''),
    gift: String(row.gift ?? ''),
    prestige: String(row.prestige ?? ''),
    nobility: String(row.nobility ?? ''),
    officepos: String(row.officepos ?? ''),
  };
}

function savePlayer(): void {
  const target = player.value;
  if (!target) return;
  void run(async () => {
    player.value = await api.updatePlayer({
      uid: target.uid,
      money: num(form.value.money),
      gift: num(form.value.gift),
      prestige: num(form.value.prestige),
      nobility: num(form.value.nobility),
      officepos: num(form.value.officepos),
    });
    return `uid ${target.uid} 已更新`;
  });
}

function forbidSelected(): void {
  const target = player.value;
  if (!target) return;
  void run(async () => {
    player.value = await api.forbidUser(target.uid, forbidDelemail.value);
    return `${target.name} 已封禁`;
  });
}

function unforbidSelected(): void {
  const target = player.value;
  if (!target) return;
  void run(async () => {
    player.value = await api.unforbidUser(target.uid);
    return `${target.name} 已解封`;
  });
}

function loadForbidden(): void {
  void run(async () => {
    forbidden.value = await api.forbidList();
    return `封禁列表 ${forbidden.value.length} 条`;
  });
}

function searchPlayers(): void {
  void run(async () => {
    players.value = await api.searchPlayers(playerBy.value, playerName.value);
    return `找到 ${players.value.length} 名玩家`;
  });
}

// ---------------------------------------------------------------- cities

const cityName = ref('');
const cityX = ref('');
const cityY = ref('');
const cities = ref<api.CityRow[]>([]);
const cleanUid = ref('');
const cleanConfirm = ref(false);

function searchCity(): void {
  void run(async () => {
    cities.value = await api.searchCities({
      name: cityName.value.trim() === '' ? undefined : cityName.value,
      x: num(cityX.value),
      y: num(cityY.value),
    });
    return `找到 ${cities.value.length} 座城池`;
  });
}

function maxLevel(row: api.CityRow): void {
  void run(async () => {
    const result = await api.cityMaxLevel(row.cid);
    return `城池 ${row.cid}：建筑 ${result.buildings}、科技 ${result.technics} 已满级`;
  });
}

function cleanup(): void {
  void run(async () => {
    const uid = Math.trunc(Number(cleanUid.value));
    if (!Number.isInteger(uid) || uid <= 1000) throw new Error('uid 必须是大于 1000 的整数');
    if (!cleanConfirm.value) throw new Error('请先勾选确认');
    await api.cleanupUser(uid);
    cleanConfirm.value = false;
    return `uid ${uid} 及其数据已删除`;
  });
}

// ---------------------------------------------------------------- heroes

const heroName = ref('');
const heroes = ref<api.HeroRow[]>([]);
const npcHeroes = ref<Row[]>([]);
const hero = ref<api.HeroRow | null>(null);
const heroForm = ref({ level: '', exp: '', command: '', affairs: '', bravery: '', wisdom: '' });
const placeCid = ref('');

function pickHero(row: api.HeroRow): void {
  hero.value = row;
  heroForm.value = {
    level: String(row.level),
    exp: String(row.exp),
    command: '',
    affairs: '',
    bravery: '',
    wisdom: '',
  };
}

function saveHero(): void {
  const target = hero.value;
  if (!target) return;
  void run(async () => {
    await api.updateHero({
      hid: target.hid,
      level: num(heroForm.value.level),
      exp: num(heroForm.value.exp),
      command: num(heroForm.value.command),
      affairs: num(heroForm.value.affairs),
      bravery: num(heroForm.value.bravery),
      wisdom: num(heroForm.value.wisdom),
    });
    return `将领 ${target.hid} 已更新`;
  });
}

function place(): void {
  const target = hero.value;
  if (!target) return;
  void run(async () => {
    await api.placeHero(target.hid, Math.trunc(Number(placeCid.value)));
    return `将领 ${target.hid} 已放入城池 ${placeCid.value}`;
  });
}

// ---------------------------------------------------------------- goods

const goodsKind = ref<'goods' | 'armor'>('goods');
const goodsName = ref('');
const goods = ref<api.GoodsRow[]>([]);
const grant = ref({ uid: '', gid: '', count: '1' });
const removeForm = ref({ uid: '', gid: '', count: '' });

function searchGoods(): void {
  void run(async () => {
    goods.value = await api.searchGoods(goodsKind.value, goodsName.value);
    return `找到 ${goods.value.length} 条`;
  });
}

function searchHeroes(): void {
  void run(async () => {
    const result = await api.searchHeroes(heroName.value);
    heroes.value = result.heroes;
    npcHeroes.value = result.npcHeroes;
    return `玩家将领 ${heroes.value.length} 名、名将定义 ${npcHeroes.value.length} 条`;
  });
}

function doGrant(): void {
  void run(async () => {
    await api.grantGoods(
      Math.trunc(Number(grant.value.uid)),
      Math.trunc(Number(grant.value.gid)),
      Math.trunc(Number(grant.value.count)),
    );
    return `已发放 ${grant.value.gid} x${grant.value.count}`;
  });
}

function doRemove(): void {
  void run(async () => {
    const count =
      removeForm.value.count.trim() === '' ? undefined : Math.trunc(Number(removeForm.value.count));
    await api.removeGoods(
      Math.trunc(Number(removeForm.value.uid)),
      Math.trunc(Number(removeForm.value.gid)),
      count,
    );
    return `已删除 ${removeForm.value.gid}${count === undefined ? '（全部）' : ` x${count}`}`;
  });
}

// ---------------------------------------------------------------- announce

const informForm = ref({ msg: '', color: '14972979', seconds: '3600' });
const speakForm = ref({ msg: '', from: '管理员' });

function doInform(): void {
  void run(async () => {
    await api.sendInform({
      msg: informForm.value.msg,
      color: num(informForm.value.color),
      seconds: num(informForm.value.seconds),
    });
    return '系统公告已写入 sys_inform';
  });
}

function doSpeak(): void {
  void run(async () => {
    const sent = await api.speak(speakForm.value.msg, speakForm.value.from);
    return `GM 喊话已推送给 ${sent} 个在线连接`;
  });
}

// ---------------------------------------------------------------- world

const worldStatus = ref<api.WorldStatus | null>(null);

function refreshWilds(): void {
  void run(async () => {
    const result = await api.refreshWilds();
    return `野地刷新完成，重生 ${result.touched} 块`;
  });
}

function loadStatus(): void {
  void run(async () => {
    worldStatus.value = await api.worldStatus();
    return `在线 ${worldStatus.value.online} 人`;
  });
}

// ---------------------------------------------------------------- helpers

function num(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function hide(event: Event): void {
  (event.target as HTMLImageElement).style.visibility = 'hidden';
}

function stateLabel(state: unknown): string {
  return ['', '新手', '免战', '未建城', '重建城', '锁定'][Number(state)] ?? String(state ?? '');
}
</script>

<template>
  <div class="layout">
    <aside>
      <h1>热血三国 GM</h1>
      <p class="server" :data-ok="serverStatus === '服务端正常'">{{ serverStatus }}</p>
      <nav>
        <button
          v-for="t in TABS"
          :key="t.key"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>
    </aside>
    <main>
      <p v-if="info" class="info">{{ info }}</p>
      <p v-if="error" class="error">{{ error }}</p>

      <!-- 玩家 -->
      <section v-show="tab === 'players'">
        <h2>玩家</h2>
        <form class="row" @submit.prevent="searchPlayers">
          <select v-model="playerBy">
            <option value="name">君主名</option>
            <option value="passport">账号</option>
          </select>
          <input v-model="playerName" placeholder="模糊搜索" />
          <button type="submit" :disabled="busy">搜索</button>
          <button type="button" @click="loadForbidden">封禁列表</button>
        </form>
        <table v-if="players.length">
          <thead>
            <tr>
              <th>uid</th>
              <th>君主</th>
              <th>账号</th>
              <th>元宝</th>
              <th>礼金</th>
              <th>声望</th>
              <th>爵位</th>
              <th>官职</th>
              <th>联盟</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in players"
              :key="row.uid"
              :class="{ picked: player?.uid === row.uid }"
              @click="pickPlayer(row)"
            >
              <td>{{ row.uid }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.passport }}</td>
              <td>{{ row.money }}</td>
              <td>{{ row.gift }}</td>
              <td>{{ row.prestige }}</td>
              <td>{{ row.nobility_name ?? row.nobility }}</td>
              <td>{{ row.officepos_name ?? row.officepos }}</td>
              <td>{{ row.union_name ?? '' }}</td>
              <td>{{ stateLabel(row.state) }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="player">
          <h3>修改 {{ player.name }}（uid {{ player.uid }}）</h3>
          <form class="row" @submit.prevent="savePlayer">
            <label>元宝 <input v-model="form.money" /></label>
            <label>礼金 <input v-model="form.gift" /></label>
            <label>声望 <input v-model="form.prestige" /></label>
            <label>爵位 <input v-model="form.nobility" /></label>
            <label>官职 <input v-model="form.officepos" /></label>
            <button type="submit" :disabled="busy">保存</button>
          </form>
          <form class="row" @submit.prevent>
            <label><input v-model="forbidDelemail" type="checkbox" /> 同时删除其发出的邮件</label>
            <button type="button" class="danger" :disabled="busy" @click="forbidSelected">
              封禁
            </button>
            <button type="button" :disabled="busy" @click="unforbidSelected">解封</button>
          </form>
        </template>
        <template v-if="forbidden">
          <h3>封禁列表</h3>
          <table v-if="forbidden.length">
            <thead>
              <tr>
                <th>uid</th>
                <th>账号</th>
                <th>君主</th>
                <th>开始</th>
                <th>结束</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in forbidden" :key="row.uid">
                <td>{{ row.uid }}</td>
                <td>{{ row.passport }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.forbistart }}</td>
                <td>{{ row.forbiend }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else>当前没有封禁中的账号。</p>
        </template>
      </section>

      <!-- 城池 -->
      <section v-show="tab === 'cities'">
        <h2>城池</h2>
        <form class="row" @submit.prevent="searchCity">
          <input v-model="cityName" placeholder="城池名（可空）" />
          <input v-model="cityX" class="short" placeholder="x" />
          <input v-model="cityY" class="short" placeholder="y" />
          <button type="submit" :disabled="busy">搜索</button>
        </form>
        <table v-if="cities.length">
          <thead>
            <tr>
              <th>cid</th>
              <th>坐标</th>
              <th>名称</th>
              <th>类型</th>
              <th>玩家</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in cities" :key="row.cid">
              <td>{{ row.cid }}</td>
              <td>{{ row.x }},{{ row.y }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.type }}</td>
              <td>{{ row.username ?? row.uid }}</td>
              <td><button :disabled="busy" @click="maxLevel(row)">一键满级</button></td>
            </tr>
          </tbody>
        </table>
        <h3>数据清理（危险）</h3>
        <form class="row" @submit.prevent="cleanup">
          <input v-model="cleanUid" class="short" placeholder="uid" />
          <label><input v-model="cleanConfirm" type="checkbox" /> 确认删除该玩家全部数据</label>
          <button type="submit" class="danger" :disabled="busy">删除</button>
        </form>
      </section>

      <!-- 将领 -->
      <section v-show="tab === 'heroes'">
        <h2>将领</h2>
        <form class="row" @submit.prevent="searchHeroes">
          <input v-model="heroName" placeholder="将领名（玩家将领 + 名将）" />
          <button type="submit" :disabled="busy">搜索</button>
        </form>
        <table v-if="heroes.length">
          <thead>
            <tr>
              <th>hid</th>
              <th>名字</th>
              <th>等级</th>
              <th>经验</th>
              <th>归属</th>
              <th>城池</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in heroes"
              :key="row.hid"
              :class="{ picked: hero?.hid === row.hid }"
              @click="pickHero(row)"
            >
              <td>{{ row.hid }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.level }}</td>
              <td>{{ row.exp }}</td>
              <td>{{ row.username ?? row.uid }}</td>
              <td>{{ row.cid }}</td>
              <td>{{ row.state }}</td>
            </tr>
          </tbody>
        </table>
        <table v-if="npcHeroes.length">
          <thead>
            <tr>
              <th>npcid</th>
              <th>名将</th>
              <th>字</th>
              <th>统</th>
              <th>内</th>
              <th>勇</th>
              <th>谋</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in npcHeroes" :key="String(row.npcid)">
              <td>{{ row.npcid }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.zi }}</td>
              <td>{{ row.affairs_base }}</td>
              <td>{{ row.bravery_base }}</td>
              <td>{{ row.wisdom_base }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="hero">
          <h3>修改 {{ hero.name }}（hid {{ hero.hid }}）</h3>
          <form class="row" @submit.prevent="saveHero">
            <label>等级 <input v-model="heroForm.level" class="short" /></label>
            <label>经验 <input v-model="heroForm.exp" /></label>
            <label>统率 <input v-model="heroForm.command" class="short" /></label>
            <label>内政 <input v-model="heroForm.affairs" class="short" /></label>
            <label>勇武 <input v-model="heroForm.bravery" class="short" /></label>
            <label>智谋 <input v-model="heroForm.wisdom" class="short" /></label>
            <button type="submit" :disabled="busy">保存</button>
          </form>
          <form class="row" @submit.prevent="place">
            <label>放入城池 cid <input v-model="placeCid" /></label>
            <button type="submit" :disabled="busy">放入</button>
          </form>
        </template>
      </section>

      <!-- 宝物 -->
      <section v-show="tab === 'goods'">
        <h2>宝物与装备</h2>
        <form class="row" @submit.prevent="searchGoods">
          <select v-model="goodsKind">
            <option value="goods">宝物（cfg_goods）</option>
            <option value="armor">装备（cfg_armor）</option>
          </select>
          <input v-model="goodsName" placeholder="名称模糊搜索" />
          <button type="submit" :disabled="busy">搜索</button>
        </form>
        <table v-if="goods.length">
          <thead>
            <tr>
              <th>图片</th>
              <th>{{ goodsKind === 'armor' ? 'id' : 'gid' }}</th>
              <th>名称</th>
              <th>等级</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in goods" :key="String(row.gid ?? row.id)">
              <td>
                <img
                  class="preview"
                  :src="api.ASSET_BASE + row.imageName"
                  :alt="row.imageName"
                  @error="hide"
                />
              </td>
              <td>{{ row.gid ?? row.id }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.level ?? '' }}</td>
              <td class="desc">{{ row.description }}</td>
            </tr>
          </tbody>
        </table>
        <h3>发放 / 删除</h3>
        <form class="row" @submit.prevent="doGrant">
          <label>uid <input v-model="grant.uid" class="short" /></label>
          <label>gid <input v-model="grant.gid" class="short" /></label>
          <label>数量 <input v-model="grant.count" class="short" /></label>
          <button type="submit" :disabled="busy">发放</button>
        </form>
        <form class="row" @submit.prevent="doRemove">
          <label>uid <input v-model="removeForm.uid" class="short" /></label>
          <label>gid <input v-model="removeForm.gid" class="short" /></label>
          <label>数量（空=全部） <input v-model="removeForm.count" class="short" /></label>
          <button type="submit" class="danger" :disabled="busy">删除</button>
        </form>
      </section>

      <!-- 公告 -->
      <section v-show="tab === 'announce'">
        <h2>公告</h2>
        <h3>系统公告（sys_inform 滚动条）</h3>
        <form class="row" @submit.prevent="doInform">
          <input v-model="informForm.msg" placeholder="公告内容" class="wide" />
          <label>颜色 <input v-model="informForm.color" class="short" /></label>
          <label>持续秒 <input v-model="informForm.seconds" class="short" /></label>
          <button type="submit" :disabled="busy">发布</button>
        </form>
        <h3>GM 喊话（推送 proc 14）</h3>
        <form class="row" @submit.prevent="doSpeak">
          <input v-model="speakForm.msg" placeholder="喊话内容" class="wide" />
          <label>署名 <input v-model="speakForm.from" class="short" /></label>
          <button type="submit" :disabled="busy">发送</button>
        </form>
      </section>

      <!-- 状态 -->
      <section v-show="tab === 'world'">
        <h2>世界</h2>
        <form class="row" @submit.prevent>
          <button type="button" :disabled="busy" @click="refreshWilds">手动刷新野地</button>
          <button type="button" :disabled="busy" @click="loadStatus">刷新服务器状态</button>
        </form>
        <template v-if="worldStatus">
          <p>
            在线玩家：{{ worldStatus.online }}（uid：{{
              worldStatus.onlineUids.join(', ') || '无'
            }}）
          </p>
          <table>
            <thead>
              <tr>
                <th>表</th>
                <th>行数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(v, k) in worldStatus.tables[0]" :key="k">
                <td>{{ k }}</td>
                <td>{{ v }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  font-family: system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  color: #222;
}
aside {
  width: 160px;
  flex: none;
  background: #2c3340;
  color: #cdd3de;
  padding: 16px 12px;
  box-sizing: border-box;
}
aside h1 {
  font-size: 16px;
  margin: 0 0 4px;
  color: #fff;
}
.server {
  font-size: 12px;
  margin: 0 0 16px;
}
.server[data-ok='true'] {
  color: #7ec97e;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
nav button {
  text-align: left;
  padding: 8px 10px;
  background: transparent;
  color: inherit;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
nav button.active {
  background: #4a90d9;
  color: #fff;
}
main {
  flex: 1;
  padding: 16px 24px 40px;
  box-sizing: border-box;
  min-width: 0;
}
h2 {
  margin: 8px 0 12px;
  font-size: 18px;
}
h3 {
  margin: 20px 0 8px;
  font-size: 14px;
  color: #555;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.row label {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
input,
select {
  padding: 4px 6px;
  border: 1px solid #bbb;
  border-radius: 3px;
}
input {
  width: 140px;
}
input.short {
  width: 56px;
}
input.wide {
  width: 320px;
}
button {
  padding: 5px 12px;
  border: 1px solid #888;
  border-radius: 3px;
  background: #f4f5f7;
  cursor: pointer;
}
button:hover {
  background: #e8eaee;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button.danger {
  border-color: #b33;
  color: #b33;
}
table {
  border-collapse: collapse;
  margin: 8px 0 16px;
  max-width: 100%;
}
th,
td {
  border: 1px solid #d8dbe0;
  padding: 4px 10px;
  text-align: left;
  white-space: nowrap;
}
th {
  background: #f0f2f5;
}
tbody tr.picked,
tbody tr:hover {
  background: #eef4fc;
  cursor: pointer;
}
td.desc {
  white-space: normal;
  max-width: 420px;
}
img.preview {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.info {
  color: #2a7f2a;
  background: #eef8ee;
  border: 1px solid #bfe0bf;
  border-radius: 4px;
  padding: 6px 10px;
}
.error {
  color: #a11;
  background: #fdeeee;
  border: 1px solid #eec2c2;
  border-radius: 4px;
  padding: 6px 10px;
}
</style>
