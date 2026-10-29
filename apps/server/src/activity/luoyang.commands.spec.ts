import { describe, expect, it } from 'vitest';
import { LuoyangCommands } from './luoyang.commands';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';

const lang = new LangService({
  luoyang: {
    out_of_time: '时机尚未成熟！据斥候来报，每周三20：00将开启占领洛阳！',
    not_open: '洛阳攻击尚未开放，请耐心等待',
    has_close: '洛阳攻击已经关闭',
    nobility_is_too_low: '爵位未达到官大夫，不能占领洛阳，请提升您的爵位',
    troop_exists: '军队已存在，请增加援军',
    not_in_city: '只能查看所在城池军队',
    cannot_go_city: '本城池不能通往目标城池',
    not_your_troop: '你不能操作别人的军队',
    time_not_pass: '军队整顿休息，还需片刻才能出发',
    NPC_troops_exists: '还有NPC军队未消灭！',
    in_luoyang_battle: '军队战斗中不能召回',
    start_troop_succ: '出征成功！',
    not_in_union: '攻占洛阳必须先拥有联盟',
    troop_not_exists: '所选择军队不存在',
    troop_self_battle: '自己军队已在战斗中',
    troop_other_battle: '对方军队已在战斗中',
    union_is_same: '同盟军队不能战斗',
    can_not_use_trick: '对出征洛阳的军队无法使用给当前计谋',
  },
  StartTroop: {
    no_flag: '军旗',
    too_many_sid: '兵种过多',
    no_so_many_army: '城池中没有这么多军队。',
    no_soldier: '军队中没有士兵，不能出战。',
    no_enough_ground_level: '当前级别的校场不能发送超过%d的军队。',
    hero_is_busy: '该将领不在空闲状态，不能出征。',
  },
  book: { not_your_hero: '请选择自己的将领！' },
  searchcityname: { target_union_not_exist: '该城池不存在' },
  getUnionRelation: { not_belongTo_union: '你已经不属于任何联盟。' },
  buyGoods: { no_enough_YuanBao: '你的元宝不足，请充值。' },
  heroexpr: { get_reward_success: '购买成功' },
  useTrick: { hero_not_exist: '该将领不存在。', trick_not_exist: '该计谋不存在。' },
  trickQianLiBenXi: {
    succ: '“千里奔袭”用计成功！\n我方军队行军速度加快！',
    wrong_state: '“千里奔袭”只能对行进中的队伍使用！',
    cool_down: '一支部队一小时内只能使用一次“千里奔袭”。',
  },
  waigua: { invalid: '数据异常' },
  battle: { callback_succ: '军队正在返回出发城池，请到出征面板中查看。' },
});

const UID = 1001;
const CID = 209355;
const HID = 80213;
const UNION = 3;
const LY = 215265;
const ctx = { uid: UID, cid: 0, ip: 0, sip: '' };

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const goods = new GoodsRules(db.scope);
  const users = new UserRules(db.scope);
  const cmd = new LuoyangCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    goods,
    new TaskRewards(
      db.scope,
      lang,
      new CityRules(db.scope),
      goods,
      new HeroRules(db.scope),
      users,
      new RandomService(new ScriptedRandom()),
    ),
    users,
  );
  return { cmd, db };
}

async function errorOf(p: Promise<unknown>): Promise<GameError> {
  try {
    await p;
  } catch (e) {
    return e as GameError;
  }
  throw new Error('expected the command to throw');
}

// ───────────────────────────── 共用夹具 ─────────────────────────────

/** mem_state state=? value=? — 2000 开关 / 2001 开启时间。 */
const STATE = (state: number, value: unknown): Respond => ({
  match: /select value as v from mem_state where state = \?$/,
  params: [state],
  rows: value === undefined ? [] : [{ v: value }],
});
const NOW = (ts: number): Respond => ({
  match: /select unix_timestamp\(\) as t/,
  rows: [{ t: ts }],
});
const CLOCK = (day: string, hour: string): Respond[] => [
  { match: /date_format\(now\(\), '%w'\)/, rows: [{ t: day }] },
  { match: /date_format\(now\(\), '%k'\)/, rows: [{ t: hour }] },
];
const NOBILITY = (value: unknown): Respond => ({
  match: /select nobility as v from sys_user/,
  rows: [{ v: value }],
});
const UNION_ID = (value: unknown): Respond => ({
  match: /select union_id as v from sys_user/,
  rows: [{ v: value }],
});
const NO_BUFFER: Respond = { match: /mem_user_buffer/, rows: [] };
const PUSHEN = (bufparam: number): Respond => ({
  match: /mem_user_buffer/,
  rows: [{ bufparam }],
});
/** isHeroHasBuffer 是 raw 模板，编译后无引号。 */
const HERO_BUFFER: Respond = {
  match: /mem_hero_buffer where hid = \? and buftype = \?/,
  rows: [],
};
const HERO_BUFFER_PRESENT: Respond = {
  match: /mem_hero_buffer/,
  rows: [{ hid: HID, buftype: 4 }],
};
const MONEY = (value: unknown): Respond => ({
  match: /select money as v from sys_user/,
  rows: [{ v: value }],
});
const TROOP_NUM = (n: number): Respond => ({
  match: /select count\(\*\) as v from sys_luoyang_troops/,
  rows: [{ v: String(n) }],
});
const SECOND = (value: unknown): Respond => ({
  match: /select second as v from sys_user_luoyang/,
  rows: value === undefined ? [] : [{ v: value }],
});
const CITY_SOLDIERS = (rows: Respond['rows']): Respond => ({
  match: /select \* from sys_city_soldier where cid = \?/,
  rows,
});
const GROUND = (level: number): Respond => ({
  match: /select level as v from sys_building where cid = \? and bid = \?/,
  params: [CID, 8],
  rows: [{ v: String(level) }],
});
const MY_CITY = (type: number): Respond => ({
  match: /select \* from sys_city where cid = \?/,
  rows: [{ cid: CID, uid: UID, type }],
});
const NO_SPECIAL: Respond = { match: /cfg_soldier_special_city/, rows: [] };
const CITY_TYPE = (type: number): Respond => ({
  match: /select type as v from sys_city where cid = \?/,
  rows: [{ v: String(type) }],
});
const TECH = (level = 0): Respond => ({
  match: /select level as v from sys_city_technic/,
  rows: [{ v: String(level) }],
});
const NO_HERO_ATTR: Respond = { match: /sys_hero_attribute/, rows: [] };
/** 民夫 speed 200、长枪兵 speed 250 — getTroopTime 只按 takeSoldiers 命中的兵取速度。 */
const CFG_SOLDIER: Respond = {
  match: /select \* from cfg_soldier where fromcity = 1 order by sid/,
  rows: [
    { sid: '1', speed: '200' },
    { sid: '4', speed: '250' },
  ],
};
const HERO_BY_HID = (row: Record<string, unknown> | null): Respond => ({
  match: /select \* from sys_city_hero where hid = \?$/,
  rows: row ? [row] : [],
});
const SOLDIER_CHECK = (row: Record<string, unknown> | null): Respond => ({
  match: /select \* from sys_luoyang_troops where uid = \? and id = \?$/,
  rows: row ? [row] : [],
});

/** sqrt((265-355)^2+(215-209)^2)*60000 = 5411986.788582381 每速度点。 */
const PATH_LEN_X_GRID = Math.sqrt(8136) * 60000;

// ───────────────────────────── getLYBattleData ─────────────────────────────

describe('LuoyangCommands getLYBattleData', () => {
  it('refuses unless mem_state 2000 is exactly 1', async () => {
    const { cmd } = build([STATE(2000, '0')]);
    expect((await errorOf(cmd.getLYBattleData(ctx))).key).toBe('luoyang.out_of_time');
    // value=2（冻结）同样按未开启处理（原版只 intval 比较）
    const frozen = build([STATE(2000, '2')]);
    expect((await errorOf(frozen.cmd.getLYBattleData(ctx))).key).toBe('luoyang.out_of_time');
  });

  it('refuses a bogus start time with waigua.invalid', async () => {
    const { cmd } = build([STATE(2000, '1'), STATE(2001, '0')]);
    expect((await errorOf(cmd.getLYBattleData(ctx))).key).toBe('waigua.invalid');
    const missing = build([STATE(2000, '1'), STATE(2001, undefined)]);
    expect((await errorOf(missing.cmd.getLYBattleData(ctx))).key).toBe('waigua.invalid');
  });

  it('closes after the 2h window', async () => {
    const { cmd } = build([STATE(2000, '1'), STATE(2001, '1630000000'), NOW(1630000000 + 7201)]);
    expect((await errorOf(cmd.getLYBattleData(ctx))).key).toBe('luoyang.has_close');
  });

  it('demands nobility 6 (推恩令 lifted) and a union', async () => {
    const low = build([
      STATE(2000, '1'),
      STATE(2001, '1630000000'),
      NOW(1630001000),
      NOBILITY(5),
      NO_BUFFER,
    ]);
    expect((await errorOf(low.cmd.getLYBattleData(ctx))).key).toBe('luoyang.nobility_is_too_low');
    // 推恩令 bufparam=2: 5+2=7 ≥ 6，爵位闸门放过，随后挡在联盟
    const pushed = build([
      STATE(2000, '1'),
      STATE(2001, '1630000000'),
      NOW(1630001000),
      NOBILITY(5),
      PUSHEN(2),
      UNION_ID('0'),
    ]);
    expect((await errorOf(pushed.cmd.getLYBattleData(ctx))).key).toBe('luoyang.not_in_union');
  });

  it('returns [城图, 剩余秒, 援军权, 自己的军队]', async () => {
    const cityInfo = [{ cid: '1', image: '0', name: '平城门', nextcid: '4,6' }];
    const troops = [{ id: 55, heroname: '关羽', leavingTime: 300 }];
    const { cmd } = build([
      STATE(2000, '1'),
      STATE(2001, '1630000000'),
      NOW(1630001000),
      NOBILITY('7'),
      NO_BUFFER,
      UNION_ID('3'),
      { match: /cfg_luoyang_city_add/, rows: cityInfo },
      SECOND('1'),
      { match: /heroname/, rows: troops },
    ]);
    expect(await cmd.getLYBattleData(ctx)).toEqual([cityInfo, 6200, '1', troops]);
  });

  it('renders an absent 援军权 as 0', async () => {
    const { cmd } = build([
      STATE(2000, '1'),
      STATE(2001, '1630000000'),
      NOW(1630001000),
      NOBILITY('7'),
      NO_BUFFER,
      UNION_ID('3'),
      { match: /cfg_luoyang_city_add/, rows: [] },
      SECOND(undefined),
      { match: /heroname/, rows: [] },
    ]);
    expect(await cmd.getLYBattleData(ctx)).toEqual([[], 6200, 0, []]);
  });
});

// ───────────────────────────── luoyangTroopStart ─────────────────────────────

const SOLDIERS = '2,1,500,4,300';
const START_BASE = (extra: Respond[]): Respond[] => [
  ...CLOCK('3', '20'),
  { match: /mem_state where state = \? and value = 2/, rows: [] },
  { match: /select 1 as x from sys_city_hero where uid = \? and hid = \?$/, rows: [{ x: 1 }] },
  { match: /select 1 as x from sys_city where uid = \? and cid = \?/, rows: [{ x: 1 }] },
  { match: /select 1 as x from sys_user where uid = \? and union_id = \?/, rows: [{ x: 1 }] },
  {
    match: /select 1 as x from sys_city_hero where uid = \? and hid = \? and state = '0'/,
    rows: [{ x: 1 }],
  },
  ...extra,
];

describe('LuoyangCommands luoyangTroopStart gates', () => {
  it('throws out_of_time unless it is Wednesday 19:00+ (DB clock)', async () => {
    const thursday = build(CLOCK('4', '20'));
    expect(
      (await errorOf(thursday.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('luoyang.out_of_time');
    const tooEarly = build(CLOCK('3', '18'));
    expect(
      (await errorOf(tooEarly.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('luoyang.out_of_time');
    // 周三 19:00 整放过时间闸门（撞到 state=2000 value=2 检查为止）
    const onTime = build([
      ...CLOCK('3', '19'),
      { match: /mem_state where state = \? and value = 2/, rows: [{ x: 1 }] },
    ]);
    expect(
      (await errorOf(onTime.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('luoyang.has_close');
  });

  it('demands 军旗 when the client asks to use one', async () => {
    const { cmd } = build([
      {
        match: /select count from sys_goods where uid = \? and gid = \?/,
        params: [UID, 59],
        rows: [],
      },
    ]);
    expect((await errorOf(cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, true]))).key).toBe(
      'StartTroop.no_flag',
    );
  });

  it('closes on mem_state 2000 value=2 (冻结)', async () => {
    const { cmd } = build([
      ...CLOCK('3', '20'),
      { match: /mem_state where state = \? and value = 2/, rows: [{ x: 1 }] },
    ]);
    expect(
      (await errorOf(cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('luoyang.has_close');
  });

  it('validates hero / city / union / free hero in the original order', async () => {
    const noHero = build([
      ...CLOCK('3', '20'),
      { match: /mem_state where state = \? and value = \?/, rows: [] },
    ]);
    expect(
      (await errorOf(noHero.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('book.not_your_hero');
    const noCity = build([
      ...CLOCK('3', '20'),
      { match: /mem_state where state = \? and value = 2/, rows: [] },
      { match: /select 1 as x from sys_city_hero where uid = \? and hid = \?$/, rows: [{ x: 1 }] },
    ]);
    expect(
      (await errorOf(noCity.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('searchcityname.target_union_not_exist');
    const noUnion = build([
      ...CLOCK('3', '20'),
      { match: /mem_state where state = \? and value = 2/, rows: [] },
      { match: /select 1 as x from sys_city_hero where uid = \? and hid = \?$/, rows: [{ x: 1 }] },
      { match: /select 1 as x from sys_city where uid = \? and cid = \?/, rows: [{ x: 1 }] },
    ]);
    expect(
      (await errorOf(noUnion.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('getUnionRelation.not_belongTo_union');
    const busy = build([
      ...CLOCK('3', '20'),
      { match: /mem_state where state = \? and value = 2/, rows: [] },
      { match: /select 1 as x from sys_city_hero where uid = \? and hid = \?$/, rows: [{ x: 1 }] },
      { match: /select 1 as x from sys_city where uid = \? and cid = \?/, rows: [{ x: 1 }] },
      { match: /select 1 as x from sys_user where uid = \? and union_id = \?/, rows: [{ x: 1 }] },
    ]);
    expect(
      (await errorOf(busy.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('StartTroop.hero_is_busy');
  });

  it('demands nobility 6 and at most one troop without 援军权', async () => {
    const low = build([...START_BASE([NOBILITY(5), NO_BUFFER])]);
    expect(
      (await errorOf(low.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('luoyang.nobility_is_too_low');
    const exists = build([
      ...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(1), SECOND(undefined)]),
    ]);
    expect(
      (await errorOf(exists.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('luoyang.troop_exists');
    // count(*)=0 是 phpEmpty，不算已有军队
    const fresh = build([...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(0), SECOND(undefined)])]);
    expect(
      (await errorOf(fresh.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('StartTroop.no_so_many_army');
  });

  it('rejects empty armies, >12 kinds and overdrafted soldiers', async () => {
    const none = build([...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(0)])]);
    expect(
      (await errorOf(none.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, '0', false]))).key,
    ).toBe('StartTroop.no_soldier');
    const many = build([...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(0)])]);
    expect(
      (
        await errorOf(
          many.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, '13,' + '1,1,'.repeat(13), false]),
        )
      ).key,
    ).toBe('StartTroop.too_many_sid');
    const overdraft = build([
      ...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(0)]),
      CITY_SOLDIERS([{ sid: '1', count: '100' }]),
    ]);
    expect(
      (await errorOf(overdraft.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false]))).key,
    ).toBe('StartTroop.no_so_many_army');
  });

  it('rejects armies over the 校场 limit (军旗/名城加成 ceil)', async () => {
    const OVER = '2,1,9000,4,9000'; // 18000 人
    const base = [
      ...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(0)]),
      CITY_SOLDIERS([
        { sid: '1', count: '9000' },
        { sid: '4', count: '9000' },
      ]),
      GROUND(1),
      MY_CITY(0),
      NO_SPECIAL,
    ];
    const cmd1 = build(base);
    expect(
      (await errorOf(cmd1.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, OVER, false]))).args,
    ).toEqual([10000]);
    // 军旗 +25%: 1 万校场上限 ceil 到 12500，仍然不够（18000）
    const withFlag = build([
      ...base,
      {
        match: /select count from sys_goods\s+where uid = \? and gid = \?/,
        params: [UID, 59],
        rows: [{ count: '1' }],
      },
    ]);
    expect(
      (await errorOf(withFlag.cmd.luoyangTroopStart(ctx, [HID, CID, UNION, OVER, true]))).args,
    ).toEqual([12500]);
  });
});

describe('LuoyangCommands luoyangTroopStart success', () => {
  it('consumes the flag unconditionally, deducts soldiers and inserts the luoyang troop', async () => {
    // pathLength×GRID=5411986.788582381，最慢民夫 200×1.1(将领 speed_add_on 10)=220 → floor 24599
    const pathNeedTime = Math.floor(PATH_LEN_X_GRID / 220);
    const { cmd, db } = build([
      ...START_BASE([NOBILITY(7), NO_BUFFER, TROOP_NUM(0), SECOND('0')]),
      CITY_SOLDIERS([
        { sid: '1', count: '500' },
        { sid: '4', count: '300' },
      ]),
      GROUND(2),
      MY_CITY(0),
      NO_SPECIAL,
      HERO_BY_HID({ hid: HID, speed_add_on: '10' }),
      TECH(0),
      NO_HERO_ATTR,
      CFG_SOLDIER,
      CITY_TYPE(0),
    ]);
    expect(await cmd.luoyangTroopStart(ctx, [HID, CID, UNION, SOLDIERS, false])).toEqual([
      '出征成功！',
    ]);
    const sqls = db.executed.map((e) => e.sql);
    // 原版怪癖：即使不带军旗也无条件扣 1 面（GREATEST 钳到 0）
    expect(
      db.executed.some(
        (e) =>
          /insert into `log_goods`/.test(e.sql) &&
          e.parameters[0] == UID &&
          e.parameters[1] == 59 &&
          e.parameters[2] == -1,
      ),
    ).toBe(true);
    // 扣兵员（民夫 -500、长枪 -300）
    expect(sqls.filter((s) => /on duplicate key update count = count - \?/.test(s)).length).toBe(2);
    const insert = db.executed.find((e) => /insert into sys_luoyang_troops/.test(e.sql));
    expect(insert).toBeDefined();
    // (uid, cid, hid, targetcid, starttime, pathtime, endtime, soldiers, startcid, unionid)
    expect(insert!.parameters).toEqual([
      UID,
      CID,
      HID,
      LY,
      pathNeedTime,
      pathNeedTime,
      SOLDIERS,
      CID,
      UNION,
    ]);
    expect(sqls.some((s) => /update sys_city_hero set state = '2' where hid = \?/.test(s))).toBe(
      true,
    );
  });
});

// ───────────────────────────── luoyangCallbackTroop ─────────────────────────────

const LY_TROOP = {
  id: 55,
  uid: UID,
  cid: 1,
  hid: HID,
  targetcid: String(LY),
  state: '0',
  starttime: '1630000000',
  pathtime: '24600',
  endtime: '16300024600',
  soldiers: SOLDIERS,
  battleid: '0',
  startcid: String(CID),
  unionid: String(UNION),
  lastcc: '0',
};

describe('LuoyangCommands luoyangCallbackTroop', () => {
  it('refuses foreign or battling troops', async () => {
    const notYours = build([SOLDIER_CHECK(null)]);
    expect((await errorOf(notYours.cmd.luoyangCallbackTroop(ctx, [55]))).key).toBe(
      'luoyang.not_your_troop',
    );
    const battling = build([SOLDIER_CHECK({ ...LY_TROOP, state: '1' })]);
    expect((await errorOf(battling.cmd.luoyangCallbackTroop(ctx, [55]))).key).toBe(
      'luoyang.in_luoyang_battle',
    );
  });

  it('recalls on the way: pathtime=now-starttime, converts to a returning sys_troops row', async () => {
    const { cmd, db } = build([
      SOLDIER_CHECK(LY_TROOP),
      HERO_BY_HID(null), // 原版把 uid 当 hid 查 speed_add_on，通常查不到
      TECH(0),
      NO_HERO_ATTR,
      CFG_SOLDIER,
      CITY_TYPE(0),
      { match: /select starttime as v from sys_luoyang_troops/, rows: [{ v: '1630000000' }] },
      NOW(1630000300),
    ]);
    expect(await cmd.luoyangCallbackTroop(ctx, [55])).toEqual([
      '军队正在返回出发城池，请到出征面板中查看。',
    ]);
    const insert = db.executed.find((e) => /insert into sys_troops/.test(e.sql));
    expect(insert).toBeDefined();
    // (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
    expect(insert!.parameters).toEqual([UID, CID, HID, LY, 300, 300, SOLDIERS]);
    expect(db.executed.some((e) => /delete from sys_luoyang_troops/.test(e.sql))).toBe(true);
  });

  it('recalls inside the battlefield with the plain getTroopTime pathtime', async () => {
    // 战场内（targetcid≠215265）：pathtime 走 getTroopTime — 最慢民夫 200（uid 当 hid，无加成）
    const { cmd, db } = build([
      SOLDIER_CHECK({ ...LY_TROOP, targetcid: '1' }),
      HERO_BY_HID(null),
      TECH(0),
      NO_HERO_ATTR,
      CFG_SOLDIER,
      CITY_TYPE(0),
      { match: /select starttime as v from sys_luoyang_troops/, rows: [{ v: '1630000000' }] },
    ]);
    await cmd.luoyangCallbackTroop(ctx, [55]);
    const insert = db.executed.find((e) => /insert into sys_troops/.test(e.sql));
    expect(insert!.parameters[4]).toBe(Math.floor(PATH_LEN_X_GRID / 200));
  });
});

// ───────────────────────────── luoyangCityTroops ─────────────────────────────

describe('LuoyangCommands luoyangCityTroops', () => {
  it('only lets troops of the own (cid,hid) be listed', async () => {
    const { cmd } = build([
      {
        match: /select 1 as x from sys_luoyang_troops\s+where uid = \? and cid = \? and hid = \?/,
        rows: [],
      },
    ]);
    expect((await errorOf(cmd.luoyangCityTroops(ctx, [1, HID]))).key).toBe('luoyang.not_in_city');
  });

  it('lists every army in the battlefield city with names; NPC gets a blank union', async () => {
    const { cmd } = build([
      {
        match: /select 1 as x from sys_luoyang_troops\s+where uid = \? and cid = \? and hid = \?/,
        rows: [{ x: 1 }],
      },
      {
        match:
          /select id, uid as userId, cid, hid, state,\s+soldiers, battleid, unionid from sys_luoyang_troops/,
        rows: [
          {
            id: 1,
            userId: '1001',
            cid: 1,
            hid: HID,
            state: '0',
            soldiers: '1,1,100',
            battleid: '0',
            unionid: '3',
          },
          {
            id: 2,
            userId: '5',
            cid: 1,
            hid: 900,
            state: '0',
            soldiers: '1,1,50',
            battleid: '0',
            unionid: '0',
          },
        ],
      },
      {
        match: /select name as v from sys_user where uid = \? limit 1/,
        params: [1001],
        rows: [{ v: 'changle' }],
      },
      {
        match: /select name as v from sys_user where uid = \? limit 1/,
        params: [5],
        rows: [{ v: '黄巾军' }],
      },
      {
        match: /select name, level from sys_city_hero/,
        params: [HID],
        rows: [{ name: '关羽', level: '40' }],
      },
      {
        match: /select name, level from sys_city_hero/,
        params: [900],
        rows: [{ name: '张角', level: '30' }],
      },
      { match: /select name as v from sys_union/, rows: [{ v: '桃园' }] },
    ]);
    const [rows] = (await cmd.luoyangCityTroops(ctx, [1, HID])) as [Record<string, unknown>[]];
    expect(rows[0]).toEqual({
      id: 1,
      userId: '1001',
      cid: 1,
      hid: HID,
      state: '0',
      soldiers: '1,1,100',
      battleid: '0',
      unionid: '3',
      name: 'changle',
      heroName: '关羽',
      heroLevel: '40',
      unionName: '桃园',
    });
    // NPC 军队（uid≤1000）：unionName 是单个空格
    expect(rows[1]!.unionName).toBe(' ');
    expect(rows[1]!.name).toBe('黄巾军');
  });
});

// ───────────────────────────── luoyangChangeCity ─────────────────────────────

describe('LuoyangCommands luoyangChangeCity', () => {
  const check = (sql: RegExp, present: boolean): Respond => ({
    match: sql,
    rows: present ? [{ x: 1 }] : [],
  });

  it('walks its four gates in order', async () => {
    const notYours = build([
      check(/select 1 as x from sys_luoyang_troops where uid = \? and id = \?$/, false),
    ]);
    expect((await errorOf(notYours.cmd.luoyangChangeCity(ctx, [55, 1, 3]))).key).toBe(
      'luoyang.not_your_troop',
    );
    const noPath = build([
      check(/select 1 as x from sys_luoyang_troops where uid = \? and id = \?$/, true),
      check(/select 1 as x from cfg_luoyang_city/, false),
    ]);
    expect((await errorOf(noPath.cmd.luoyangChangeCity(ctx, [55, 1, 3]))).key).toBe(
      'luoyang.cannot_go_city',
    );
    const resting = build([
      check(/select 1 as x from sys_luoyang_troops where uid = \? and id = \?$/, true),
      check(/select 1 as x from cfg_luoyang_city/, true),
      check(
        /select 1 as x from sys_luoyang_troops\s+where endtime > unix_timestamp\(\) and id = \?/,
        true,
      ),
    ]);
    expect((await errorOf(resting.cmd.luoyangChangeCity(ctx, [55, 1, 3]))).key).toBe(
      'luoyang.time_not_pass',
    );
    const npc = build([
      check(/select 1 as x from sys_luoyang_troops where uid = \? and id = \?$/, true),
      check(/select 1 as x from cfg_luoyang_city/, true),
      check(
        /select 1 as x from sys_luoyang_troops\s+where endtime > unix_timestamp\(\) and id = \?/,
        false,
      ),
      check(/select 1 as x from sys_luoyang_troops where cid = \? and uid < 1000/, true),
    ]);
    expect((await errorOf(npc.cmd.luoyangChangeCity(ctx, [55, 1, 3]))).key).toBe(
      'luoyang.NPC_troops_exists',
    );
  });

  it('re-departs to the target gate for a fixed 120s', async () => {
    const { cmd, db } = build([
      check(/select 1 as x from sys_luoyang_troops where uid = \? and id = \?$/, true),
      check(/select 1 as x from cfg_luoyang_city/, true),
      check(
        /select 1 as x from sys_luoyang_troops\s+where endtime > unix_timestamp\(\) and id = \?/,
        false,
      ),
      check(/select 1 as x from sys_luoyang_troops where cid = \? and uid < 1000/, false),
      {
        match: /select id, hid, cid, targetcid, pathtime\s+from sys_luoyang_troops/,
        rows: [{ id: 55, hid: HID, cid: '3', targetcid: '3', pathtime: '120' }],
      },
    ]);
    expect(await cmd.luoyangChangeCity(ctx, [55, 1, 3])).toEqual([
      { id: 55, hid: HID, cid: '3', targetcid: '3', pathtime: '120' },
      '出征成功！',
    ]);
    const update = db.executed.find((e) => /update sys_luoyang_troops set cid = \?/.test(e.sql));
    // (cid, targetcid, starttime, pathtime=120 字面量, endtime=字面量, id)
    expect(update!.parameters).toEqual([3, 3, 55]);
    expect(update!.sql).toContain('pathtime = 120, endtime = unix_timestamp() + 120');
  });
});

// ───────────────────────────── luoyangAttack ─────────────────────────────

const ATTACK_TROOP = {
  id: 11,
  uid: '1001',
  hid: '80213',
  cid: '1',
  state: '0',
  soldiers: '1,1,100',
  unionid: '3',
  startcid: '209355',
};
const RESIST_TROOP = {
  id: 12,
  uid: '1002',
  hid: '900',
  cid: '1',
  state: '0',
  soldiers: '2,1,80',
  unionid: '4',
  startcid: '215001',
};

describe('LuoyangCommands luoyangAttack', () => {
  it('refuses while closed (missing row reads as 0)', async () => {
    const closed = build([STATE(2000, '0')]);
    expect((await errorOf(closed.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.not_open',
    );
    const missing = build([STATE(2000, undefined)]);
    expect((await errorOf(missing.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.not_open',
    );
    const frozen = build([STATE(2000, '2')]);
    expect((await errorOf(frozen.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.has_close',
    );
  });

  it('validates both troops, the unions and the two battle states', async () => {
    const base = [STATE(2000, '1')];
    const troopRule = (row: Record<string, unknown> | null, hid: number): Respond => ({
      match: /select \* from sys_luoyang_troops\s+where hid = \? and cid = \?/,
      params: [hid, 1],
      rows: row ? [row] : [],
    });
    const noResist = build([...base, troopRule(ATTACK_TROOP, HID), troopRule(null, 900)]);
    expect((await errorOf(noResist.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.troop_not_exists',
    );
    const sameUnion = build([
      ...base,
      troopRule(ATTACK_TROOP, HID),
      troopRule({ ...RESIST_TROOP, unionid: '3' }, 900),
    ]);
    expect((await errorOf(sameUnion.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.union_is_same',
    );
    const selfBattle = build([
      ...base,
      troopRule({ ...ATTACK_TROOP, state: '1' }, HID),
      troopRule(RESIST_TROOP, 900),
    ]);
    expect((await errorOf(selfBattle.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.troop_self_battle',
    );
    const otherBattle = build([
      ...base,
      troopRule(ATTACK_TROOP, HID),
      troopRule({ ...RESIST_TROOP, state: '1' }, 900),
    ]);
    expect((await errorOf(otherBattle.cmd.luoyangAttack(ctx, [HID, 900, 1]))).key).toBe(
      'luoyang.troop_other_battle',
    );
  });

  it('opens a type-5 encounter battle and returns the string battleid', async () => {
    const { cmd, db } = build([
      STATE(2000, '1'),
      {
        match: /select \* from sys_luoyang_troops\s+where hid = \? and cid = \?/,
        params: [HID, 1],
        rows: [ATTACK_TROOP],
      },
      {
        match: /select \* from sys_luoyang_troops\s+where hid = \? and cid = \?/,
        params: [900, 1],
        rows: [RESIST_TROOP],
      },
      { match: /insert into sys_battle/, insertId: 7 },
    ]);
    expect(await cmd.luoyangAttack(ctx, [HID, 900, 1])).toEqual(['7']);
    const sqls = db.executed.map((e) => e.sql);
    const battle = db.executed.find((e) => /insert into sys_battle/.test(e.sql))!;
    // (type, starttime, cid, attackuid, resistuid, attacktroop, resisttroops)
    expect(battle.parameters).toEqual([1, 1001, 1002, 11, 12]);
    expect(battle.sql).toContain('values (5, unix_timestamp()');
    const mem = db.executed.find((e) => /replace into mem_battle\s/.test(e.sql))!;
    // (id, type, nexttime, round, attackcid, attackhid, attacksoldiers, resistcid, resisthid,
    //  resistsoldiers, level='10' 字面量, attackstartcid, resiststartcid) 的绑定参数
    expect(mem.parameters).toEqual([7, 1, 80213, '1,1,100', 1, 900, '2,1,80', 1, 1]);
    // 双方 state=1、battleid、两条默认遭遇战战术（plunder 列）
    expect(sqls.filter((s) => /update sys_luoyang_troops set state = '1'/.test(s)).length).toBe(2);
    expect(sqls.filter((s) => /update sys_luoyang_troops set battleid = \?/.test(s)).length).toBe(
      2,
    );
    expect(sqls.filter((s) => /replace into mem_battle_tactics/.test(s)).length).toBe(2);
    expect(
      db.executed
        .filter((e) => /replace into mem_battle_tactics/.test(e.sql))
        .every((e) => /plunder_action, plunder_target/.test(e.sql)),
    ).toBe(true);
  });
});

// ───────────────────────────── luoyangYuanjun ─────────────────────────────

describe('LuoyangCommands luoyangYuanjun', () => {
  it('demands 100 元宝', async () => {
    const poor = build([MONEY('50')]);
    expect((await errorOf(poor.cmd.luoyangYuanjun(ctx))).key).toBe('buyGoods.no_enough_YuanBao');
    const broke = build([MONEY(undefined)]);
    expect((await errorOf(broke.cmd.luoyangYuanjun(ctx))).key).toBe('buyGoods.no_enough_YuanBao');
  });

  it('grants the 援军权 (second=1) and logs -100 元宝 as type 91', async () => {
    const { cmd, db } = build([MONEY('1000'), UNION_ID('3')]);
    expect(await cmd.luoyangYuanjun(ctx)).toEqual(['购买成功']);
    const insert = db.executed.find((e) => /insert into sys_user_luoyang/.test(e.sql))!;
    expect(insert.parameters).toEqual([UID, 3]);
    expect(insert.sql).toContain('on duplicate key update second = 1');
    const money = db.executed.find((e) => /insert into log_money/.test(e.sql))!;
    expect(money.parameters).toEqual([UID, -100, 91]);
    expect(db.executed.some((e) => /insert into log_day_money/.test(e.sql))).toBe(true);
    expect(db.executed.some((e) => /update sys_user set money = money \+ \?/.test(e.sql))).toBe(
      true,
    );
  });
});

// ───────────────────────────── useLuoyangTrick ─────────────────────────────

const TRICK = { id: '13', usetype: '2', cost: '12' };
const JINNANG_HAVE = (count: unknown): Respond => ({
  match: /select count as v from sys_goods where uid = \? and gid = \?/,
  params: [UID, 13],
  rows: count === undefined ? [] : [{ v: count }],
});
const JINNANG_SUM = (count: unknown): Respond => ({
  match: /select sum\(count\) as v from sys_goods/,
  rows: [{ v: count }],
});

describe('LuoyangCommands useLuoyangTrick', () => {
  it('only opens 千里奔袭 (type 13)', async () => {
    const { cmd } = build([]);
    expect((await errorOf(cmd.useLuoyangTrick(ctx, [HID, 12, 2]))).key).toBe(
      'luoyang.can_not_use_trick',
    );
  });

  it('validates the hero, the trick row and its usetype', async () => {
    const noHero = build([]);
    expect((await errorOf(noHero.cmd.useLuoyangTrick(ctx, [HID, 13, 2]))).key).toBe(
      'useTrick.hero_not_exist',
    );
    const noTrick = build([HERO_BY_HID({ hid: HID })]);
    expect((await errorOf(noTrick.cmd.useLuoyangTrick(ctx, [HID, 13, 2]))).key).toBe(
      'useTrick.trick_not_exist',
    );
    const wrongUse = build([
      HERO_BY_HID({ hid: HID }),
      { match: /cfg_trick/, rows: [{ ...TRICK, usetype: '0' }] },
    ]);
    expect((await errorOf(wrongUse.cmd.useLuoyangTrick(ctx, [HID, 13, 2]))).key).toBe(
      'useTrick.trick_not_exist',
    );
  });

  it('answers the raw not_enough_goods13#N string to trigger the buy-and-use popup', async () => {
    const { cmd } = build([
      HERO_BY_HID({ hid: HID }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE(undefined),
    ]);
    const err = await errorOf(cmd.useLuoyangTrick(ctx, [HID, 13, 2]));
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBeNull();
    expect(err.message).toBe('not_enough_goods13#12');
  });

  it('throws wrong_state without a troop row or with a non-Luoyang target', async () => {
    const noTroop = build([
      HERO_BY_HID({ hid: HID }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE('20'),
      HERO_BUFFER,
      { match: /select \* from sys_luoyang_troops where uid = \? and hid = \?/, rows: [] },
      { match: /select \* from sys_troops where uid = \? and hid = \?/, rows: [] },
    ]);
    expect((await errorOf(noTroop.cmd.useLuoyangTrick(ctx, [HID, 13, 2]))).key).toBe(
      'trickQianLiBenXi.wrong_state',
    );
    const wrongTarget = build([
      HERO_BY_HID({ hid: HID }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE('20'),
      HERO_BUFFER,
      {
        match: /select \* from sys_luoyang_troops where uid = \? and hid = \?/,
        rows: [{ id: 55, targetcid: '1', lastcc: '0' }],
      },
    ]);
    expect((await errorOf(wrongTarget.cmd.useLuoyangTrick(ctx, [HID, 13, 2]))).key).toBe(
      'trickQianLiBenXi.wrong_state',
    );
  });

  it('honours the 1h lastcc cooldown', async () => {
    const { cmd } = build([
      HERO_BY_HID({ hid: HID }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE('20'),
      HERO_BUFFER,
      {
        match: /select \* from sys_luoyang_troops where uid = \? and hid = \?/,
        rows: [{ id: 55, targetcid: String(LY), lastcc: '1630000900' }],
      },
      NOW(1630001000),
    ]);
    expect((await errorOf(cmd.useLuoyangTrick(ctx, [HID, 13, 2]))).key).toBe(
      'trickQianLiBenXi.cool_down',
    );
  });

  it('speeds up the luoyang troop and spends 12 锦囊 (isBack=1)', async () => {
    // 智谋 50+10+5=65（无智多星符）→ addrate = 100/165
    const { cmd, db } = build([
      HERO_BY_HID({ hid: HID, wisdom_base: '50', wisdom_add: '10', wisdom_add_on: '5' }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE('20'),
      HERO_BUFFER,
      {
        match: /select \* from sys_luoyang_troops where uid = \? and hid = \?/,
        rows: [{ id: 55, targetcid: String(LY), lastcc: '1629996000' }],
      },
      NOW(1630001000),
      JINNANG_SUM('8'),
    ]);
    expect(await cmd.useLuoyangTrick(ctx, [HID, 13, 2])).toEqual([
      '“千里奔袭”用计成功！\n我方军队行军速度加快！',
      '8',
    ]);
    const update = db.executed.find((e) => /update sys_luoyang_troops\s+set endtime/.test(e.sql))!;
    expect(update.parameters[0]).toBeCloseTo(100 / 165, 12);
    expect(update.parameters[1]).toBe(55);
    // 锦囊 -12（addGoods 是 raw 模板：insert ... on duplicate key update）
    expect(
      db.executed.some(
        (e) =>
          /insert into sys_goods \(uid, gid, count\) values \(\?, \?, \?\)\s+on duplicate key update count = count \+ \?/.test(
            e.sql,
          ) &&
          e.parameters[0] == UID &&
          e.parameters[1] == 13 &&
          e.parameters[2] == -12,
      ),
    ).toBe(true);
  });

  it('speeds up a returning sys_troops row instead (isBack=-1, lastacc)', async () => {
    const { cmd, db } = build([
      HERO_BY_HID({ hid: HID, wisdom_base: '50', wisdom_add: '10', wisdom_add_on: '5' }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE('20'),
      HERO_BUFFER,
      { match: /select \* from sys_luoyang_troops where uid = \? and hid = \?/, rows: [] },
      {
        match: /select \* from sys_troops where uid = \? and hid = \?/,
        rows: [{ id: 77, targetcid: String(LY), lastacc: '1629996000' }],
      },
      NOW(1630001000),
      JINNANG_SUM('8'),
    ]);
    await cmd.useLuoyangTrick(ctx, [HID, 13, 2]);
    const update = db.executed.find((e) => /update sys_troops\s+set endtime/.test(e.sql))!;
    expect(update.parameters[0]).toBeCloseTo(100 / 165, 12);
    expect(update.parameters[1]).toBe(77);
    expect(update.sql).toContain('lastacc = unix_timestamp()');
  });

  it('智多星符 multiplies wisdom by 1.25 before add_on', async () => {
    const { cmd, db } = build([
      HERO_BY_HID({ hid: HID, wisdom_base: '50', wisdom_add: '10', wisdom_add_on: '5' }),
      { match: /cfg_trick/, rows: [TRICK] },
      JINNANG_HAVE('20'),
      HERO_BUFFER_PRESENT,
      {
        match: /select \* from sys_luoyang_troops where uid = \? and hid = \?/,
        rows: [{ id: 55, targetcid: String(LY), lastcc: '1629996000' }],
      },
      NOW(1630001000),
      JINNANG_SUM('8'),
    ]);
    await cmd.useLuoyangTrick(ctx, [HID, 13, 2]);
    // (50+10)*1.25+5 = 80 → addrate = 100/180
    const update = db.executed.find((e) => /update sys_luoyang_troops\s+set endtime/.test(e.sql))!;
    expect(update.parameters[0]).toBeCloseTo(100 / 180, 12);
  });
});
