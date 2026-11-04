import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { CityBuildingsService } from '../city/city-buildings.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { TaskRewards } from '../task/task-rewards.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { SessionService } from '../gateway/session.service';
import { PushService } from '../push/push.service';
import { PushFrameType, PushProc } from '@hot/shared';
import { WorldRefreshService } from '../world/world-refresh.tick';
import { GM_AID_NOBILITY, GM_LOG_TYPE, GmCommands } from './gm.commands';
import { armorImageName, goodsImageName } from './gm-image';
import { GmTokenGuard } from './gm-token.guard';

const NO = (match: RegExp): Respond => ({ match, rows: [] });

type Sockets = Map<number, Set<{ readyState: number; send(data: string): void }>>;

const refreshCalls: number[] = [];

function build(rules: Respond[] = [], sockets: Sockets = new Map(), pushOverride?: PushService) {
  const db = new FakeDb(rules);
  const push =
    pushOverride ?? ({ onlineUids: () => [...sockets.keys()], broadcast: () => 0 } as unknown);
  const goods = new GoodsRules(db.scope);
  const rewards = new TaskRewards(
    db.scope,
    {} as never, // lang: addMoney/addGift never translate
    {} as never, // cities: unused by addMoney/addGift
    goods,
    {} as never, // heroes
    {} as never, // users
    {} as never, // random
  );
  const commands = new GmCommands(
    db.scope,
    rewards,
    new UserRules(db.scope),
    goods,
    { regenerateHeroAttri: () => {}, updateCityHeroChange: () => {} } as unknown as HeroRules,
    { syncUserTechnics: () => {} } as unknown as CityBuildingsService,
    push as PushService,
    new SessionService(db.scope.db),
    {
      get: (type: unknown) =>
        type === WorldRefreshService
          ? {
              refresh: async (now: number) => {
                refreshCalls.push(now);
                return 0;
              },
            }
          : undefined,
    } as unknown as ModuleRef,
  );
  return { commands, db };
}

const USER_ROW = {
  uid: 1001,
  name: 'changle',
  passport: 'changle',
  money: 500,
  gift: 10,
  prestige: 1000,
  nobility: 3,
  officepos: 2,
  state: 0,
  union_id: 0,
  lastcid: 209355,
  officepos_name: '亭长',
  nobility_name: '公士',
  union_name: null,
};

function userRules(): Respond[] {
  return [{ match: /select u\.uid, u\.name, u\.passport, u\.money/i, rows: [USER_ROW] }];
}

describe('GmCommands.searchPlayers', () => {
  it('searches by name with the joined display columns and a limit', async () => {
    const { commands, db } = build([
      {
        match: /from sys_user u[\s\S]*left join cfg_office_pos/i,
        rows: [USER_ROW],
      },
    ]);
    const rows = await commands.searchPlayers('name', 'ch');
    expect(rows).toHaveLength(1);
    const query = db.executed[0]!;
    expect(query.sql).toContain('u.uid > ?');
    expect(query.sql).toContain('u.name like ?');
    expect(query.sql).toContain('limit ?');
    expect(query.parameters).toContain('%ch%');
    expect(query.parameters).toContain(1000);
  });

  it('searches by passport when asked', async () => {
    const { commands, db } = build([{ match: /from sys_user u/i, rows: [] }]);
    await commands.searchPlayers('passport', 'ch');
    expect(db.executed[0]!.sql).toContain('u.passport like ?');
  });
});

describe('GmCommands.updatePlayer', () => {
  it('routes money and gift through addMoney/addGift with the GM log type', async () => {
    const { commands, db } = build(userRules());
    await commands.updatePlayer({ uid: 1001, money: 700, gift: 15 });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /insert into log_money/i.test(s))).toBe(true);
    const moneyLog = db.executed.find((q) => /insert into log_money/i.test(q.sql))!;
    expect(moneyLog.parameters).toContain(200); // 700 - 500
    expect(moneyLog.parameters).toContain(GM_LOG_TYPE);
    expect(sqls.some((s) => /insert into log_gift/i.test(s))).toBe(true);
    expect(sqls.some((s) => /update sys_user set money = money \+ \?/i.test(s))).toBe(true);
  });

  it('writes prestige, nobility and officepos directly with a log_user_action row', async () => {
    const { commands, db } = build([
      ...userRules(),
      { match: /select id from cfg_nobility/i, rows: [{ id: 5 }] },
      { match: /select id from cfg_office_pos/i, rows: [{ id: 4 }] },
      NO(/.*/),
    ]);
    await commands.updatePlayer({ uid: 1001, prestige: 99, nobility: 5, officepos: 4 });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /update sys_user set prestige = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /update sys_user set nobility = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /update sys_user set officepos = \?/i.test(s))).toBe(true);
    const aids = db.executed
      .filter((q) => /insert into log_user_action/i.test(q.sql))
      .map((q) => q.parameters[1]);
    expect(aids).toContain(GM_AID_NOBILITY);
  });

  it('rejects unknown nobility ids and unknown uids', async () => {
    const { commands } = build([...userRules(), NO(/.*/)]);
    await expect(commands.updatePlayer({ uid: 1001, nobility: 999 })).rejects.toThrow(
      NotFoundException,
    );
    const missing = build([NO(/.*/)]);
    await expect(missing.commands.updatePlayer({ uid: 1001, money: 1 })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('GmCommands.forbidUser / unforbidUser', () => {
  it('bans like game/forbiduser.php and drops the session', async () => {
    const { commands, db } = build(userRules());
    await commands.forbidUser({ uid: 1001, delemail: true });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /update mem_city_resource set forbidden = 1/i.test(s))).toBe(true);
    expect(
      sqls.some((s) =>
        /insert into sys_user_state[\s\S]*on duplicate key update forbistart = unix_timestamp/i.test(
          s,
        ),
      ),
    ).toBe(true);
    expect(sqls.some((s) => /update sys_user set state = \? where uid = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /delete from sys_sessions/i.test(s))).toBe(true);
    expect(sqls.some((s) => /delete from sys_mail_box where fromuid = \?/i.test(s))).toBe(true);
  });

  it('unbans like game/unforbiduser.php and resets state 5', async () => {
    const { commands, db } = build(userRules());
    await commands.unforbidUser(1001);
    const sqls = db.executed.map((q) => q.sql);
    expect(
      sqls.some((s) => /update sys_user_state set forbistart = 0, forbiend = 0/i.test(s)),
    ).toBe(true);
    expect(sqls.some((s) => /update mem_city_resource set forbidden = 0/i.test(s))).toBe(true);
    expect(
      sqls.some((s) => /update sys_user set state = \? where uid = \?[\s\S]*state = \?/i.test(s)),
    ).toBe(true);
  });

  it('refuses system uids', async () => {
    const { commands } = build(userRules());
    await expect(commands.forbidUser({ uid: 100, delemail: false })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('GmCommands.searchCities', () => {
  it('searches by name with the position columns', async () => {
    const { commands, db } = build([{ match: /from sys_city c left join sys_user u/i, rows: [] }]);
    await commands.searchCities({ name: '龙' });
    expect(db.executed[0]!.sql).toContain('c.name like ?');
    expect(db.executed[0]!.sql).toContain('c.cid % 1000 as x');
  });

  it('resolves x/y to cid = x + y*1000', async () => {
    const { commands, db } = build([{ match: /from sys_city c left join sys_user u/i, rows: [] }]);
    await commands.searchCities({ x: 355, y: 209 });
    expect(db.executed[0]!.parameters[0]).toBe(209355);
    await expect(commands.searchCities({ x: 1 })).rejects.toThrow(BadRequestException);
    await expect(commands.searchCities({})).rejects.toThrow(BadRequestException);
  });
});

describe('GmCommands.cityMaxLevel', () => {
  it('maxes buildings and technics and resyncs the per-city technic levels', async () => {
    const { commands, db } = build([
      {
        match: /select cid, uid, name from sys_city/i,
        rows: [{ cid: 209355, uid: 1001, name: '城' }],
      },
      NO(/.*/),
    ]);
    const result = await commands.cityMaxLevel(209355);
    const sqls = db.executed.map((q) => q.sql);
    expect(
      sqls.some((s) =>
        /update sys_building sb set sb\.level =\s*\(select max\(l\.level\)/i.test(s),
      ),
    ).toBe(true);
    expect(
      sqls.some((s) => /update sys_technic st set st\.level =\s*\(select max\(l\.level\)/i.test(s)),
    ).toBe(true);
    expect(result.buildings).toBe(0);
  });
});

describe('GmCommands.cleanupUser', () => {
  it('requires confirm', async () => {
    const { commands } = build();
    await expect(commands.cleanupUser({ uid: 1001, confirm: false })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('deletes hero, city and user rows, then the user itself', async () => {
    const { commands, db } = build([
      { match: /select cid, uid, name from sys_city/i, rows: [{ cid: 209355, uid: 1001 }] },
      ...userRules(),
      NO(/.*/),
    ]);
    await commands.cleanupUser({ uid: 1001, confirm: true });
    const sqls = db.executed.map((q) => q.sql);
    // hero rows go first, while the hids are still known
    expect(sqls.findIndex((s) => /delete from mem_hero_blood/i.test(s))).toBeLessThan(
      sqls.findIndex((s) => /delete from sys_city_hero where uid/i.test(s)),
    );
    expect(sqls.some((s) => /delete from sys_building where cid in/i.test(s))).toBe(true);
    expect(sqls.some((s) => /delete from sys_city where uid = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /delete from sys_user where uid = \?/i.test(s))).toBe(true);
    // sys_user is deleted last
    const last = sqls[sqls.length - 1]!;
    expect(/delete from sys_user where uid/i.test(last)).toBe(true);
  });
});

describe('GmCommands.searchHeroes / updateHero / placeHero', () => {
  it('searches player heroes and the cfg_npc_hero definitions', async () => {
    const { commands, db } = build([NO(/.*/)]);
    await commands.searchHeroes('关');
    expect(db.executed).toHaveLength(2);
    expect(db.executed[0]!.sql).toContain('from sys_city_hero h');
    expect(db.executed[1]!.sql).toContain('from cfg_npc_hero');
  });

  it('updates level/exp/base attrs and regenerates', async () => {
    const hero = { hid: 80213, uid: 1001, cid: 209355, state: 0, name: '君主' };
    const { commands, db } = build([
      { match: /select hid, uid, cid, name, level, exp, herotype, npcid, state/i, rows: [hero] },
      NO(/.*/),
    ]);
    await commands.updateHero({ hid: 80213, level: 60, command: 90 });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /update sys_city_hero set level = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /update sys_city_hero set command_base = \?/i.test(s))).toBe(true);
  });

  it('places a free hero into a city and backfills mem_hero_blood', async () => {
    const hero = { hid: 80213, uid: 1001, cid: 209355, state: 0 };
    const { commands, db } = build([
      { match: /select hid, uid, cid, name, level, exp, herotype, npcid, state/i, rows: [hero] },
      { match: /select cid, uid, name from sys_city/i, rows: [{ cid: 210001, uid: 1001 }] },
      { match: /select hid from mem_hero_blood/i, rows: [] },
      NO(/.*/),
    ]);
    await commands.placeHero({ hid: 80213, cid: 210001 });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /update sys_city_hero set cid = \?/i.test(s))).toBe(true);
    expect(sqls.some((s) => /replace into mem_hero_blood \(hid\)/i.test(s))).toBe(true);
  });

  it('refuses a hero that is out with a troop', async () => {
    const hero = { hid: 80213, uid: 1001, cid: 209355, state: 2 };
    const { commands } = build([
      { match: /select hid, uid, cid, name, level, exp, herotype, npcid, state/i, rows: [hero] },
      { match: /select cid, uid, name from sys_city/i, rows: [{ cid: 210001, uid: 1001 }] },
    ]);
    await expect(commands.placeHero({ hid: 80213, cid: 210001 })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('GmCommands.searchGoods', () => {
  it('returns cfg_goods rows with preview image names', async () => {
    const { commands } = build([
      {
        match: /from cfg_goods/i,
        rows: [{ gid: 50101, name: '新手礼包', image: 4, imagetype: 0, group: 0 }],
      },
    ]);
    const rows = await commands.searchGoods('goods', '礼包');
    expect(rows[0]!.imageName).toBe('images/pack_4.png');
  });

  it('returns cfg_armor rows with the armor image name', async () => {
    const { commands } = build([
      { match: /from cfg_armor/i, rows: [{ id: 300, name: '剑', image: 0 }] },
    ]);
    const rows = await commands.searchGoods('armor', '剑');
    expect(rows[0]!.imageName).toBe('images/armor/300.png');
  });
});

describe('GmCommands.grantGoods / removeGoods', () => {
  it('grants through addGoods with the GM log type', async () => {
    const { commands, db } = build([...userRules(), NO(/.*/)]);
    await commands.grantGoods({ uid: 1001, gid: 67, count: 2 });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /insert into sys_goods \(uid, gid, count\)/i.test(s))).toBe(true);
    const log = db.executed.find((q) => /insert into [`]?log_goods/i.test(q.sql))!;
    expect(log.parameters).toContain(GM_LOG_TYPE);
  });

  it('removes all copies with a negative log row, or reduces by count', async () => {
    const { commands, db } = build([
      ...userRules(),
      { match: /select count from sys_goods/i, rows: [{ count: 5 }] },
      NO(/.*/),
    ]);
    await commands.removeGoods({ uid: 1001, gid: 67 });
    const sqls = db.executed.map((q) => q.sql);
    expect(sqls.some((s) => /delete from sys_goods where uid = \? and gid = \?/i.test(s))).toBe(
      true,
    );
    const log = db.executed.find((q) => /insert into [`]?log_goods/i.test(q.sql))!;
    expect(log.parameters).toContain(-5);

    const { commands: c2, db: db2 } = build([...userRules(), NO(/.*/)]);
    await c2.removeGoods({ uid: 1001, gid: 67, count: 2 });
    expect(
      db2.executed.some((q) =>
        /update sys_goods set count = greatest\(0, count - \?\)/i.test(q.sql),
      ),
    ).toBe(true);
  });
});

describe('GmCommands.announce', () => {
  it('inserts a scrolling sys_inform row', async () => {
    const { commands, db } = build([NO(/.*/)]);
    await commands.sendInform({ msg: '维护开始', seconds: 600 });
    const row = db.executed.find((q) => /insert into [`]?sys_inform/i.test(q.sql))!;
    expect(row.parameters).toContain('维护开始');
  });

  it('reads the sys_login_announce row and the sys_announce id=1 text', async () => {
    const { commands, db } = build([
      {
        match: /from sys_login_announce where id = 1/i,
        rows: [
          { maxname: '长乐', maxpos: '平民', maxnob: '平民', maxattack: '', maxdefence: '', id: 1 },
        ],
      },
      {
        match: /select content from sys_announce where id = 1/i,
        rows: [{ content: '欢迎来到热血三国' }],
      },
    ]);
    const result = await commands.loginAnnounce();
    expect(result.announce).toMatchObject({ maxname: '长乐', maxpos: '平民' });
    expect(result.content).toBe('欢迎来到热血三国');
    expect(db.executed).toHaveLength(2);
  });

  it('merges rank fields over the current sys_login_announce row and rewrites the text', async () => {
    const { commands, db } = build([
      {
        match: /from sys_login_announce where id = 1/i,
        rows: [
          { maxname: '旧名', maxpos: '王', maxnob: '平民', maxattack: '', maxdefence: '', id: 1 },
        ],
      },
      NO(/.*/),
    ]);
    await commands.setLoginAnnounce({ maxname: '新名', content: '停机维护' });
    const upsert = db.executed.find((q) => /insert into sys_login_announce/i.test(q.sql))!;
    expect(upsert.sql).toContain('on duplicate key update');
    // the given field and the merged-from-db field both land in the upsert
    expect(upsert.parameters).toContain('新名');
    expect(upsert.parameters).toContain('王');
    expect(
      db.executed.some((q) => /update sys_announce set content = \? where id = 1/i.test(q.sql)),
    ).toBe(true);
  });

  it('updates only the announcement text when no rank fields are given', async () => {
    const { commands, db } = build([NO(/.*/)]);
    await commands.setLoginAnnounce({ content: '' });
    expect(db.executed.some((q) => /insert into sys_login_announce/i.test(q.sql))).toBe(false);
    expect(db.executed.some((q) => /update sys_announce set content/i.test(q.sql))).toBe(true);
  });

  it('broadcasts GM speak as proc 14 with the ChatPanel.onNotifyGMSpeek fields', async () => {
    const sent: unknown[] = [];
    const sockets = new Map<number, Set<{ readyState: number; send(data: string): void }>>();
    const push = new PushService();
    (push as unknown as { sockets: Sockets }).sockets = sockets;
    const socket = {
      readyState: 1,
      send(data: string) {
        sent.push(JSON.parse(data));
      },
    };
    sockets.set(1001, new Set([socket]));
    const { commands } = build([NO(/.*/)], sockets, push);
    await commands.speak({ msg: '大家好' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: PushFrameType.Notify,
      proc: PushProc.NOTIFY_ADMIN_SPEEK,
      data: { type: 3, fromuid: 0, msg: '大家好' },
    });
  });
});

describe('GmCommands.listState / setState', () => {
  it('lists all mem_state switches ordered by state', async () => {
    const { commands, db } = build([
      {
        match: /from mem_state\s*order by state/i,
        rows: [
          { state: 5, value: 0, description: '黄巾之乱史诗任务是否完成' },
          { state: 8, value: 1, description: '洛阳战场是否开启' },
        ],
      },
    ]);
    const rows = await commands.listState();
    expect(rows).toHaveLength(2);
    expect(db.executed[0]!.sql).toContain('order by state');
  });

  it('filters one switch when a state number is given', async () => {
    const { commands, db } = build([
      { match: /from mem_state\s*where state = \?/i, rows: [{ state: 5, value: 0 }] },
    ]);
    const rows = await commands.listState(5);
    expect(rows[0]!.state).toBe(5);
    expect(db.executed[0]!.sql).toContain('where state = ?');
  });

  it('upserts a switch keeping the description when not given', async () => {
    const { commands, db } = build([
      {
        match: /from mem_state\s*where state = \?/i,
        rows: [{ state: 5, value: 0, description: '黄巾之乱史诗任务是否完成' }],
      },
      NO(/.*/),
    ]);
    await commands.setState({ state: 5, value: 1 });
    const upsert = db.executed.find((q) => /insert into [`]?mem_state/i.test(q.sql))!;
    expect(upsert.sql).toContain('on duplicate key update');
    expect(upsert.parameters).toContain(1);
    expect(upsert.parameters).toContain('黄巾之乱史诗任务是否完成');
  });

  it('rejects a non-positive state number', async () => {
    const { commands } = build();
    await expect(commands.setState({ state: 0, value: 1 })).rejects.toThrow(BadRequestException);
  });
});

describe('GmCommands.epicTasks / setEpicTask', () => {
  const epicTaskRows = [
    { tid: 103741, name: '返乡·一月', group_id: 103700, group_name: '返乡', task_state: 0 },
    { tid: 103742, name: '返乡·三月', group_id: 103700, group_name: '返乡', task_state: null },
  ];
  const epicGoalRows = [
    { tid: 103741, gid: 3101113, content: '累计登录1天', count: 1, currentcount: 0 },
    { tid: 103742, gid: 3101114, content: '充值', count: 100, currentcount: null },
  ];

  it('lists epic tasks with the player state and per-goal progress', async () => {
    const { commands, db } = build([
      ...userRules(),
      {
        match:
          /join cfg_task_group g on g\.id = t\.`group` and g\.type = \?[\s\S]*left join sys_user_task u/i,
        rows: epicTaskRows,
      },
      {
        match: /where cg\.tid in \(select t\.id from cfg_task t, cfg_task_group g/i,
        rows: epicGoalRows,
      },
    ]);
    const rows = await commands.epicTasks(1001);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ tid: 103741, goals: [{ gid: 3101113, currentcount: 0 }] });
    expect(rows[1]).toMatchObject({ tid: 103742, goals: [{ gid: 3101114, currentcount: null }] });
    expect(db.executed).toHaveLength(3); // requireUser + tasks + goals
  });

  it('reports a missing player', async () => {
    const { commands } = build([NO(/.*/)]);
    await expect(commands.epicTasks(1001)).rejects.toThrow(NotFoundException);
  });

  it('sets goal progress, defaulting the count to the goal target', async () => {
    const { commands, db } = build([
      ...userRules(),
      {
        match: /from cfg_task_goal cg, cfg_task t,\s*cfg_task_group g/i,
        rows: [{ tid: 103741, count: 5 }],
      },
      { match: /select t\.id as tid, t\.name/i, rows: [epicTaskRows[0]!] },
      NO(/.*/),
    ]);
    await commands.setEpicTask({ uid: 1001, gid: 3101113 });
    const upsert = db.executed.find((q) => /insert into sys_user_goal/i.test(q.sql))!;
    expect(upsert.sql).toContain('on duplicate key update currentcount = ?');
    expect(upsert.parameters.slice(0, 3)).toEqual([1001, 3101113, 5]);
  });

  it('sets an explicit goal count and returns the refreshed task view', async () => {
    const { commands, db } = build([
      ...userRules(),
      {
        match: /from cfg_task_goal cg, cfg_task t,\s*cfg_task_group g/i,
        rows: [{ tid: 103741, count: 5 }],
      },
      { match: /select t\.id as tid, t\.name/i, rows: [epicTaskRows[0]!] },
      { match: /where cg\.tid = \? order by cg\.id/i, rows: [epicGoalRows[0]!] },
      NO(/.*/),
    ]);
    const task = await commands.setEpicTask({ uid: 1001, gid: 3101113, currentcount: 2 });
    const upsert = db.executed.find((q) => /insert into sys_user_goal/i.test(q.sql))!;
    expect(upsert.parameters).toContain(2);
    expect(task).toMatchObject({ tid: 103741, name: '返乡·一月', goals: [{ gid: 3101113 }] });
  });

  it('sets the accepted / finished state of an epic task', async () => {
    const { commands, db } = build([
      ...userRules(),
      { match: /select t\.id from cfg_task t, cfg_task_group g/i, rows: [{ id: 103741 }] },
      { match: /select t\.id as tid, t\.name/i, rows: [epicTaskRows[0]!] },
      { match: /where cg\.tid = \? order by cg\.id/i, rows: [] },
      NO(/.*/),
    ]);
    await commands.setEpicTask({ uid: 1001, tid: 103741, state: 1 });
    expect(
      db.executed.some((q) =>
        /insert into sys_user_task \(uid, tid, state\)[\s\S]*on duplicate key update state = \?/i.test(
          q.sql,
        ),
      ),
    ).toBe(true);
  });

  it('rejects a call without gid/tid and non-epic goal or task ids', async () => {
    const { commands } = build([
      ...userRules(),
      { match: /select t\.id as tid, t\.name/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(commands.setEpicTask({ uid: 1001 })).rejects.toThrow(BadRequestException);
    await expect(commands.setEpicTask({ uid: 1001, gid: 999999 })).rejects.toThrow(
      NotFoundException,
    );
    await expect(commands.setEpicTask({ uid: 1001, tid: 1, state: 1 })).rejects.toThrow(
      NotFoundException,
    );
    await expect(commands.setEpicTask({ uid: 1001, tid: 103741 })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('GmCommands.world', () => {
  it('forces a wild refresh through WorldRefreshService.refresh and counts grown fields', async () => {
    const { commands } = build([
      { match: /select unix_timestamp\(\) as now/i, rows: [{ now: 2_000_000_000 }] },
      { match: /select count\(\*\) as n from mem_world/i, rows: [{ n: 7 }] },
      NO(/.*/),
    ]);
    const result = await commands.refreshWilds();
    expect(result.touched).toBe(7);
    // the WorldRefreshService stub received the dbNow timestamp
    expect(refreshCalls).toEqual([2_000_000_000]);
  });

  it('reports online uids and table counts', async () => {
    const sockets: Sockets = new Map([[1001, new Set()]]);
    const { commands } = build(
      [{ match: /select \(select count\(\*\) from sys_user\)/i, rows: [{ sys_user: 3 }] }],
      sockets,
    );
    const result = await commands.status();
    expect(result.online).toBe(1);
    expect(result.onlineUids).toEqual([1001]);
    expect(result.tables[0]!.sys_user).toBe(3);
  });
});

describe('GmTokenGuard', () => {
  const make = (headers: Record<string, unknown>) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  });

  it('403s when GM_TOKEN is unset', () => {
    delete process.env.GM_TOKEN;
    expect(() => new GmTokenGuard().canActivate(make({}))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('accepts the matching token and rejects a wrong one', () => {
    process.env.GM_TOKEN = 'secret';
    const guard = new GmTokenGuard();
    expect(guard.canActivate(make({ 'x-gm-token': 'secret' }))).toBe(true);
    expect(() => guard.canActivate(make({ 'x-gm-token': 'wrong' }))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    delete process.env.GM_TOKEN;
  });
});

describe('gm image names', () => {
  it('mirrors the client naming rules', () => {
    expect(goodsImageName({ gid: 67, image: 0, imagetype: 0 })).toBe('images/item_67.png');
    expect(goodsImageName({ gid: 210001, group: 6, image: 3 })).toBe('images/hero/hero_boy_3.jpg');
    expect(armorImageName({ id: 300, image: 12 })).toBe('images/armor/12.png');
  });
});
