import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { COMMAND_HANDLER } from '../gateway/decorators';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRewards } from '../task/task-rewards.service';
import { LoginActivityCommands } from './login-activity.commands';
import { LoginActivityModule } from './login-activity.module';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const lang = new LangService({
  dailySign: {
    do_sign: 'already',
    do_sign_2: 'wait ',
    do_sign_3: ' please',
    get_reward_1: 'signed ',
    get_reward_2: 'reward ',
  },
  MakeTimeLeft: { hour: 'h', min: 'm', sec: 's' },
});
const date: Respond = {
  match: /select date_format/,
  rows: [{ year: '26', month: '11', day: '07', weekday: '6' }],
};

function build(rules: Respond[] = []) {
  const db = new FakeDb([date, ...rules]);
  const goods = { addGoods: vi.fn(async () => {}) };
  const tasks = { completeTaskWithTaskid: vi.fn(async () => {}) };
  const rewards = { giveReward: vi.fn(async () => '') };
  const scripted = new ScriptedRandom();
  const cmd = new LoginActivityCommands(
    db.scope,
    lang,
    goods as unknown as GoodsRules,
    tasks as unknown as TaskRules,
    rewards as unknown as TaskRewards,
    new RandomService(scripted),
  );
  return { db, cmd, goods, tasks, rewards, scripted };
}

const signRules: Respond[] = [
  { match: /select unix_timestamp\(\) - time/, rows: [{ v: '901' }] },
  { match: /select name as v from cfg_goods/, rows: [{ v: '孙子兵法' }] },
  { match: /select lastcid/, rows: [{ v: '42' }] },
  { match: /select nobility/, rows: [{ v: '1' }] },
  { match: /select id as v from sys_user_sign where uid/, rows: [{ v: '99' }] },
];

describe('W8 login/activity compatibility', () => {
  it('registers the independent module and all fourteen global commands', () => {
    expect(Reflect.getMetadata('providers', LoginActivityModule)).toContain(LoginActivityCommands);
    const names = Object.getOwnPropertyNames(LoginActivityCommands.prototype).filter((name) =>
      Reflect.getMetadata(
        COMMAND_HANDLER,
        LoginActivityCommands.prototype[name as keyof LoginActivityCommands] as object,
      ),
    );
    expect(names.sort()).toEqual(
      [
        'getLoginInfo',
        'finishOpenAnnounce',
        'getLoginReward',
        'doSign',
        'getSignState',
        'getActivityList',
        'getCraftBuffer',
        'getHuangJinProgress',
        'getDongZhuoProgress',
        'getAllHeroList',
        'getCrossShaChangInfo',
        'getCrossShaChangReward',
        'joinCrossShaChang',
        'sendCloseMsg',
      ].sort(),
    );
    for (const name of names)
      expect(
        Reflect.getMetadata(
          COMMAND_HANDLER,
          LoginActivityCommands.prototype[name as keyof LoginActivityCommands] as object,
        ).kind,
      ).toBe('global');
  });

  it('returns announcement rows followed by sign state and patches only the first alarm flag', async () => {
    const history = [{ day: '1107', state: '4' }];
    const { cmd } = build([
      { match: /sys_login_announce/, rows: [{ id: '1', content: 'welcome' }] },
      { match: /sys_alarm/, rows: [{ enemy: '1' }] },
      { match: /limit 21/, rows: history },
    ]);
    expect(await cmd.getLoginInfo(ctx)).toEqual([
      { id: '1', content: 'welcome', newestreport: 1 },
      [['26', '11', '07', '6'], history],
    ]);
    expect(await build().cmd.getLoginInfo(ctx)).toEqual([
      { newestreport: 0 },
      [['26', '11', '07', '6'], []],
    ]);
  });

  it('completes task 292 and keeps disabled reward/VIP commands null without SQL', async () => {
    const { cmd, db, tasks, goods } = build();
    expect(cmd.getLoginReward()).toBeNull();
    expect(cmd.sendCloseMsg()).toBeNull();
    expect(await cmd.finishOpenAnnounce(ctx)).toBeNull();
    expect(tasks.completeTaskWithTaskid).toHaveBeenCalledWith(1001, 292);
    expect(goods.addGoods).not.toHaveBeenCalled();
    expect(db.executed).toEqual([]);
  });

  it('rejects repeat signs before login-time checks (month/day comparison ignores year)', async () => {
    const { cmd, db } = build([{ match: /select count\(1\)/, rows: [{ v: '1' }] }]);
    await expect(cmd.doSign(ctx)).rejects.toMatchObject({ key: 'dailySign.do_sign' });
    expect(db.executed).toHaveLength(1);
    expect(db.executed[0]!.sql).toContain("'%m%d'");
  });

  it.each([900, 0])('requires strictly more than 900 seconds, span=%s', async (span) => {
    const { cmd, goods } = build([
      { match: /select unix_timestamp\(\) - time/, rows: [{ v: span }] },
    ]);
    await expect(cmd.doSign(ctx)).rejects.toMatchObject({ key: null });
    expect(goods.addGoods).not.toHaveBeenCalled();
  });

  it('treats missing login as zero elapsed seconds', async () => {
    await expect(build().cmd.doSign(ctx)).rejects.toMatchObject({ message: 'wait 15m0s please' });
  });

  it('grants exactly three books, returns nested state, writes a 1..7 sign flag', async () => {
    const { cmd, goods, db, scripted } = build(signRules);
    const ret = await scripted.run(sequenceSource([6]), () => cmd.doSign(ctx));
    expect(ret).toEqual(['signed reward [ 孙子兵法*3 ]', [['26', '11', '07', '6'], []]]);
    expect(goods.addGoods).toHaveBeenCalledExactlyOnceWith(1001, 10961, 3, 70);
    expect(db.executed.find((q) => /update sys_user_sign/.test(q.sql))?.parameters).toEqual([
      7,
      1001,
      '99',
    ]);
  });

  it('preserves old-record month-boundary cleanup and stops at the first gap', async () => {
    const { cmd, db } = build([
      ...signRules,
      { match: /where time < unix_timestamp/, rows: [{ v: 10 }] },
      {
        match: /as signyear/,
        rows: [
          { id: 10, signyear: '2026', signmonth: '10', signday: '01' },
          { id: 11, signyear: '2026', signmonth: '11', signday: '30' },
          { id: 12, signyear: '2026', signmonth: '11', signday: '29' },
          { id: 13, signyear: '2026', signmonth: '11', signday: '27' },
        ],
      },
    ]);
    await cmd.doSign(ctx);
    expect(
      db.executed.filter((q) => /delete from sys_user_sign/.test(q.sql)).map((q) => q.parameters),
    ).toEqual([[11], [12], [10]]);
  });

  it('uses strict elapsed/rate comparisons and default reward log reasons for sign drops', async () => {
    const drop = { param: '900', rate: '100', name: '活动礼', sort: '2', type: '5', count: '1' };
    const { cmd, rewards, scripted } = build([
      ...signRules,
      { match: /select cfg_act_task_good_drop/, rows: [drop, { ...drop, param: '901' }] },
      { match: /where actid = 0/, rows: [{ ...drop, param: '0', rate: '1' }] },
    ]);
    const ret = await scripted.run(sequenceSource([0]), () => cmd.doSign(ctx));
    expect(rewards.giveReward).toHaveBeenCalledExactlyOnceWith(1001, '42', drop);
    expect(ret[0]).toBe('signed reward [ 孙子兵法*3   活动礼]');
  });

  it('omits activity drops below nobility one', async () => {
    const { cmd, db } = build([{ match: /select nobility/, rows: [{ v: 0 }] }, ...signRules]);
    await cmd.doSign(ctx);
    expect(db.executed.some((q) => /cfg_act_task_good_drop/.test(q.sql))).toBe(false);
  });

  it('lists active activity rows in id order', async () => {
    const activity = { content: '活动', link: '100', interval: '30' };
    const { cmd, db } = build([{ match: /from sys_activity/, rows: [activity] }]);
    expect(await cmd.getActivityList()).toEqual([activity]);
    expect(db.executed[0]!.sql).toContain('where inuse = 1 order by id');
  });

  it('keeps buffer exclusions, splice-skip quirk and appends the union leader buff', async () => {
    const own = [{ buftype: '161501' }, { buftype: '161501', id: 'skipped' }, { buftype: '9' }];
    const union = { uid: '2000', buftype: '161501' };
    const { cmd, db } = build([
      { match: /select unix_timestamp\(\) as v/, rows: [{ v: '123' }] },
      { match: /not in/, rows: own },
      { match: /select union_id/, rows: [{ v: '5' }] },
      { match: /select leader/, rows: [{ v: '2000' }] },
      { match: /and buftype = 161501/, rows: [union] },
    ]);
    expect(await cmd.getCraftBuffer(ctx)).toEqual([
      '123',
      [{ buftype: '161501', id: 'skipped' }, { buftype: '9' }, union],
    ]);
    expect(db.executed.find((q) => /not in/.test(q.sql))!.sql).toContain('(8, 23, 10321, 130527)');
  });

  it('maps every progress tab, PHP-coerces input and returns null for unsupported tabs', async () => {
    const { cmd, db } = build();
    for (let i = 0; i < 4; i++) await cmd.getHuangJinProgress(ctx, [i]);
    for (let i = 0; i < 6; i++) await cmd.getDongZhuoProgress(ctx, [i]);
    expect(db.executed.map((q) => q.parameters[0])).toEqual([
      11000, 12000, 13000, 14000, 15000, 15100, 15200, 15300, 15400, 15500,
    ]);
    expect(await cmd.getDongZhuoProgress(ctx, [6])).toBeNull();
    expect(await cmd.getHuangJinProgress(ctx, [-1])).toBeNull();
    await cmd.getHuangJinProgress(ctx, []);
    expect(db.executed.at(-1)!.parameters).toEqual([11000]);
  });

  it('returns nested local hero rows and offline network branches with ownership validation', async () => {
    const { cmd } = build([
      { match: /select hid, name, level/, rows: [{ hid: '7', level: '3' }] },
      { match: /select 1 from sys_city_hero/, params: [7, 1001], rows: [{ 1: 1 }] },
    ]);
    expect(await cmd.getAllHeroList(ctx)).toEqual([[{ hid: '7', level: '3' }]]);
    expect(cmd.getCrossShaChangInfo()).toEqual([{ status: -1 }]);
    expect(() => cmd.getCrossShaChangReward()).toThrow(
      'include(../../server_info.php): failed to open stream: No such file or directory',
    );
    expect(await cmd.joinCrossShaChang(ctx, ['7'])).toEqual([0, 'net_error']);
    await expect(cmd.joinCrossShaChang(ctx, [8])).rejects.toMatchObject({
      key: 'addHeroPoint.cant_find_hero',
    });
  });
});
