import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { TaskRewards } from '../task/task-rewards.service';
import { PkEngine } from './pk-engine';
import { MarryCommands } from './marry.commands';

const lang = new LangService({
  MakeTimeLeft: { hour: '小时', min: '分钟', sec: '秒' },
  marry: {
    vacend_can_not_expr: '休假状态下不能历练',
    king_hero_not_free: '君主将不在空闲状态中',
    not_in_expr: '君主将不在历练中',
    king_has_back: '君主将已经返回',
    reward_not_exist: '历练结果不存在',
    reward_over: '已领取',
    start_expr: '操作成功，君主开始历练',
    become_girlfriend: '%s已成为您的红颜',
    girlfriend_none: '红颜不存在',
    girlfriend_broke_up: '%s:可惜不是你，陪我到最后',
    get_married: '%s与%s喜结连理，大家快去祝福他们吧!',
    lack_gift: '您缺少%s',
    can_not_send_gift: '快去向您的红颜提亲吧，提请不成功不能在继续赠送礼品哦',
  },
  marrySystem: {
    room_num_error: '房间编号出错！',
    room_not_open: '您没有打开当前房间！',
    child_not_exist: '当前孩子不存在！',
    child_has_finish_culture: '当前孩子已经完成培养阶段！',
    core_not_enough: '您的铜钱不足，不能让您的孩子周游列国！',
    throw_child_succ: '您的孩子周游列国成功！',
    can_not_throw: '当前孩子已经成为您的将领，无法周游列国！',
    finish_culture: '已成功完成培养并获得一名将领！',
    modify_name_once: '孩子的名称只能修改一次！',
    chengzhandan_good_not_enough: '您的成长丹数量不够！',
    child_out_inform: '【%s】喜得贵子，大家快去恭喜他吧！',
    child_out_msg: '恭喜您喜得贵子，赶快去教馆培养为他起个霸气响亮的名字吧！',
    not_in_during: '当前将领不处于怀孕期，无法进行胎教！',
    during_has_finish: '怀孕时间已经结束，无需进行胎教！',
    has_speed: '您已经对当前夫人在本次怀孕期间进行过胎教！',
    child_type_error: '您选择的类型出错！',
    madam_not_exist: '当前夫人不存在！',
    only_two_child: '每个夫人只能拥有两个孩子！',
    not_in_during_status: '当前夫人没有怀孕！',
    in_during: '您的夫人目前正在怀孕，无法进行接生！',
    room_not_enough: '您的空余房间不足，孩子无法出生，赶快去为您的孩子准备一个新房间吧！',
    madam_status_error: '夫人的状态出错！',
    madam_favor_full: '当前夫人的好感度已满！',
    madam_in_cooling: '当前夫人正处于产后冷却期，无法赠送物品！',
    add_good_succ: '赠送礼品成功',
    propose_cool: '%s提亲冷却剩余时间还有',
  },
  waigua: { invalid: '数据异常' },
  buyGoods: { no_enough_YuanBao: '你的元宝不足，请充值。' },
  blackMarket: { no_enough_copper: '你的积分不足。' },
  good: { not_enough_goods83: '没有足够的此商品，请先购买' },
  changeHeroName: {
    name_too_long: '将领名太长，不能超过4个字。',
    input_valid_name: '请输入有效的将领名字',
    invalid_char: '不能采用非法的字符串作为将领名。',
  },
  shachange: { change_success: '修改成功' },
  useGoods: { king_cannot_find: '您当前没有君主将' },
});

const NOW = 1_800_000_000;
const UID = 1001;
const ctx = { uid: UID, cid: 209355, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });
const CATCH_ALL = NO(/[\s\S]*/);
const CLOCK: Respond = {
  match: /^select unix_timestamp\(\)$/,
  rows: [{ 'unix_timestamp()': NOW }],
};
const LAST_ID = (id: number): Respond => ({
  match: /select last_insert_id\(\)/,
  rows: [{ 'last_insert_id()': id }],
});
const VACEND: Respond = { match: /select vacend from sys_user_state/, rows: [] };
const KING_HERO_ROW: Respond = {
  match: /select state, hid, cid from sys_city_hero/,
  rows: [{ state: 0, hid: 80213, cid: 209355 }],
};
const KING_EXPR_INFO: Respond = {
  match: /from sys_city_hero a left join sys_king_expr b/,
  rows: [{ state: 10, nowtime: NOW }],
};
const VIVIFY: Respond = { match: /insert into sys_user_marry \(uid\)/, rows: [] };
const ROOMCOUNT = (count: unknown): Respond => ({
  match: /select roomcount from sys_user_marry/,
  rows: [{ roomcount: count }],
});
const CHILD_COUNT = (count: unknown): Respond => ({
  match: /select count\(1\) from sys_user_child/,
  rows: [{ 'count(1)': count }],
});
const NEXT_GOOD = (name: string, count: unknown): Respond => ({
  match: /select c\.name, ifnull\(s\.count, 0\) as count/,
  rows: [{ name, count }],
});
const CHILDREN = (rows: Record<string, unknown>[]): Respond => ({
  match: /from sys_user_child s, mem_marry_relation m/,
  rows,
});
const SYS_GOODS_PAY: Respond = { match: /insert into sys_goods \(uid, gid, count\)/, rows: [] };
const LOG_GOODS: Respond = { match: /insert into `log_goods`/, rows: [] };
const GOODS_DEDUCT: Respond = { match: /update sys_goods set count = greatest/, rows: [] };
const LOG_MONEY: Respond = { match: /insert into log_money \(/, rows: [] };
const MONEY_UPDATE: Respond = { match: /update sys_user set money = money \+/, rows: [] };
const LOG_DAY_MONEY: Respond = { match: /insert into log_day_money/, rows: [] };
const SYS_INFORM: Respond = { match: /insert into `sys_inform`/, rows: [] };
const USER_NAME = (name: string): Respond => ({
  match: /select name from sys_user where uid = \?/,
  rows: [{ name }],
});

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const scope = db.scope;
  const cities = new CityRules(scope);
  const heroes = new HeroRules(scope);
  const goods = new GoodsRules(scope);
  const users = new UserRules(scope);
  const rewards = new TaskRewards(
    scope,
    lang,
    cities,
    goods,
    heroes,
    users,
    new RandomService(new ScriptedRandom()),
  );
  const scripted = new ScriptedRandom();
  const random = new RandomService(scripted);
  const cmd = new MarryCommands(scope, lang, goods, rewards, users, random, new PkEngine(random));
  return { cmd, db, scripted };
}

describe('MarryCommands 君主历练', () => {
  it('loadMarryKingExpr/loadMarryInfo return the expr row of the herotype-1000 hero', async () => {
    const expr = { state: 0, nowtime: NOW, starttime: NOW - 60, endtime: NOW + 60 };
    const { cmd } = build([{ match: KING_EXPR_INFO.match, rows: [expr] }, CATCH_ALL]);
    expect(await cmd.loadMarryKingExpr(ctx)).toEqual([expr]);
    const info = (await cmd.loadMarryInfo(ctx)) as unknown[];
    expect(info[0]).toEqual(expr);
    expect(info[1]).toEqual([]);
  });

  it('beginKingExpr rejects hours outside 1..8, vacation and busy/missing king heroes', async () => {
    const { cmd } = build([CLOCK, CATCH_ALL]);
    await expect(cmd.beginKingExpr(ctx, [0])).rejects.toMatchObject({ key: 'waigua.invalid' });
    await expect(cmd.beginKingExpr(ctx, [9])).rejects.toMatchObject({ key: 'waigua.invalid' });
    const onVac = build([CLOCK, { match: VACEND.match, rows: [{ vacend: NOW + 1 }] }, CATCH_ALL]);
    await expect(onVac.cmd.beginKingExpr(ctx, [2])).rejects.toMatchObject({
      key: 'marry.vacend_can_not_expr',
    });
    const busy = build([
      CLOCK,
      VACEND,
      { match: KING_HERO_ROW.match, rows: [{ state: 2, hid: 80213, cid: 209355 }] },
      CATCH_ALL,
    ]);
    await expect(busy.cmd.beginKingExpr(ctx, [2])).rejects.toMatchObject({
      key: 'marry.king_hero_not_free',
    });
    const noKing = build([CLOCK, VACEND, { match: KING_HERO_ROW.match, rows: [] }, CATCH_ALL]);
    await expect(noKing.cmd.beginKingExpr(ctx, [2])).rejects.toMatchObject({
      key: 'useGoods.king_cannot_find',
    });
  });

  it('beginKingExpr queues the expr and flags the hero state 10', async () => {
    const { cmd, db } = build([
      CLOCK,
      VACEND,
      KING_HERO_ROW,
      { match: /insert into log_user_action \(/, rows: [] },
      { match: /insert into log_action_count/, rows: [] },
      { match: /insert into sys_king_expr \(uid, cid, hid/, rows: [] },
      { match: /update sys_city_hero set state = 10/, rows: [] },
      KING_EXPR_INFO,
      CATCH_ALL,
    ]);
    const res = (await cmd.beginKingExpr(ctx, [2])) as unknown[];
    expect(res[0]).toBe('操作成功，君主开始历练');
    const insert = db.executed.find((q) =>
      /insert into sys_king_expr \(uid, cid, hid/.test(q.sql),
    )!;
    expect(insert.parameters).toEqual([UID, 209355, 80213, 2, 2]);
    expect(db.executed.some((q) => /update sys_city_hero set state = 10/.test(q.sql))).toBe(true);
  });

  it('fasterKingExpr: 拜帖 cuts 30% (at least 30min) off a running expr', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_king_expr where uid = \?/,
        rows: [{ uid: UID, hid: 80213, state: 0, endtime: NOW + 20000, accTimes: 0 }],
      },
      CLOCK,
      { match: /select count from sys_goods\s+where uid = \? and gid = \?/, rows: [{ count: 1 }] },
      LOG_GOODS,
      GOODS_DEDUCT,
      { match: /update sys_king_expr set endtime/, rows: [] },
      KING_EXPR_INFO,
      CATCH_ALL,
    ]);
    await cmd.fasterKingExpr(ctx);
    const update = db.executed.find((q) => /update sys_king_expr set endtime/.test(q.sql))!;
    // floor(20000*0.3)=6000 > 1800 → endtime -= 6000
    expect(update.parameters).toEqual([NOW + 20000 - 6000, 80213]);
    const reduce = db.executed.find((q) => GOODS_DEDUCT.match.test(q.sql))!;
    expect(reduce.parameters).toEqual([1, UID, 12060]);

    const floorCap = build([
      {
        match: /select \* from sys_king_expr where uid = \?/,
        rows: [{ uid: UID, hid: 80213, state: 0, endtime: NOW + 6000, accTimes: 0 }],
      },
      CLOCK,
      { match: /select count from sys_goods\s+where uid = \? and gid = \?/, rows: [{ count: 1 }] },
      LOG_GOODS,
      GOODS_DEDUCT,
      { match: /update sys_king_expr set endtime/, rows: [] },
      KING_EXPR_INFO,
      CATCH_ALL,
    ]);
    await floorCap.cmd.fasterKingExpr(ctx);
    // floor(6000*0.3)=1800 is not > 1800 → the 1800 floor applies
    expect(
      floorCap.db.executed.find((q) => /update sys_king_expr set endtime/.test(q.sql))!.parameters,
    ).toEqual([NOW + 6000 - 1800, 80213]);
  });

  it('fasterKingExpr: needs the 拜帖, ends a returning expr with 鸿雁飞书', async () => {
    const none = build([
      {
        match: /select \* from sys_king_expr where uid = \?/,
        rows: [{ uid: UID, hid: 80213, state: 0, endtime: NOW + 20000 }],
      },
      CLOCK,
      NO(/select count from sys_goods/),
      CATCH_ALL,
    ]);
    await expect(none.cmd.fasterKingExpr(ctx)).rejects.toMatchObject({
      message: 'not_enough_goods12060',
    });

    const { cmd, db } = build([
      {
        match: /select \* from sys_king_expr where uid = \?/,
        rows: [{ uid: UID, hid: 80213, state: 1, endtime: NOW + 20000 }],
      },
      CLOCK,
      { match: /select count from sys_goods\s+where uid = \? and gid = \?/, rows: [{ count: 1 }] },
      LOG_GOODS,
      GOODS_DEDUCT,
      { match: /delete from sys_king_expr where hid/, rows: [] },
      { match: /update sys_city_hero set state = '0'/, rows: [] },
      KING_EXPR_INFO,
      CATCH_ALL,
    ]);
    await cmd.fasterKingExpr(ctx);
    expect(db.executed.some((q) => /delete from sys_king_expr where hid/.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /update sys_city_hero set state = '0'/.test(q.sql))).toBe(true);
    expect(db.executed.find((q) => GOODS_DEDUCT.match.test(q.sql))!.parameters).toEqual([
      1,
      UID,
      12061,
    ]);
  });

  it('cancelKingExpr: only from state 0, counts the action back and flags state 1/11', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_king_expr where uid = \?/,
        rows: [{ uid: UID, hid: 80213, state: 0, starttime: NOW - 100, hours: 2 }],
      },
      { match: /insert into log_user_action \(/, rows: [] },
      { match: /insert into log_action_count/, rows: [] },
      { match: /update sys_king_expr set state = 1/, rows: [] },
      { match: /update sys_city_hero set state = 11/, rows: [] },
      KING_EXPR_INFO,
      CATCH_ALL,
    ]);
    await cmd.cancelKingExpr(ctx);
    expect(
      db.executed.some(
        (q) => /on duplicate key update count = count - 1/.test(q.sql) && q.parameters[0] === UID,
      ),
    ).toBe(true);
    expect(db.executed.some((q) => /update sys_king_expr set state = 1/.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /update sys_city_hero set state = 11/.test(q.sql))).toBe(true);

    const returning = build([
      {
        match: /select \* from sys_king_expr where uid = \?/,
        rows: [{ uid: UID, hid: 80213, state: 1 }],
      },
      CATCH_ALL,
    ]);
    await expect(returning.cmd.cancelKingExpr(ctx)).rejects.toMatchObject({
      key: 'marry.not_in_expr',
    });
  });
});

describe('MarryCommands 红缘', () => {
  it('finishMeetWife guards reward state and roses, then gifts the roses and throws the success text', async () => {
    const missing = build([NO(/sys_king_expr_reward/), CATCH_ALL]);
    await expect(missing.cmd.finishMeetWife(ctx, [5])).rejects.toMatchObject({
      key: 'marry.reward_not_exist',
    });
    const claimed = build([
      { match: /select \* from sys_king_expr_reward/, rows: [{ id: 5, hid: 7, getFlag: 1 }] },
      CATCH_ALL,
    ]);
    await expect(claimed.cmd.finishMeetWife(ctx, [5])).rejects.toMatchObject({
      key: 'marry.reward_over',
    });
    const noRose = build([
      { match: /select \* from sys_king_expr_reward/, rows: [{ id: 5, hid: 7, getFlag: 0 }] },
      { match: /select count from cfg_marry_mother_hero/, rows: [{ count: 3 }] },
      NO(/select `count` from sys_goods/),
      CATCH_ALL,
    ]);
    await expect(noRose.cmd.finishMeetWife(ctx, [5])).rejects.toMatchObject({
      key: 'good.not_enough_goods83',
    });

    const { cmd, db } = build([
      { match: /select \* from sys_king_expr_reward/, rows: [{ id: 5, hid: 7, getFlag: 0 }] },
      { match: /select count from cfg_marry_mother_hero/, rows: [{ count: 3 }] },
      { match: /select `count` from sys_goods/, rows: [{ count: 5 }] },
      { match: /insert into mem_marry_hero_favor \(uid, hid, favor/, rows: [] },
      { match: /update sys_king_expr_reward set getFlag/, rows: [] },
      LOG_GOODS,
      GOODS_DEDUCT,
      USER_NAME('长乐'),
      { match: /select name from cfg_marry_mother_hero where hid = \?/, rows: [{ name: '貂蝉' }] },
      SYS_INFORM,
      CATCH_ALL,
    ]);
    await expect(cmd.finishMeetWife(ctx, [5])).rejects.toSatisfy((err: GameError) => {
      expect(err).toBeInstanceOf(GameError);
      expect(err.key).toBe('marry.become_girlfriend');
      expect(lang.messageOf(err)).toBe('貂蝉已成为您的红颜');
      return true;
    });
    expect(
      db.executed.find((q) => /insert into mem_marry_hero_favor \(uid, hid, favor/.test(q.sql))!
        .parameters,
    ).toEqual([UID, 7]);
    expect(db.executed.find((q) => GOODS_DEDUCT.match.test(q.sql))!.parameters).toEqual([
      3,
      UID,
      12065,
    ]);
    const inform = db.executed.find((q) => SYS_INFORM.match.test(q.sql))!;
    expect(inform.parameters[7]).toBe(
      '玩家:长乐送上3朵红玫瑰以表爱慕！貂蝉经不住引诱成为其女朋友！！！',
    );
  });

  it('byebye removes state-0 girlfriend rows and answers the farewell', async () => {
    const { cmd, db } = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, state: 0, name: '貂蝉' }],
      },
      { match: /delete from sys_king_expr_reward/, rows: [] },
      { match: /delete from mem_marry_hero_favor/, rows: [] },
      CATCH_ALL,
    ]);
    expect(await cmd.byebye(ctx, [7])).toEqual(['貂蝉:可惜不是你，陪我到最后']);
    expect(db.executed.some((q) => /delete from sys_king_expr_reward/.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /delete from mem_marry_hero_favor/.test(q.sql))).toBe(true);

    const taken = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, state: 1, name: '貂蝉' }],
      },
      CATCH_ALL,
    ]);
    await expect(taken.cmd.byebye(ctx, [7])).rejects.toMatchObject({
      key: 'marry.girlfriend_none',
    });
  });

  it('proposeMarry validates args, favor, cooldown and gift payment', async () => {
    const wrongArgs = build([CATCH_ALL]);
    await expect(wrongArgs.cmd.proposeMarry(ctx, [7])).rejects.toMatchObject({
      key: 'waigua.invalid',
    });
    const lowFavor = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, favor: 49, state: 0, name: '貂蝉' }],
      },
      CATCH_ALL,
    ]);
    await expect(lowFavor.cmd.proposeMarry(ctx, [7, 4])).rejects.toMatchObject({
      key: 'waigua.invalid',
    });
    const cooling = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, favor: 60, state: 0, proposeCoolTime: NOW + 100, name: '貂蝉' }],
      },
      CLOCK,
      CATCH_ALL,
    ]);
    await expect(cooling.cmd.proposeMarry(ctx, [7, 4])).rejects.toMatchObject({
      message: '貂蝉提亲冷却剩余时间还有1分钟40秒',
    });
    const poorGold = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, favor: 60, state: 0, proposeCoolTime: 0, name: '貂蝉' }],
      },
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 665 }] },
      CATCH_ALL,
    ]);
    await expect(poorGold.cmd.proposeMarry(ctx, [7, 1])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_YuanBao',
    });
    const poorCopper = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, favor: 60, state: 0, proposeCoolTime: 0, name: '貂蝉' }],
      },
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 999 }] },
      NO(/gid = '152'/),
      CATCH_ALL,
    ]);
    await expect(poorCopper.cmd.proposeMarry(ctx, [7, 3])).rejects.toMatchObject({
      key: 'blackMarket.no_enough_copper',
    });
    const badType = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [{ uid: UID, hid: 7, favor: 60, state: 0, proposeCoolTime: 0, name: '貂蝉' }],
      },
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 999 }] },
      CATCH_ALL,
    ]);
    await expect(badType.cmd.proposeMarry(ctx, [7, 5])).rejects.toMatchObject({
      key: 'waigua.invalid',
    });
  });

  it('proposeMarry: a winning PK announces the wedding, a miss roll only cools down', async () => {
    const king = {
      hid: 80213,
      uid: UID,
      name: '长乐',
      sex: 1,
      cid: 209355,
      state: 0,
      level: 1,
      command_base: 50,
      command_add_on: 0,
      affairs_base: 50,
      affairs_add: 0,
      affairs_add_on: 0,
      bravery_base: 50,
      bravery_add: 0,
      bravery_add_on: 0,
      wisdom_base: 50,
      wisdom_add: 0,
      wisdom_add_on: 0,
      speed_add_on: 0,
      herotype: 1000,
      loyalty: 100,
      force: 100,
      force_max: 100,
      energy: 100,
      energy_max: 100,
    };
    // 勇武 5000 → 一次打击 47619 伤害，稳赢守护 NPC（血 500、防 10）。
    const attackPart = {
      hid: 80213,
      sex: 1,
      energy: 100,
      standIndex: 11,
      command: 50,
      affair: 50,
      bravery: 5000,
      wisdom: 50,
      speed: 0,
    };
    const npcPart = {
      hid: 501,
      sex: 0,
      energy: 1,
      standIndex: 11,
      command: 10,
      affair: 10,
      bravery: 10,
      wisdom: 1,
      speed: 0,
    };
    const favorRow = { uid: UID, hid: 7, favor: 60, state: 0, proposeCoolTime: 0, name: '貂蝉' };
    const rules: Respond[] = [
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [favorRow],
      },
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 999 }] },
      { match: /gid = '152'/, rows: [] },
      { match: /select npcid from cfg_marry_mother_hero/, rows: [{ npcid: 501 }] },
      {
        match: /select hid from sys_city_hero where uid = \? and herotype = '1000'/,
        rows: [{ hid: 80213 }],
      },
      { match: /select a\.hid, a\.sex, `force` as energy/, rows: [attackPart] },
      { match: /FLOOR\(\(bravery_base \+ bravery_add\)/, rows: [{ hid: 501, battle: 900 }] },
      { match: /from cfg_pk_hero where hid = \?$/, rows: [npcPart] },
      { match: /select h\.\*, b\.\* from sys_city_hero h/, rows: [king] },
      { match: /update mem_marry_hero_favor set state = '1'/, rows: [] },
      USER_NAME('长乐'),
      SYS_INFORM,
      { match: /update mem_marry_hero_favor set proposeCoolTime/, rows: [] },
      CATCH_ALL,
    ];
    // giftType 4 空手必成（rand ≤ 100）；君主一击必杀 → winer=1。
    const won = build(rules);
    const res = (await won.cmd.proposeMarry(ctx, [7, 4])) as unknown[];
    expect(res[0]).toBe(0);
    expect(res[1]).toBe(4);
    expect((res[2] as unknown[])[0]).toMatchObject({ hid: 80213 });
    expect((res[2] as unknown[])[1]).toMatchObject({ hid: 501, battle: 900 });
    expect(res[3]).toMatchObject({ endflag: 1, winer: 1 });
    expect(
      won.db.executed.some((q) => /update mem_marry_hero_favor set state = '1'/.test(q.sql)),
    ).toBe(true);
    const cool = won.db.executed.find((q) => /set proposeCoolTime/.test(q.sql))!;
    // 原版把 $now 绑进 SQL、由 MySQL 计算 +3*60*60 → 参数就是 $now
    expect(cool.parameters).toEqual([NOW, UID, 7]);
    const inform = won.db.executed.find((q) => SYS_INFORM.match.test(q.sql))!;
    expect(inform.parameters[7]).toBe('长乐与貂蝉喜结连理，大家快去祝福他们吧!');

    // giftType 1 花 666 元宝、rand=7 > 5 不碰守护 NPC → ret[0]=1 也算提亲成功：
    // 原版 `if($ret[3]['winer']==1 || $ret[0]==1)` 在无 PK 的成功分支同样发喜结连理公告。
    const missed = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [favorRow],
      },
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 700 }] },
      LOG_MONEY,
      MONEY_UPDATE,
      LOG_DAY_MONEY,
      { match: /update mem_marry_hero_favor set state = '1'/, rows: [] },
      { match: /update mem_marry_hero_favor set proposeCoolTime/, rows: [] },
      USER_NAME('长乐'),
      SYS_INFORM,
      CATCH_ALL,
    ]);
    const missRes = (await missed.scripted.run(sequenceSource([6]), () =>
      missed.cmd.proposeMarry(ctx, [7, 1]),
    )) as unknown[];
    expect(missRes).toEqual([1, '貂蝉']);
    expect(
      missed.db.executed.some((q) => /update mem_marry_hero_favor set state = '1'/.test(q.sql)),
    ).toBe(true);
    expect(missed.db.executed.find((q) => MONEY_UPDATE.match.test(q.sql))!.parameters).toEqual([
      -666,
      UID,
    ]);
    const missInform = missed.db.executed.find((q) => SYS_INFORM.match.test(q.sql))!;
    expect(missInform.parameters[7]).toBe('长乐与貂蝉喜结连理，大家快去祝福他们吧!');

    // PK 输了（winer=0 且 ret[0]=0）才真正提亲失败——只落 3 小时冷却，不发公告。
    const lost = build([
      {
        match:
          /select a\.\*, b\.name from mem_marry_hero_favor a\s+left join cfg_marry_mother_hero b/i,
        rows: [favorRow],
      },
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 999 }] },
      { match: /gid = '152'/, rows: [] },
      { match: /select npcid from cfg_marry_mother_hero/, rows: [{ npcid: 501 }] },
      {
        match: /select hid from sys_city_hero where uid = \? and herotype = '1000'/,
        rows: [{ hid: 80213 }],
      },
      // 君主勇武 1（攻击 10）vs 守护将勇武 5000（攻击 50000）、血 500：一回合被反杀。
      {
        match: /select a\.hid, a\.sex, `force` as energy/,
        rows: [
          {
            hid: 80213,
            sex: 1,
            energy: 1,
            standIndex: 11,
            command: 10,
            affair: 10,
            bravery: 1,
            wisdom: 10,
            speed: 0,
          },
        ],
      },
      { match: /FLOOR\(\(bravery_base \+ bravery_add\)/, rows: [{ hid: 501, battle: 900 }] },
      {
        match: /from cfg_pk_hero where hid = \?$/,
        rows: [
          {
            hid: 501,
            sex: 0,
            energy: 100,
            standIndex: 11,
            command: 10,
            affair: 10,
            bravery: 5000,
            wisdom: 100,
            speed: 0,
          },
        ],
      },
      { match: /select h\.\*, b\.\* from sys_city_hero h/, rows: [king] },
      { match: /update mem_marry_hero_favor set proposeCoolTime/, rows: [] },
      CATCH_ALL,
    ]);
    const lostRes = (await lost.cmd.proposeMarry(ctx, [7, 4])) as unknown[];
    expect(lostRes[0]).toBe(0);
    expect(lostRes[3]).toMatchObject({ endflag: 1, winer: 0 });
    expect(
      lost.db.executed.some((q) => /update mem_marry_hero_favor set state = '1'/.test(q.sql)),
    ).toBe(false);
    expect(lost.db.executed.some((q) => /set proposeCoolTime/.test(q.sql))).toBe(true);
  });
});

describe('MarryCommands 夫人好感', () => {
  const MOTHER = {
    hid: 7,
    uid: UID,
    userid: UID,
    name: '貂蝉',
    npcid: 501,
    favor: 10,
    state: 1,
    count: 0,
    coolingEndtime: NOW + 100,
    proposeCoolTime: 0,
    command: 100,
    affairs: 90,
    bravery: 80,
    wisdom: 70,
  };
  const MOTHERS = {
    match: /from cfg_marry_mother_hero c, mem_marry_hero_favor m/i,
    rows: [{ ...MOTHER }],
  };
  const MADAM_BASE = [MOTHERS, CLOCK, VIVIFY, ROOMCOUNT(1), CHILD_COUNT(0), NEXT_GOOD('红玫瑰', 5)];

  it('loadMarryMadam decorates each mother with room/cooling/pregnancy info', async () => {
    const { cmd, db } = build([
      ...MADAM_BASE,
      {
        match: /select starttime, endtime, isSpeed from mem_marry_during/,
        rows: [{ starttime: NOW - 100, endtime: NOW + 500, isSpeed: 0 }],
      },
      CATCH_ALL,
    ]);
    const res = (await cmd.loadMarryMadam(ctx)) as Record<string, unknown>[];
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      hid: 7,
      roomIsEnough: true,
      leaveCoolTime: 100,
      leaveDuringTime: 500,
      isSpeed: 0,
      nextGidName: '红玫瑰',
      nextGidCount: 5,
    });
    // 怀孕未结束时不动状态
    expect(db.executed.some((q) => /update mem_marry_hero_favor set state = '3'/.test(q.sql))).toBe(
      false,
    );

    const overdue = build([
      ...MADAM_BASE,
      {
        match: /select starttime, endtime, isSpeed from mem_marry_during/,
        rows: [{ starttime: NOW - 100, endtime: NOW - 10, isSpeed: 0 }],
      },
      { match: /update mem_marry_hero_favor set state = '3'/, rows: [] },
      CATCH_ALL,
    ]);
    const res2 = (await overdue.cmd.loadMarryMadam(ctx)) as Record<string, unknown>[];
    expect(res2[0]).toMatchObject({ state: 3, leaveDuringTime: 0 });
    expect(
      overdue.db.executed.some((q) => /update mem_marry_hero_favor set state = '3'/.test(q.sql)),
    ).toBe(true);
  });

  it('getMadamLeavingTime returns the remaining during time and pushes state 3 when due', async () => {
    const due = build([
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ hid: 7, endtime: NOW - 10 }],
      },
      CLOCK,
      { match: /update mem_marry_hero_favor set state = '3'/, rows: [] },
      CATCH_ALL,
    ]);
    const res = (await due.cmd.getMadamLeavingTime(ctx, [7])) as Record<string, unknown>[];
    expect(res[0]).toMatchObject({ leaveDuringTime: 0 });
    expect(
      due.db.executed.some((q) => /update mem_marry_hero_favor set state = '3'/.test(q.sql)),
    ).toBe(true);

    const running = build([
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ hid: 7, endtime: NOW + 250 }],
      },
      CLOCK,
      CATCH_ALL,
    ]);
    const res2 = (await running.cmd.getMadamLeavingTime(ctx, [7])) as Record<string, unknown>[];
    expect(res2[0]).toMatchObject({ leaveDuringTime: 250 });
    expect(
      running.db.executed.some((q) => /update mem_marry_hero_favor set state = '3'/.test(q.sql)),
    ).toBe(false);
  });

  it('checkRoomCount bottoms an empty child count at 1 and pushes the mother to state 3', async () => {
    const { cmd, db } = build([
      VIVIFY,
      ROOMCOUNT(1),
      CHILD_COUNT(0),
      { match: /update mem_marry_hero_favor set state = '3'/, rows: [] },
      {
        match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
        rows: [{ uid: UID, hid: 7, state: 3, favor: 90 }],
      },
      CATCH_ALL,
    ]);
    const res = (await cmd.checkRoomCount(ctx, [7])) as unknown[];
    // 1 房间 vs 兜底成 1 的孩子数 → isEnough=false（原版怪癖）
    expect(res[0]).toBe(false);
    expect(res[1]).toMatchObject({ state: 3 });
    expect(db.executed.some((q) => /update mem_marry_hero_favor set state = '3'/.test(q.sql))).toBe(
      true,
    );
  });

  it('addMadamFavor guards type/state/favor/cooling/stock and the 80 boundary', async () => {
    const guards = (favorRow: Record<string, unknown>, extra: Respond[] = []) =>
      build([
        {
          match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
          rows: [favorRow],
        },
        CLOCK,
        ...extra,
        CATCH_ALL,
      ]);
    await expect(
      guards({ favor: 10, state: 1 }, []).cmd.addMadamFavor(ctx, [3, 7]),
    ).rejects.toMatchObject({
      key: 'marrySystem.child_type_error',
    });
    await expect(
      guards({ favor: 100, state: 1 }, []).cmd.addMadamFavor(ctx, [1, 7]),
    ).rejects.toMatchObject({
      key: 'marrySystem.madam_favor_full',
    });
    await expect(
      guards({ favor: 10, state: 1, coolingEndtime: NOW + 5 }, []).cmd.addMadamFavor(ctx, [1, 7]),
    ).rejects.toMatchObject({ key: 'marrySystem.madam_in_cooling' });
    await expect(
      guards({ favor: 10, state: 2 }, []).cmd.addMadamFavor(ctx, [1, 7]),
    ).rejects.toMatchObject({
      key: 'marrySystem.madam_status_error',
    });
    const noGift = guards({ favor: 10, state: 1, coolingEndtime: 0 }, [
      { match: /select count from sys_goods where uid = \? and gid = \?/, rows: [] },
      { match: /select name from cfg_goods where gid = \?/, rows: [{ name: '玫瑰花束' }] },
    ]);
    await expect(noGift.cmd.addMadamFavor(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marry.lack_gift',
      args: ['玫瑰花束'],
    });
    const at80 = guards({ favor: 80, state: 0, coolingEndtime: 0 }, [
      { match: /select count from sys_goods where uid = \? and gid = \?/, rows: [{ count: 3 }] },
      { match: /select name from cfg_goods where gid = \?/, rows: [{ name: '玫瑰花束' }] },
    ]);
    await expect(at80.cmd.addMadamFavor(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marry.can_not_send_gift',
    });
  });

  it('addMadamFavor: favor 88 starts the 3-day pregnancy; otherwise only favor +2', async () => {
    const favorRow = { uid: UID, hid: 7, favor: 88, state: 1, count: 0, coolingEndtime: 0 };
    const { cmd, db } = build([
      {
        match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
        rows: [favorRow],
      },
      CLOCK,
      { match: /select count from sys_goods where uid = \? and gid = \?/, rows: [{ count: 3 }] },
      { match: /select name from cfg_goods where gid = \?/, rows: [{ name: '翡翠之心' }] },
      { match: /update mem_marry_hero_favor set state = '2'/, rows: [] },
      { match: /insert into mem_marry_during \(uid, hid, starttime/, rows: [] },
      SYS_GOODS_PAY,
      LOG_GOODS,
      { match: /update mem_marry_hero_favor set favor = LEAST/, rows: [] },
      NEXT_GOOD('翡翠之心', 2),
      CATCH_ALL,
    ]);
    const res = (await cmd.addMadamFavor(ctx, [2, 7])) as unknown[];
    expect(res[0]).toBe(2);
    expect(res[1]).toBe('赠送礼品成功');
    expect(res[2]).toMatchObject({ nextGidName: '翡翠之心', nextGidCount: 2 });
    expect(db.executed.some((q) => /update mem_marry_hero_favor set state = '2'/.test(q.sql))).toBe(
      true,
    );
    expect(
      db.executed.find((q) => /insert into mem_marry_during \(uid, hid, starttime/.test(q.sql))!
        .parameters,
    ).toEqual([UID, 7]);
    expect(db.executed.find((q) => /set favor = LEAST/.test(q.sql))!.parameters).toEqual([UID, 7]);
    // favor 88 → 12069 档，扣 1
    expect(db.executed.find((q) => SYS_GOODS_PAY.match.test(q.sql))!.parameters).toEqual([
      UID,
      12069,
      -1,
      -1,
    ]);

    const plain = build([
      {
        match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
        rows: [{ ...favorRow, favor: 10 }],
      },
      CLOCK,
      { match: /select count from sys_goods where uid = \? and gid = \?/, rows: [{ count: 3 }] },
      { match: /select name from cfg_goods where gid = \?/, rows: [{ name: '香囊' }] },
      SYS_GOODS_PAY,
      LOG_GOODS,
      { match: /update mem_marry_hero_favor set favor = LEAST/, rows: [] },
      NEXT_GOOD('香囊', 2),
      CATCH_ALL,
    ]);
    await plain.cmd.addMadamFavor(ctx, [1, 7]);
    expect(plain.db.executed.some((q) => /insert into mem_marry_during/.test(q.sql))).toBe(false);
    expect(plain.db.executed.find((q) => SYS_GOODS_PAY.match.test(q.sql))!.parameters).toEqual([
      UID,
      12066,
      -1,
      -1,
    ]);
  });

  it('getMadamFavorInfo returns cooling time and the next gift tier', async () => {
    const { cmd } = build([
      {
        match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
        rows: [{ uid: UID, hid: 7, favor: 30, coolingEndtime: NOW + 60 }],
      },
      CLOCK,
      NEXT_GOOD('夜明珠', 1),
      CATCH_ALL,
    ]);
    const res = (await cmd.getMadamFavorInfo(ctx, [7])) as Record<string, unknown>[];
    expect(res[0]).toMatchObject({ leaveCoolTime: 60, nextGidName: '夜明珠', nextGidCount: 1 });
  });
});

describe('MarryCommands 亲子', () => {
  it('loadMarryChild returns [roomcount, children]', async () => {
    const children = [{ hid: 99002, name: '小宝', motherHid: 7, state: 0, motherName: '貂蝉' }];
    const { cmd } = build([VIVIFY, ROOMCOUNT(2), CHILDREN(children), CATCH_ALL]);
    expect(await cmd.loadMarryChild(ctx)).toEqual([2, children]);
  });

  it('loadChildCulture validates room, child and open rooms', async () => {
    const CHILD = { hid: 99002, uid: UID, out_hid: 0, name: '小宝' };
    const happy = build([
      { match: /select \* from sys_user_child where uid = \? and hid = \?/, rows: [CHILD] },
      VIVIFY,
      ROOMCOUNT(2),
      {
        match: /select \*, \(select count from sys_goods/,
        rows: [{ gid: 12059, name: '培养丹', goodCnt: 4 }],
      },
      CATCH_ALL,
    ]);
    const res = (await happy.cmd.loadChildCulture(ctx, [1, 99002])) as unknown[];
    expect(res[0]).toBe(1);
    expect(res[1]).toMatchObject({ goodCnt: 4 });
    expect(res[2]).toMatchObject({ hid: 99002 });

    const badRoom = build([CATCH_ALL]);
    await expect(badRoom.cmd.loadChildCulture(ctx, [5, 99002])).rejects.toMatchObject({
      key: 'marrySystem.room_num_error',
    });
    const noChild = build([NO(/select \* from sys_user_child/), CATCH_ALL]);
    await expect(noChild.cmd.loadChildCulture(ctx, [1, 99002])).rejects.toMatchObject({
      key: 'marrySystem.child_not_exist',
    });
    const done = build([
      {
        match: /select \* from sys_user_child where uid = \? and hid = \?/,
        rows: [{ out_hid: 99001 }],
      },
      CATCH_ALL,
    ]);
    await expect(done.cmd.loadChildCulture(ctx, [1, 99002])).rejects.toMatchObject({
      key: 'marrySystem.child_has_finish_culture',
    });
    const closed = build([
      { match: /select \* from sys_user_child where uid = \? and hid = \?/, rows: [CHILD] },
      VIVIFY,
      ROOMCOUNT(2),
      CATCH_ALL,
    ]);
    await expect(closed.cmd.loadChildCulture(ctx, [3, 99002])).rejects.toMatchObject({
      key: 'marrySystem.room_not_open',
    });
  });

  it('deleteSpecialChild charges 600 copper (gid 152) and grants the comfort pack', async () => {
    const short = build([
      {
        match: /select \* from sys_user_child where uid = \? and hid = \?/,
        rows: [{ hid: 99002, out_hid: 0 }],
      },
      NO(/gid = '152' and count >= 600/),
      CATCH_ALL,
    ]);
    await expect(short.cmd.deleteSpecialChild(ctx, [99002])).rejects.toMatchObject({
      key: 'marrySystem.core_not_enough',
    });
    const grown = build([
      {
        match: /select \* from sys_user_child where uid = \? and hid = \?/,
        rows: [{ hid: 99002, out_hid: 99001 }],
      },
      CATCH_ALL,
    ]);
    await expect(grown.cmd.deleteSpecialChild(ctx, [99002])).rejects.toMatchObject({
      key: 'marrySystem.can_not_throw',
    });

    const { cmd, db } = build([
      {
        match: /select \* from sys_user_child where uid = \? and hid = \?/,
        rows: [{ hid: 99002, out_hid: 0 }],
      },
      { match: /gid = '152' and count >= 600/, rows: [{ 1: 1 }] },
      SYS_GOODS_PAY,
      LOG_GOODS,
      { match: /delete from sys_user_child/, rows: [] },
      { match: /update mem_marry_relation set state = '1'/, rows: [] },
      { match: /insert into log_child_status/, rows: [] },
      VIVIFY,
      ROOMCOUNT(1),
      CHILDREN([]),
      CATCH_ALL,
    ]);
    const res = (await cmd.deleteSpecialChild(ctx, [99002])) as unknown[];
    expect(res[0]).toBe('您的孩子周游列国成功！');
    // addGoods 写入时把 152 换成 888888（积分）——原版怪癖照抄
    const pays = db.executed.filter((q) => SYS_GOODS_PAY.match.test(q.sql));
    expect(pays[0]!.parameters).toEqual([UID, 888888, -600, -600]);
    expect(pays[1]!.parameters).toEqual([UID, 50320, 1, 1]);
    expect(db.executed.some((q) => /insert into log_child_status/.test(q.sql))).toBe(true);
  });

  it('completeCulture rolls the adult face and converts the child into a herotype-10001 hero', async () => {
    const child = {
      hid: 99002,
      uid: UID,
      name: '小宝',
      sex: '0',
      out_hid: 0,
      command_base: 10,
      command_add: 5,
      affairs_base: 20,
      affairs_add: 4,
      bravery_base: 30,
      bravery_add: 3,
      wisdom_base: 40,
      wisdom_add: 2,
      qixin_multip: 2,
      wenpo_multip: 1,
      upgrade_value: 7,
    };
    const { cmd, db, scripted } = build([
      { match: /select \* from sys_user_child where uid = \? and hid = \?/, rows: [{ ...child }] },
      { match: /select lastcid from sys_user where uid = \?/, rows: [{ lastcid: 209355 }] },
      { match: /insert into sys_city_hero \(uid, name, sex/, rows: [] },
      LAST_ID(99001),
      { match: /insert into mem_hero_blood/, rows: [] },
      { match: /update sys_user_child set out_hid/, rows: [] },
      { match: /update mem_marry_relation set state = '4'/, rows: [] },
      { match: /insert into log_child_status/, rows: [] },
      VIVIFY,
      ROOMCOUNT(1),
      CHILDREN([]),
      CATCH_ALL,
    ]);
    const res = (await scripted.run(sequenceSource([3]), () =>
      cmd.completeCulture(ctx, [99002]),
    )) as unknown[];
    expect(res[0]).toBe('已成功完成培养并获得一名将领！');
    const insert = db.executed.find((q) =>
      /insert into sys_city_hero \(uid, name, sex/.test(q.sql),
    )!;
    // 加成乘数 7+2+1=10 → command=round(10+5)=15, affairs=24, bravery=33, wisdom=42；face=1+(3%9)=4
    expect(insert.parameters).toEqual([UID, '小宝', 0, 4, 209355, 15, 24, 33, 42]);
    expect(db.executed.some((q) => /insert into mem_hero_blood/.test(q.sql))).toBe(true);
    expect(
      db.executed.find((q) => /update sys_user_child set out_hid/.test(q.sql))!.parameters,
    ).toEqual([99001, UID, 99002]);
    expect(db.executed.some((q) => /update mem_marry_relation set state = '4'/.test(q.sql))).toBe(
      true,
    );
  });

  it('changeChildName validates once-only, length, chars and the baned list', async () => {
    const child = { hid: 99002, uid: UID, out_hid: 0, is_change: 0, name: '小宝' };
    const CHILD = /select \* from sys_user_child where uid = \? and hid = \?/;
    const once = build([{ match: CHILD, rows: [{ ...child, is_change: 1 }] }, CATCH_ALL]);
    await expect(once.cmd.changeChildName(ctx, [99002, '大宝'])).rejects.toMatchObject({
      key: 'marrySystem.modify_name_once',
    });
    const tooLong = build([{ match: CHILD, rows: [{ ...child }] }, CATCH_ALL]);
    await expect(tooLong.cmd.changeChildName(ctx, [99002, '名字超长了'])).rejects.toMatchObject({
      key: 'changeHeroName.name_too_long',
    });
    const quote = build([{ match: CHILD, rows: [{ ...child }] }, CATCH_ALL]);
    // 先长度后引号——3 字符的 o'b 落到引号校验
    await expect(quote.cmd.changeChildName(ctx, [99002, "o'b"])).rejects.toMatchObject({
      key: 'changeHeroName.invalid_char',
    });
    const empty = build([{ match: CHILD, rows: [{ ...child }] }, CATCH_ALL]);
    await expect(empty.cmd.changeChildName(ctx, [99002, '  '])).rejects.toMatchObject({
      key: 'changeHeroName.input_valid_name',
    });
    const baned = build([
      { match: CHILD, rows: [{ ...child }] },
      { match: /from cfg_baned_name where instr/, rows: [{ name: 'gm' }] },
      CATCH_ALL,
    ]);
    // ≤4 字才走得进违禁词检查（长度校验在前）
    await expect(baned.cmd.changeChildName(ctx, [99002, 'gm'])).rejects.toMatchObject({
      key: 'changeHeroName.invalid_char',
    });

    const { cmd, db } = build([
      { match: CHILD, rows: [{ ...child, out_hid: 99001 }] },
      NO(/from cfg_baned_name where instr/),
      { match: /update sys_user_child set name/, rows: [] },
      { match: /update sys_city_hero set name/, rows: [] },
      VIVIFY,
      ROOMCOUNT(1),
      CHILDREN([]),
      CATCH_ALL,
    ]);
    expect(await cmd.changeChildName(ctx, [99002, '大宝'])).toEqual(['修改成功', [1, []]]);
    expect(
      db.executed.find((q) => /update sys_user_child set name/.test(q.sql))!.parameters,
    ).toEqual(['大宝', UID, 99002]);
    expect(db.executed.some((q) => /update sys_city_hero set name/.test(q.sql))).toBe(true);
  });

  it('startCulture consumes a 培养丹 and rolls success/attr/value by the add-total', async () => {
    const child = {
      hid: 99002,
      uid: UID,
      out_hid: 0,
      command_add: 0,
      affairs_add: 0,
      bravery_add: 0,
      wisdom_add: 0,
    };
    const CHILD = {
      match: /select \* from sys_user_child where uid = \? and hid = \?/,
      rows: [{ ...child }],
    };
    const noDan = build([CHILD, NO(/gid = '12059' and count >= 1/), CATCH_ALL]);
    await expect(noDan.cmd.startCulture(ctx, [99002, 1])).rejects.toMatchObject({
      key: 'marrySystem.chengzhandan_good_not_enough',
    });

    // 总加值 0 ≤ 100 → 成功率 80；raw 50 → 50 ≤ 80 成功；attrid raw 1 → 2（内政）；rate raw 80 → 2 点
    const { cmd, db, scripted } = build([
      CHILD,
      { match: /gid = '12059' and count >= 1/, rows: [{ 1: 1 }] },
      SYS_GOODS_PAY,
      LOG_GOODS,
      { match: /update sys_user_child set/, rows: [] },
      { match: /insert into log_child_culture/, rows: [] },
      VIVIFY,
      ROOMCOUNT(2),
      {
        match: /select \*, \(select count from sys_goods/,
        rows: [{ gid: 12059, name: '培养丹', goodCnt: 3 }],
      },
      CATCH_ALL,
    ]);
    const res = (await scripted.run(sequenceSource([50, 1, 80]), () =>
      cmd.startCulture(ctx, [99002, 1]),
    )) as unknown[];
    expect(res[0]).toBe(true);
    expect(res[1]).toEqual([2, 2]);
    const upd = db.executed.find((q) => /update sys_user_child set/.test(q.sql))!;
    expect(upd.sql).toContain('affairs_add = affairs_add + ?');
    expect(upd.parameters).toEqual([2, UID, 99002]);
    expect(
      db.executed.find((q) => /insert into log_child_culture/.test(q.sql))!.parameters,
    ).toEqual([UID, 99002, 2, 2]);

    // raw 99 > 80 → 失败，attrid/addValue 记 0
    const failed = build([
      CHILD,
      { match: /gid = '12059' and count >= 1/, rows: [{ 1: 1 }] },
      SYS_GOODS_PAY,
      LOG_GOODS,
      { match: /insert into log_child_culture/, rows: [] },
      VIVIFY,
      ROOMCOUNT(2),
      {
        match: /select \*, \(select count from sys_goods/,
        rows: [{ gid: 12059, name: '培养丹', goodCnt: 3 }],
      },
      CATCH_ALL,
    ]);
    const res2 = (await failed.scripted.run(sequenceSource([99]), () =>
      failed.cmd.startCulture(ctx, [99002, 1]),
    )) as unknown[];
    expect(res2[0]).toBe(false);
    expect(res2[1]).toEqual([0, 0]);
    expect(failed.db.executed.some((q) => /update sys_user_child set/.test(q.sql))).toBe(false);
  });

  it('openChildRoom charges 200 for the 2nd and 400 for the 3rd room, capped at 3', async () => {
    const full = build([
      VIVIFY,
      { match: /select \* from sys_user_marry where uid = \?/, rows: [{ uid: UID, roomcount: 3 }] },
      CATCH_ALL,
    ]);
    await expect(full.cmd.openChildRoom(ctx)).rejects.toMatchObject({
      key: 'marrySystem.all_room_open',
    });
    const poor = build([
      VIVIFY,
      { match: /select \* from sys_user_marry where uid = \?/, rows: [{ uid: UID, roomcount: 2 }] },
      { match: /select money from sys_user/, rows: [{ money: 100 }] },
      CATCH_ALL,
    ]);
    await expect(poor.cmd.openChildRoom(ctx)).rejects.toMatchObject({
      key: 'buyGoods.no_enough_YuanBao',
    });

    const { cmd, db } = build([
      VIVIFY,
      { match: /select \* from sys_user_marry where uid = \?/, rows: [{ uid: UID, roomcount: 1 }] },
      { match: /select money from sys_user/, rows: [{ money: 500 }] },
      LOG_MONEY,
      MONEY_UPDATE,
      LOG_DAY_MONEY,
      { match: /update sys_user_marry set roomcount = LEAST/, rows: [] },
      VIVIFY,
      ROOMCOUNT(2),
      CHILDREN([]),
      CATCH_ALL,
    ]);
    await cmd.openChildRoom(ctx);
    expect(db.executed.find((q) => MONEY_UPDATE.match.test(q.sql))!.parameters).toEqual([
      -200,
      UID,
    ]);
    expect(db.executed.some((q) => /set roomcount = LEAST/.test(q.sql))).toBe(true);

    // roomcount=2 → 第 3 间 400 元宝
    const third = build([
      VIVIFY,
      { match: /select \* from sys_user_marry where uid = \?/, rows: [{ uid: UID, roomcount: 2 }] },
      { match: /select money from sys_user/, rows: [{ money: 500 }] },
      LOG_MONEY,
      MONEY_UPDATE,
      LOG_DAY_MONEY,
      { match: /update sys_user_marry set roomcount = LEAST/, rows: [] },
      VIVIFY,
      ROOMCOUNT(3),
      CHILDREN([]),
      CATCH_ALL,
    ]);
    await third.cmd.openChildRoom(ctx);
    expect(third.db.executed.find((q) => MONEY_UPDATE.match.test(q.sql))!.parameters).toEqual([
      -400,
      UID,
    ]);
  });

  it('doSpeedFeta: 500 gold shortens the pregnancy once by 77760s', async () => {
    const duringRow = { uid: UID, hid: 7, starttime: NOW - 100, endtime: NOW + 100000, isSpeed: 0 };
    const DURING = {
      match: /select d\.\* from mem_marry_during d,\s+mem_marry_hero_favor f/i,
      rows: [duringRow],
    };
    const busy = build([
      DURING,
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 10 }] },
      CATCH_ALL,
    ]);
    await expect(busy.cmd.doSpeedFeta(ctx, [7])).rejects.toMatchObject({
      key: 'buyGoods.no_enough_YuanBao',
    });
    const sped = build([
      { match: DURING.match, rows: [{ ...duringRow, isSpeed: 1 }] },
      CLOCK,
      CATCH_ALL,
    ]);
    await expect(sped.cmd.doSpeedFeta(ctx, [7])).rejects.toMatchObject({
      key: 'marrySystem.has_speed',
    });
    const done = build([
      { match: DURING.match, rows: [{ ...duringRow, endtime: NOW - 1 }] },
      CLOCK,
      CATCH_ALL,
    ]);
    await expect(done.cmd.doSpeedFeta(ctx, [7])).rejects.toMatchObject({
      key: 'marrySystem.during_has_finish',
    });
    const none = build([NO(/select d\.\* from mem_marry_during/), CLOCK, CATCH_ALL]);
    await expect(none.cmd.doSpeedFeta(ctx, [7])).rejects.toMatchObject({
      key: 'marrySystem.not_in_during',
    });

    const { cmd, db } = build([
      DURING,
      CLOCK,
      { match: /select money from sys_user/, rows: [{ money: 600 }] },
      LOG_MONEY,
      MONEY_UPDATE,
      LOG_DAY_MONEY,
      { match: /update mem_marry_during set endtime = endtime - /, rows: [] },
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ ...duringRow, isSpeed: 1 }],
      },
      CATCH_ALL,
    ]);
    const res = (await cmd.doSpeedFeta(ctx, [7])) as Record<string, unknown>[];
    expect(res[0]).toMatchObject({ isSpeed: 1, leaveDuringTime: 100000 });
    expect(
      db.executed.find((q) => /update mem_marry_during set endtime/.test(q.sql))!.parameters,
    ).toEqual([77760, UID, 7]);
  });

  it('getMadamChild guards type, birth count, pregnancy stage and rooms', async () => {
    const mother = {
      hid: 7,
      uid: UID,
      name: '貂蝉',
      npcid: 501,
      count: 0,
      state: 2,
      favor: 88,
      command: 100,
      affairs: 90,
      bravery: 80,
      wisdom: 70,
    };
    const MOTHER_ROW = {
      match: /select c\.\*, m\.\* from cfg_marry_mother_hero c,\s+mem_marry_hero_favor m/i,
      rows: [mother],
    };
    const badType = build([CATCH_ALL]);
    await expect(badType.cmd.getMadamChild(ctx, [3, 7])).rejects.toMatchObject({
      key: 'marrySystem.child_type_error',
    });
    const noMother = build([NO(/select c\.\*, m\.\*/), CATCH_ALL]);
    await expect(noMother.cmd.getMadamChild(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marrySystem.madam_not_exist',
    });
    const twoKids = build([
      { match: MOTHER_ROW.match, rows: [{ ...mother, count: 2 }] },
      CATCH_ALL,
    ]);
    await expect(twoKids.cmd.getMadamChild(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marrySystem.only_two_child',
    });
    const notPregnant = build([MOTHER_ROW, NO(/mem_marry_during where uid/), CATCH_ALL]);
    await expect(notPregnant.cmd.getMadamChild(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marrySystem.not_in_during_status',
    });
    const stillPregnant = build([
      MOTHER_ROW,
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ endtime: NOW + 10 }],
      },
      CLOCK,
      CATCH_ALL,
    ]);
    await expect(stillPregnant.cmd.getMadamChild(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marrySystem.in_during',
    });
    const noRoom = build([
      MOTHER_ROW,
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ endtime: NOW - 10 }],
      },
      CLOCK,
      CHILD_COUNT(2),
      VIVIFY,
      ROOMCOUNT(2),
      CATCH_ALL,
    ]);
    await expect(noRoom.cmd.getMadamChild(ctx, [1, 7])).rejects.toMatchObject({
      key: 'marrySystem.room_not_enough',
    });
    const noCopper = build([
      MOTHER_ROW,
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ endtime: NOW - 10 }],
      },
      CLOCK,
      CHILD_COUNT(0),
      VIVIFY,
      ROOMCOUNT(2),
      NO(/select count from sys_goods where uid = \? and gid = '152'/),
      CATCH_ALL,
    ]);
    await expect(noCopper.cmd.getMadamChild(ctx, [1, 7])).rejects.toMatchObject({
      key: 'blackMarket.no_enough_copper',
    });
  });

  it('getMadamChild delivers the baby: rolls attrs/names, cooldowns the mother and clears the pregnancy', async () => {
    const mother = {
      hid: 7,
      uid: UID,
      name: '貂蝉',
      npcid: 501,
      count: 0,
      state: 2,
      favor: 88,
      command: 100,
      affairs: 90,
      bravery: 80,
      wisdom: 70,
    };
    const { cmd, db, scripted } = build([
      {
        match: /select c\.\*, m\.\* from cfg_marry_mother_hero c,\s+mem_marry_hero_favor m/i,
        rows: [mother],
      },
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ endtime: NOW - 10, isSpeed: '1' }],
      },
      CLOCK,
      CHILD_COUNT(0),
      VIVIFY,
      ROOMCOUNT(2),
      { match: /select money from sys_user/, rows: [{ money: 500 }] },
      LOG_MONEY,
      MONEY_UPDATE,
      LOG_DAY_MONEY,
      { match: /insert into sys_user_child \(uid, name, sex/, rows: [] },
      LAST_ID(99003),
      { match: /update mem_marry_hero_favor set count = LEAST/, rows: [] },
      { match: /insert into mem_marry_relation/, rows: [] },
      { match: /insert into log_child_status/, rows: [] },
      { match: /update mem_marry_hero_favor set coolingEndtime/, rows: [] },
      { match: /delete from mem_marry_during/, rows: [] },
      USER_NAME('长乐'),
      SYS_INFORM,
      { match: /select name from mem_cfg_firstname order by rand/, rows: [{ name: '慕容' }] },
      { match: /select name from mem_cfg_girlname order by rand/, rows: [{ name: '复国' }] },
      { match: /select name from mem_cfg_boyname order by rand/, rows: [{ name: '阿哥' }] },
      {
        match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
        rows: [{ uid: UID, hid: 7, count: 1, state: 1 }],
      },
      CATCH_ALL,
    ]);
    // raw 抽取：21/22/23/24 → 属性 41/40/39/38；成长 2+(104%4)=2；性别 0+(1%2)=1（男）→ 脸 1+(105%5)=1
    const res = (await scripted.run(sequenceSource([100, 101, 102, 103, 104, 1, 105]), () =>
      cmd.getMadamChild(ctx, [2, 7]),
    )) as unknown[];
    expect(res[0]).toBe('恭喜您喜得贵子，赶快去教馆培养为他起个霸气响亮的名字吧！');
    expect(res[1]).toMatchObject({ count: 1, state: 1 });
    expect(
      db.executed.find((q) => /insert into sys_user_child \(uid, name, sex/.test(q.sql))!
        .parameters,
    ).toEqual([UID, '慕容复国', 1, 1, 41, 40, 39, 38, 2, 1, 2]);
    expect(
      db.executed.find((q) => /insert into mem_marry_relation/.test(q.sql))!.parameters,
    ).toEqual([UID, 7, 99003]);
    expect(db.executed.find((q) => /set coolingEndtime/.test(q.sql))!.parameters).toEqual([UID, 7]);
    expect(db.executed.some((q) => /delete from mem_marry_during/.test(q.sql))).toBe(true);
    expect(db.executed.find((q) => SYS_INFORM.match.test(q.sql))!.parameters[7]).toBe(
      '【长乐】喜得贵子，大家快去恭喜他吧！',
    );
  });

  it('getMadamChild keeps the original name/sex inversion: sex 0 (girl) draws from boyname', async () => {
    const mother = {
      hid: 7,
      uid: UID,
      name: '貂蝉',
      npcid: 501,
      count: 0,
      state: 2,
      favor: 88,
      command: 100,
      affairs: 90,
      bravery: 80,
      wisdom: 70,
    };
    const { cmd, db, scripted } = build([
      {
        match: /select c\.\*, m\.\* from cfg_marry_mother_hero c,\s+mem_marry_hero_favor m/i,
        rows: [mother],
      },
      {
        match: /select \* from mem_marry_during where uid = \? and hid = \?/,
        rows: [{ endtime: NOW - 10, isSpeed: 0 }],
      },
      CLOCK,
      CHILD_COUNT(0),
      VIVIFY,
      ROOMCOUNT(2),
      { match: /select money from sys_user/, rows: [{ money: 500 }] },
      LOG_MONEY,
      MONEY_UPDATE,
      LOG_DAY_MONEY,
      { match: /insert into sys_user_child \(uid, name, sex/, rows: [] },
      LAST_ID(99004),
      { match: /update mem_marry_hero_favor set count = LEAST/, rows: [] },
      { match: /insert into mem_marry_relation/, rows: [] },
      { match: /insert into log_child_status/, rows: [] },
      { match: /update mem_marry_hero_favor set coolingEndtime/, rows: [] },
      { match: /delete from mem_marry_during/, rows: [] },
      USER_NAME('长乐'),
      SYS_INFORM,
      { match: /select name from mem_cfg_firstname order by rand/, rows: [{ name: '王' }] },
      { match: /select name from mem_cfg_girlname order by rand/, rows: [{ name: '姑娘' }] },
      { match: /select name from mem_cfg_boyname order by rand/, rows: [{ name: '小虎' }] },
      {
        match: /select \* from mem_marry_hero_favor where uid = \? and hid = \?/,
        rows: [{ uid: UID, hid: 7, count: 1, state: 1 }],
      },
      CATCH_ALL,
    ]);
    // 性别 raw 0 → sex=0（女），按原版怪癖取名走 boyname 表。
    await scripted.run(sequenceSource([100, 101, 102, 103, 104, 0, 105]), () =>
      cmd.getMadamChild(ctx, [2, 7]),
    );
    const insert = db.executed.find((q) =>
      /insert into sys_user_child \(uid, name, sex/.test(q.sql),
    )!;
    expect(insert.parameters[2]).toBe(0); // sex=0 女
    expect(insert.parameters[1]).toBe('王小虎'); // 名字却来自 boyname
  });
});
