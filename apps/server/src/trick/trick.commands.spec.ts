import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { HeroExprCommands } from '../hero/hero-expr.commands';
import { TroopCommands } from '../world/troop.commands';
import { TrickCommands } from './trick.commands';

const lang = new LangService({
  MakeEndTime: { year: '年', month: '月', day: '日' },
  MakeTimeLeft: { hour: '小时', min: '分钟', sec: '秒' },
  waigua: { forbidden: '以检测到恶意操作，已记录登录IP信息和启动账号监控！' },
  getCityBuffer: { not_your_city: '该城池不属于你！' },
  StartTroop: { transport: '运输', send: '派遣', detect: '侦察', harry: '掠夺', occupy: '占领' },
  fileName: ['野地', '平地', '荒漠', '森林', '草原', '山地', '湖泊', '沼泽'],
  useTrick: {
    trick_not_exist: '该计谋不存在。',
    hero_not_exist: '该将领不存在。',
    hero_not_incity: '不在城池内的将领不能使用计谋。',
    hero_no_energy: '将领没有足够的精力来使用计谋了。',
    target_is_mine: '不能对自己的城池使用该计谋。',
    target_is_union: '不能对盟友的城池使用该计谋。',
    target_in_vacation: '对方处在休假状态，不能对其城池使用计谋。',
    target_be_locked: '对方已经被锁定，不能对其城池使用计谋。',
    target_is_not_my_troop: '不能对不是自己的军队使用该计谋。',
    target_has_no_hero: '该军队没有将领，不能使用“金蝉脱壳”',
    target_is_not_on_way: '军队不在行军途中，不能使用该计谋。',
    target_is_just_run: '你刚刚对该军队使用过“金蝉脱壳”，%s后才能再次对该军队使用。',
    fail_no_wisdom: '用计失败。一山还有一山高，对方智高一筹，轻易识破了我方的计谋。',
  },
  trickCaoMuJieBin: {
    succ: '“草木皆兵”用计成功。该城池被侦察时将显示军队人数为真实的%d倍，效果将持续到%s。',
  },
  trickYaoYinHuoZhong: {
    succ: '“妖言惑众”用计成功。\n%s民心-%d。',
    succ_caution:
      '%s对%s使用“妖言惑众”！<br/>智者千虑必有一失，我方中计了！<br/>%s民心-%d。<br/>赈灾、祈福可以恢复民心。',
    fail: '“妖言惑众”用计失败。\n吃一堑长一智，对方刚刚中过同样的计策，不会重复上当了。',
    fail_caution: '%s对%s使用“妖言惑众”！<br/>雕虫小技也敢献丑，我方识破了计谋。',
  },
  trickTiaoBoLiJian: {
    fail_nohero: '对方城中没有将领，白费功夫。',
    fail_caution_nohero: '城中没有将领，对方“挑拨离间”失败，白费功夫。',
    fail: '“挑拨离间”用计失败。\n吃一堑长一智，对方将领刚刚中过同样的计策，都不会重复上当了。',
    fail_caution: '%s对%s使用“挑拨离间”！<br/>雕虫小技也敢献丑，我方识破了计谋。<br/>',
    succ: '“挑拨离间”用计成功！\n',
    succ_reduceloyalty: '“%s”忠诚-%d。\n',
    succ_caution: '%s对%s使用“挑拨离间”！<br/>智者千虑必有一失，我方中计了！<br/>',
    succ_caution_reduceloyalty: '“%s”忠诚-%d。<br/>',
    succ_caution_tail: '赏赐将领可以提升将领忠诚。',
  },
  trickJinChaoTuoQiao: { succ: '“金蝉脱壳”用计成功！\n我方军队正在快速返回。' },
  trickYiYiDaiLao: { succ: '“以逸待劳”用计成功！' },
});

const NOW = 1800000000;
const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const scope = db.scope;
  const cityRules = new CityRules(scope);
  const goods = new GoodsRules(scope);
  const users = new UserRules(scope);
  const tasks = new TaskRules(scope, users);
  const report = new ReportService(scope, { raiseAlarm: async () => {} } as never);
  const scripted = new ScriptedRandom();
  const random = new RandomService(scripted);
  const troops = new TroopCommands(scope, cityRules);
  const heroExpr = new HeroExprCommands(scope, lang, goods, tasks, random, users);
  const cmd = new TrickCommands(
    scope,
    lang,
    cityRules,
    goods,
    tasks,
    report,
    random,
    users,
    troops,
    heroExpr,
  );
  return { cmd, db, scripted };
}

/** The two queries every useTrick ends with. Kysely 的查询构建器会给标识符加反引号。 */
const TASK_GOAL_RULE: Respond = {
  match: /select .id. from .cfg_task_goal. where .sort. = \? and .type. = \?/,
  rows: [{ id: 5551 }],
};
const TASK_GOAL_TID_RULE: Respond = {
  match: /select .tid. from .cfg_task_goal. where .id. = \?/,
  rows: [{ tid: 100234 }],
};
const OPEN_TASK_RULE: Respond = {
  match: /select \* from .sys_user_task. where .uid. = \? and .tid. = \? and .state. = \?/,
  rows: [{ uid: 1001, tid: 100234, state: 0 }],
};
/** cfg_trick row 1 草木皆兵: usetype 0, cost 1. */
const TRICK_1 = { id: 1, name: '草木皆兵', usetype: 0, cost: 1 };

describe('TrickCommands.getTrickList', () => {
  it('returns the cfg_trick rows and the own 锦囊 count', async () => {
    const { cmd } = build([
      { match: /select \* from cfg_trick order by id/, rows: [TRICK_1] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getTrickList(ctx)) as unknown[];
    expect(res[0]).toEqual([TRICK_1]);
    expect(res[1]).toBe(5);
  });
});

describe('TrickCommands.getTrickBuffer', () => {
  it('rejects a foreign city', async () => {
    const { cmd } = build([
      { match: /select uid from sys_city where cid = \?/, params: [209355], rows: [{ uid: 999 }] },
      NO(/.*/),
    ]);
    await expect(cmd.getTrickBuffer(ctx, [209355])).rejects.toMatchObject({
      key: 'getCityBuffer.not_your_city',
    });
  });

  it("returns [now, the city's live buffers]", async () => {
    const bufs = [{ cid: 209355, buftype: 1, bufparam: 6, endtime: NOW + 100 }];
    const { cmd } = build([
      { match: /select uid from sys_city where cid = \?/, params: [209355], rows: [{ uid: 1001 }] },
      { match: /select unix_timestamp\(\) as t/, rows: [{ t: NOW }] },
      { match: /select \* from mem_city_buffer/, rows: bufs },
      NO(/.*/),
    ]);
    expect(await cmd.getTrickBuffer(ctx, [209355])).toEqual([NOW, bufs]);
  });
});

describe('TrickCommands.useTrick prevalidation', () => {
  it('rejects an unknown trick', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.useTrick(ctx, [80213, 99, 0, 0])).rejects.toMatchObject({
      key: 'useTrick.trick_not_exist',
    });
  });

  it('rejects a usetype mismatch', async () => {
    const { cmd } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [TRICK_1] },
      NO(/.*/),
    ]);
    // 草木皆兵 is usetype 0; tricktype 1 does not match.
    await expect(cmd.useTrick(ctx, [80213, 1, 1, 300411])).rejects.toMatchObject({
      key: 'useTrick.trick_not_exist',
    });
  });

  it('throws the raw not_enough_goods13#N 锦囊 error', async () => {
    const { cmd } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [{ ...TRICK_1, cost: 3 }] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 2 }] },
      NO(/.*/),
    ]);
    const err = await cmd.useTrick(ctx, [80213, 1, 0, 0]).catch((e) => e);
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBeNull();
    expect(err.message).toBe('not_enough_goods13#1');
  });

  it('rejects an unknown hero and an out-of-city hero', async () => {
    const { cmd } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [TRICK_1] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
      NO(/.*/),
    ]);
    await expect(cmd.useTrick(ctx, [80213, 1, 0, 0])).rejects.toMatchObject({
      key: 'useTrick.hero_not_exist',
    });

    const { cmd: cmd2 } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [TRICK_1] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
      {
        match: /select \* from sys_city_hero where hid = \?/,
        rows: [{ hid: 80213, state: 2, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd2.useTrick(ctx, [80213, 1, 0, 0])).rejects.toMatchObject({
      key: 'useTrick.hero_not_incity',
    });
  });

  it('rejects tricktype 1 on own / union / vacationing targets', async () => {
    const base: Respond[] = [
      { match: /select \* from cfg_trick where id = \?/, rows: [{ ...TRICK_1, usetype: 1 }] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
      {
        match: /select \* from sys_city_hero where hid = \?/,
        rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
      },
    ];
    const targetUser = (uid: number, unionId: number): Respond => ({
      match: /select \* from sys_user[\s\S]*where uid = \(select uid from sys_city/,
      params: [300411],
      rows: [{ uid, union_id: unionId }],
    });
    const myUnion = (unionId: number): Respond => ({
      match: /select union_id from sys_user where uid = \?/,
      rows: [{ union_id: unionId }],
    });

    // 自己的城
    const mine = build([...base, targetUser(1001, 0), myUnion(0), NO(/.*/)]);
    await expect(mine.cmd.useTrick(ctx, [80213, 1, 1, 300411])).rejects.toMatchObject({
      key: 'useTrick.target_is_mine',
    });

    // 盟友的城
    const union = build([...base, targetUser(1002, 7), myUnion(7), NO(/.*/)]);
    await expect(union.cmd.useTrick(ctx, [80213, 1, 1, 300411])).rejects.toMatchObject({
      key: 'useTrick.target_is_union',
    });

    // 休假中
    const vacation = build([
      ...base,
      targetUser(1002, 0),
      myUnion(0),
      {
        match: /select vacend from sys_user_state/,
        rows: [{ vacend: NOW + 1000 }],
      },
      NO(/.*/),
    ]);
    await expect(vacation.cmd.useTrick(ctx, [80213, 1, 1, 300411])).rejects.toMatchObject({
      key: 'useTrick.target_in_vacation',
    });

    // 被锁定
    const locked = build([
      ...base,
      targetUser(1002, 0),
      myUnion(0),
      { match: /select vacend from sys_user_state/, rows: [] },
      { match: /select forbiend from sys_user_state/, rows: [{ forbiend: NOW + 1000 }] },
      NO(/.*/),
    ]);
    await expect(locked.cmd.useTrick(ctx, [80213, 1, 1, 300411])).rejects.toMatchObject({
      key: 'useTrick.target_be_locked',
    });
  });

  it('rejects usetype 2 on a foreign or heroless troop', async () => {
    const base: Respond[] = [
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
      {
        match: /select \* from sys_city_hero where hid = \?/,
        rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
      },
    ];
    const notMine = build([
      ...base,
      { match: /select \* from cfg_trick where id = \?/, rows: [{ ...TRICK_1, usetype: 2 }] },
      { match: /select \* from sys_troops where id = \?/, rows: [{ id: 5, uid: 1002, hid: 7 }] },
      NO(/.*/),
    ]);
    await expect(notMine.cmd.useTrick(ctx, [80213, 1, 2, 5])).rejects.toMatchObject({
      key: 'useTrick.target_is_not_my_troop',
    });

    const noHero = build([
      ...base,
      { match: /select \* from cfg_trick where id = \?/, rows: [{ ...TRICK_1, usetype: 2 }] },
      { match: /select \* from sys_troops where id = \?/, rows: [{ id: 5, uid: 1001, hid: 0 }] },
      NO(/.*/),
    ]);
    await expect(noHero.cmd.useTrick(ctx, [80213, 1, 2, 5])).rejects.toMatchObject({
      key: 'useTrick.target_has_no_hero',
    });
  });

  it('rejects 金蝉脱壳 within an hour of the last one', async () => {
    const { cmd } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [{ id: 10, usetype: 2, cost: 8 }] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 50 }] },
      {
        match: /select \* from sys_city_hero where hid = \?/,
        rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
      },
      {
        match: /select \* from sys_troops where id = \?/,
        rows: [{ id: 5, uid: 1001, hid: 80213, state: 0, lastrun: NOW - 100 }],
      },
      { match: /select unix_timestamp\(\) as t/, rows: [{ t: NOW }] },
      NO(/.*/),
    ]);
    const err = await cmd.useTrick(ctx, [80213, 10, 2, 5]).catch((e) => e);
    expect(err.key).toBe('useTrick.target_is_just_run');
    expect(lang.messageOf(err)).toBe(
      '你刚刚对该军队使用过“金蝉脱壳”，58分钟20秒后才能再次对该军队使用。',
    );
  });

  it('rejects when the hero has no energy left', async () => {
    const { cmd } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [TRICK_1] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
      {
        match: /select \* from sys_city_hero where hid = \?/,
        rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
      },
      { match: /select energy from mem_hero_blood where hid = \?/, rows: [] },
      NO(/.*/),
    ]);
    await expect(cmd.useTrick(ctx, [80213, 1, 0, 0])).rejects.toMatchObject({
      key: 'useTrick.hero_no_energy',
    });
  });
});

describe('TrickCommands.useTrick 草木皆兵 (1)', () => {
  const happy: Respond[] = [
    { match: /select \* from cfg_trick where id = \?/, rows: [TRICK_1] },
    { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 5 }] },
    {
      match: /select \* from sys_city_hero where hid = \?/,
      rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 5 }],
    },
    { match: /select energy from mem_hero_blood where hid = \?/, rows: [{ energy: 100 }] },
    // lastcid → target city (own), its owner reads back as the caller.
    { match: /select lastcid from sys_user where uid = \?/, rows: [{ lastcid: 209355 }] },
    { match: /select uid from sys_city where cid = \?/, rows: [{ uid: 1001 }] },
    {
      match: /select endtime from mem_city_buffer/,
      rows: [{ endtime: NOW + 57000 }],
    },
    { match: /select from_unixtime/, rows: [{ t: '2027年1月15日 23:00:00' }] },
    TASK_GOAL_RULE,
    TASK_GOAL_TID_RULE,
    OPEN_TASK_RULE,
    NO(/.*/),
  ];

  it('writes buftype 1 with the scripted rate and completes goal + task 88 + log 1001', async () => {
    const { cmd, db, scripted } = build(happy);
    // mt_rand(5,10) with draw 7 → 5 + (7 % 6) = 6.
    const res = (await scripted.run(sequenceSource([7]), () =>
      cmd.useTrick(ctx, [80213, 1, 0, 0]),
    )) as unknown[];
    expect(res[0]).toBe(
      '“草木皆兵”用计成功。该城池被侦察时将显示军队人数为真实的6倍，效果将持续到2027年1月15日 23:00:00。',
    );
    expect(res[1]).toBe(5);

    // wisdom = (90+0)+5 add_on = 95 → delay 95*600 = 57000；buftype 1 是模板字面量。
    const insert = db.executed.find((q) => /insert into mem_city_buffer/.test(q.sql));
    expect(insert!.sql).toContain('values (?, 1, ?, unix_timestamp() + ?)');
    expect(insert!.parameters.slice(0, 3)).toEqual([209355, 6, 57000]);
    const goals = db.executed.filter((q) => /replace into sys_user_goal/.test(q.sql));
    expect(goals.map((q) => q.parameters.slice(0, 2))).toEqual([
      [1001, 5551],
      [1001, 88],
    ]);
    const log = db.executed.find((q) => /insert into log_user_action/.test(q.sql));
    expect(log!.parameters[0]).toBe(1001);
    expect(log!.parameters[1]).toBe(1001); // trickid 1 + 1000
    const energy = db.executed.find((q) => /update mem_hero_blood/.test(q.sql));
    expect(energy!.parameters[0]).toBe(1);
  });
});

describe('TrickCommands.useTrick 妖言惑众 (6)', () => {
  const base: Respond[] = [
    { match: /select \* from cfg_trick where id = \?/, rows: [{ id: 6, usetype: 1, cost: 15 }] },
    { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 50 }] },
    {
      match: /select \* from sys_city_hero where hid = \?/,
      rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
    },
    { match: /select energy from mem_hero_blood where hid = \?/, rows: [{ energy: 100 }] },
    {
      match: /select \* from sys_user where uid = \(select uid from sys_city/,
      params: [300411],
      rows: [{ uid: 1002, union_id: 0 }],
    },
    { match: /select union_id from sys_user where uid = \?/, rows: [{ union_id: 0 }] },
    { match: /select vacend from sys_user_state/, rows: [] },
    { match: /select forbiend from sys_user_state/, rows: [] },
    { match: /select name from sys_city where cid = \?/, rows: [{ name: '敌城' }] },
    {
      match: /select name, lastcid from sys_user where uid = \?/,
      rows: [{ name: '君主', lastcid: 209355 }],
    },
  ];

  it('returns the fail text within the 24h window and still completes task 88', async () => {
    const { cmd, db } = build([
      ...base,
      {
        match: /unix_timestamp\(\) - last_trick_morale as t/,
        rows: [{ t: 100 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.useTrick(ctx, [80213, 6, 1, 300411])) as unknown[];
    expect(res[0]).toContain('“妖言惑众”用计失败');
    // 报警报给守方
    const alarm = db.executed.find((q) => /insert into sys_report/.test(q.sql));
    expect(alarm).toBeDefined();
    expect(String(alarm!.parameters.at(-1))).toContain('雕虫小技也敢献丑');
    // 没有动民心
    expect(db.executed.some((q) => /update mem_city_resource/.test(q.sql))).toBe(false);
  });

  it('cuts morale by ceil(wisdom/10) capped at the city stock and files both reports', async () => {
    const { cmd, db } = build([
      ...base,
      { match: /unix_timestamp\(\) - last_trick_morale as t/, rows: [{ t: 86401 }] },
      { match: /select morale from mem_city_resource/, rows: [{ morale: 85 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.useTrick(ctx, [80213, 6, 1, 300411])) as unknown[];
    expect(res[0]).toBe('“妖言惑众”用计成功。\n敌城(411,300)民心-9。');
    const morale = db.executed.filter((q) => /update mem_city_resource/.test(q.sql));
    expect(morale.length).toBe(2);
    expect(morale[0]!.parameters[0]).toBe(9);
    const alarm = db.executed.find((q) => /insert into sys_report/.test(q.sql));
    expect(String(alarm!.parameters.at(-1))).toContain('我方中计了');
  });
});

describe('TrickCommands.useTrick 挑拨离间 (7)', () => {
  const base: Respond[] = [
    { match: /select \* from cfg_trick where id = \?/, rows: [{ id: 7, usetype: 1, cost: 20 }] },
    { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 50 }] },
    {
      match: /select \* from sys_city_hero where hid = \?/,
      rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
    },
    { match: /select energy from mem_hero_blood where hid = \?/, rows: [{ energy: 100 }] },
    {
      match: /select \* from sys_user where uid = \(select uid from sys_city/,
      params: [300411],
      rows: [{ uid: 1002, union_id: 0 }],
    },
    { match: /select union_id from sys_user where uid = \?/, rows: [{ union_id: 0 }] },
    { match: /select vacend from sys_user_state/, rows: [] },
    { match: /select forbiend from sys_user_state/, rows: [] },
    { match: /select name from sys_city where cid = \?/, rows: [{ name: '敌城' }] },
    {
      match: /select name, lastcid from sys_user where uid = \?/,
      rows: [{ name: '君主', lastcid: 209355 }],
    },
  ];

  it('fails without an in-city hero and still completes the goal', async () => {
    const { cmd, db } = build([
      ...base,
      { match: /select \* from sys_city_hero[\s\S]*order by rand\(\) limit 1/, rows: [] },
      TASK_GOAL_RULE,
      TASK_GOAL_TID_RULE,
      OPEN_TASK_RULE,
      NO(/.*/),
    ]);
    // 城中没有候选将领，不掷骰子。
    const res = (await cmd.useTrick(ctx, [80213, 7, 1, 300411])) as unknown[];
    expect(res[0]).toBe('对方城中没有将领，白费功夫。');
    expect(db.executed.some((q) => /update sys_city_hero set loyalty/.test(q.sql))).toBe(false);
  });

  it('cuts the picked hero loyalty by ceil(wisdom/10) when the roll holds', async () => {
    const { cmd, db, scripted } = build([
      ...base,
      {
        match: /select \* from sys_city_hero[\s\S]*order by rand\(\) limit 1/,
        rows: [{ hid: 9001, name: '张三', state: 0, wisdom_base: 50, wisdom_add: 0, loyalty: 80 }],
      },
      { match: /select last_trick from mem_hero_schedule/, rows: [{ last_trick: 0 }] },
      { match: /select unix_timestamp\(\) as t/, rows: [{ t: NOW }] },
      TASK_GOAL_RULE,
      TASK_GOAL_TID_RULE,
      OPEN_TASK_RULE,
      NO(/.*/),
    ]);
    // mt_rand(1, 90+50) with draw 0 → 1 ≤ 90 → 中计。
    const res = (await scripted.run(sequenceSource([0]), () =>
      cmd.useTrick(ctx, [80213, 7, 1, 300411]),
    )) as unknown[];
    expect(res[0]).toBe('“挑拨离间”用计成功！\n“张三”忠诚-9。\n');
    const update = db.executed.find((q) => /update sys_city_hero set loyalty/.test(q.sql));
    expect(update!.parameters[0]).toBe(9);
    const schedule = db.executed.find((q) => /insert into mem_hero_schedule/.test(q.sql));
    expect(schedule!.parameters[0]).toBe(9001);
  });

  it('loses when the defender wisdom roll beats the attacker', async () => {
    const { cmd, scripted } = build([
      ...base,
      {
        match: /select \* from sys_city_hero[\s\S]*order by rand\(\) limit 1/,
        rows: [{ hid: 9001, name: '张三', state: 0, wisdom_base: 50, wisdom_add: 0, loyalty: 80 }],
      },
      { match: /select last_trick from mem_hero_schedule/, rows: [{ last_trick: 0 }] },
      { match: /select unix_timestamp\(\) as t/, rows: [{ t: NOW }] },
      TASK_GOAL_RULE,
      TASK_GOAL_TID_RULE,
      OPEN_TASK_RULE,
      NO(/.*/),
    ]);
    // mt_rand(1, 140) with draw 139 → 140 > 90 → 识破。
    const res = (await scripted.run(sequenceSource([139]), () =>
      cmd.useTrick(ctx, [80213, 7, 1, 300411]),
    )) as unknown[];
    expect(res[0]).toBe('用计失败。一山还有一山高，对方智高一筹，轻易识破了我方的计谋。');
  });
});

describe('TrickCommands.useTrick 以逸待劳 (26)', () => {
  it('pins the troop until 2000000000 and completes no sort-53 goal', async () => {
    const { cmd, db } = build([
      { match: /select \* from cfg_trick where id = \?/, rows: [{ id: 26, usetype: 2, cost: 10 }] },
      { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 50 }] },
      {
        match: /select \* from sys_city_hero where hid = \?/,
        rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
      },
      { match: /select energy from mem_hero_blood where hid = \?/, rows: [{ energy: 100 }] },
      {
        match: /select \* from sys_troops where id = \?/,
        rows: [{ id: 5, uid: 1001, hid: 80213, state: 0 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.useTrick(ctx, [80213, 26, 2, 5])) as unknown[];
    expect(res[0]).toBe('“以逸待劳”用计成功！');
    const insert = db.executed.find((q) => /insert into mem_troops_buffer/.test(q.sql));
    // buftype 26 / bufparam '' / endtime 2000000000 都是模板字面量，只有 troopid 走参数。
    expect(insert!.sql).toContain("values (?, 26, '', 2000000000)");
    expect(insert!.parameters).toEqual([5]);
    // 以逸待劳没有 sort 53 的任务目标。
    expect(db.executed.some((q) => /cfg_task_goal/.test(q.sql))).toBe(false);
    const log = db.executed.find((q) => /insert into log_user_action/.test(q.sql));
    expect(log!.parameters[1]).toBe(1026); // trickid 26 + 1000
  });
});

describe('TrickCommands.useTrick 金蝉脱壳 (10)', () => {
  const base: Respond[] = [
    { match: /select \* from cfg_trick where id = \?/, rows: [{ id: 10, usetype: 2, cost: 8 }] },
    { match: /sum\(count\) as c from sys_goods/, rows: [{ c: 50 }] },
    {
      match: /select \* from sys_city_hero where hid = \?/,
      rows: [{ hid: 80213, state: 0, wisdom_base: 90, wisdom_add: 0, wisdom_add_on: 0 }],
    },
    { match: /select energy from mem_hero_blood where hid = \?/, rows: [{ energy: 100 }] },
    {
      match: /select unix_timestamp\(\) as t/,
      rows: [{ t: NOW }],
    },
    TASK_GOAL_RULE,
    TASK_GOAL_TID_RULE,
    OPEN_TASK_RULE,
  ];
  const troop = { id: 5, uid: 1001, hid: 80213, state: 0, lastrun: NOW - 7200 };

  it('turns a marching troop around and shortens the return by wisdom minutes', async () => {
    const { cmd, db } = build([
      ...base,
      { match: /select \* from sys_troops where id = \?/, rows: [troop] },
      NO(/.*/),
    ]);
    const res = (await cmd.useTrick(ctx, [80213, 10, 2, 5])) as unknown[];
    expect(res[0]).toBe('“金蝉脱壳”用计成功！\n我方军队正在快速返回。');
    const updates = db.executed.filter((q) => /update sys_troops/.test(q.sql));
    expect(updates.length).toBe(2);
    expect(updates[0]!.sql).toContain('`state` = 1');
    expect(updates[1]!.parameters[0]).toBe(5400); // wisdom*60 = 90*60
  });
});
