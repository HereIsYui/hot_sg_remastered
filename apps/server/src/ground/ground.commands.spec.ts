import { describe, expect, it, vi } from 'vitest';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService } from '../core/random.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { GroundCommands } from './ground.commands';
import { GroundRules } from './ground-rules.service';

const lang = new LangService({
  conscript: [
    '只有特殊城池募兵',
    '成功招募到',
    '已经招募过了',
    '您领取到:',
    '每天只能游历一次',
    '官府须10级',
  ],
  setAttackTactics: { succ: '**成功修改出征战术。' },
  setResistTactics: { succ: '**成功修改防守战术。' },
  getResistTactics: {},
  acceptCaptiveSoldier: {
    no_enough_gold: '黄金不足',
    no_captive_soldier: '没有俘虏',
    succ: '**招降成功。',
  },
  cureWoundedSoldier: {
    no_enough_gold: '黄金不足',
    no_wounded_soldier: '没有伤兵',
    succ: '**治疗成功。',
  },
  sayToLamster: { no_enough_gold: '黄金不足', no_wounded_soldier: '没有逃兵', succ: '劝说成功' },
  dismissCaptiveSoldier: { succ: '**释放成功。' },
  dismissWoundedSoldier: { succ: '遣散成功' },
  dismissLamster: { succ: '遣散成功' },
  depluder: { too_many_sid: '种参与，目前最多允许12兵种参战' },
  waigua: { forbidden: '恶意操作' },
});

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };

/** A RandomService that returns the low bound of every range, for deterministic conscript. */
const fixedRandom = { randRange: (min: number) => min } as unknown as RandomService;

function build(rules: Respond[], random: RandomService = fixedRandom) {
  const db = new FakeDb(rules);
  const spies = {
    addCityResources: vi.fn(async () => {}),
    addCityPeople: vi.fn(async () => {}),
    updateCityResourceAdd: vi.fn(async () => {}),
  };
  const cityRules = spies as unknown as CityRules;
  const users = {
    updateUserPrestige: vi.fn(async () => {}),
    logUserAction: vi.fn(async () => {}),
  } as unknown as UserRules;
  const goods = { addGoods: vi.fn(async () => {}) } as unknown as GoodsRules;
  const tasks = {
    completeTask: vi.fn(async () => {}),
    finishTask: vi.fn(async () => {}),
    finishTaskMaxNum: vi.fn(async () => {}),
  } as unknown as TaskRules;
  const groundRules = new GroundRules(db.scope, random);
  const cmd = new GroundCommands(db.scope, lang, cityRules, users, goods, tasks, groundRules);
  return { cmd, db, users, goods, tasks, spies };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('GroundCommands.conscript', () => {
  it('rejects when the city is not a 县/郡/州 the user owns', async () => {
    const { cmd } = build([NO(/from sys_city\s+where uid/i), NO(/.*/)]);
    await expect(cmd.conscript(ctx)).rejects.toThrow('conscript.0');
  });

  it('draws a random special soldier for the 王者城', async () => {
    const { cmd } = build([
      {
        match: /from sys_city\s+where uid/i,
        rows: [{ cid: 209355, type: 1, province: 1, conscript: 1, is_special: 2 }],
      },
      { match: /from cfg_soldier where sid/i, rows: [{ name: '特种兵' }] },
      NO(/.*/),
    ]);
    // 王者城 throws conscript.1 + name + count (rand(2000,10000) fixed to 2000).
    await expect(cmd.conscript(ctx)).rejects.toThrow('成功招募到特种兵2000');
  });

  it('grants the province item in 蛮夷之地 when 官府 >= 10', async () => {
    const { cmd, goods } = build([
      {
        match: /from sys_city\s+where uid/i,
        rows: [{ cid: 209355, type: 1, province: 14, conscript: 0, is_special: 0 }],
      },
      { match: /select level from sys_building where bid = 6/i, rows: [{ level: 10 }] },
      { match: /select name from cfg_goods where gid/i, rows: [{ name: '蛮夷宝箱' }] },
      NO(/.*/),
    ]);
    await expect(cmd.conscript(ctx)).rejects.toThrow('您领取到:蛮夷宝箱');
    expect(goods.addGoods).toHaveBeenCalledWith(1001, 19011, 1, 4);
  });

  it('rejects 蛮夷 游历 when 官府 below 10', async () => {
    const { cmd } = build([
      {
        match: /from sys_city\s+where uid/i,
        rows: [{ cid: 209355, type: 1, province: 14, conscript: 0, is_special: 0 }],
      },
      { match: /select level from sys_building where bid = 6/i, rows: [{ level: 9 }] },
      NO(/.*/),
    ]);
    await expect(cmd.conscript(ctx)).rejects.toThrow('conscript.5');
  });

  it('conscripts the province soldier at state 1 for a 县 (type 0 w/ special)', async () => {
    const { cmd } = build([
      {
        match: /from sys_city\s+where uid/i,
        rows: [{ cid: 209355, type: 0, province: 2, conscript: 1, is_special: 0 }],
      },
      // getSpacialSoldierId: non-empty so a 普通城池 may conscript.
      { match: /select sid from cfg_soldier_special_city\s+where cid/i, rows: [{ sid: 7 }] },
      {
        match: /select sid, rsid from cfg_soldier_special_city\s+where province/i,
        rows: [{ sid: 7, rsid: 0 }],
      },
      { match: /select name from cfg_soldier where sid/i, rows: [{ name: '刀兵' }] },
      NO(/.*/),
    ]);
    // type 0 → rand(100,300) fixed to 100.
    await expect(cmd.conscript(ctx)).rejects.toThrow('成功招募到刀兵100');
  });

  it('rejects when already conscripted today (state >= 2)', async () => {
    const { cmd } = build([
      {
        match: /from sys_city\s+where uid/i,
        rows: [{ cid: 209355, type: 1, province: 2, conscript: 2, is_special: 0 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.conscript(ctx)).rejects.toThrow('conscript.2');
  });
});

describe('GroundCommands tactics', () => {
  it('setAttackTactics packs plunder/invade/field/patrol and reports success', async () => {
    const { cmd, db } = build([{ match: /insert into sys_user_tactics/i }]);
    // 1 plunder (3 fields), 1 invade (5 fields), 0 field, patrol action = 2
    await expect(
      cmd.setAttackTactics(ctx, [1, 's1', 'a1', 't1', 1, 's2', 'a2', 't2', 'a3', 't3', 0, 2]),
    ).rejects.toThrow('setAttackTactics.succ');
    const insert = db.executed.find((q) => /insert into sys_user_tactics/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert?.parameters).toContain('s1,a1,t1');
    expect(insert?.parameters).toContain('s2,a2,t2,a3,t3');
    expect(insert?.parameters).toContain('3,2,3');
  });

  it('setResistTactics refuses more than 12 joining soldier types', async () => {
    const param: unknown[] = [13];
    for (let i = 0; i < 13; i++) param.push(`s${i}`, 1, 'a', 't');
    param.push(0, 0, 0, 1); // deinvadeCount, defenceCount, patrol join, patrol action
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.setResistTactics(ctx, param)).rejects.toThrow('最多允许12兵种参战');
  });

  it('getResistTactics returns the row and completes task 540', async () => {
    const { cmd, tasks } = build([
      { match: /from sys_city_tactics where cid/i, rows: [{ cid: 209355, deplunder: '' }] },
    ]);
    const res = await cmd.getResistTactics(ctx);
    expect(res).toHaveLength(1);
    expect(tasks.completeTask).toHaveBeenCalledWith(1001, 540);
  });
});

describe('GroundCommands soldier handling', () => {
  it('cureWoundedSoldierDetail rejects when gold is short', async () => {
    const { cmd } = build([
      { match: /0\.1 \* sum\([\s\S]*from cfg_soldier where sid/i, rows: [{ v: 500 }] },
      { match: /select gold from mem_city_resource/i, rows: [{ gold: 100 }] },
      NO(/.*/),
    ]);
    await expect(cmd.cureWoundedSoldierDetail(ctx, [5, 100])).rejects.toThrow(
      'cureWoundedSoldier.no_enough_gold',
    );
  });

  it('acceptCaptiveSoldierDetail grants soldiers and logs the action', async () => {
    const { cmd, users } = build([
      { match: /0\.1 \* sum\([\s\S]*from cfg_soldier where sid/i, rows: [{ v: 10 }] },
      { match: /select gold from mem_city_resource/i, rows: [{ gold: 1000 }] },
      { match: /from mem_city_captive\s+where cid/i, rows: [{ cid: 209355, sid: 5, count: 50 }] },
      { match: /select type from cfg_soldier where sid/i, rows: [{ type: 5 }] },
      NO(/.*/),
    ]);
    await expect(cmd.acceptCaptiveSoldierDetail(ctx, [5, 50])).rejects.toThrow(
      'acceptCaptiveSoldier.succ',
    );
    expect(users.updateUserPrestige).toHaveBeenCalledWith(1001);
    expect(users.logUserAction).toHaveBeenCalledWith(1001, 4);
  });

  it('dismissWoundedSoldierDetail refuses dismissing more than are present', async () => {
    const { cmd } = build([
      { match: /select count from mem_city_wounded where cid/i, rows: [{ count: 10 }] },
      NO(/.*/),
    ]);
    await expect(cmd.dismissWoundedSoldierDetail(ctx, [5, 50])).rejects.toThrow('waigua.forbidden');
  });

  it('dismissLamster frees people and reports success', async () => {
    const { cmd, spies } = build([
      {
        match: /from mem_city_lamster w left join cfg_soldier/i,
        rows: [{ v: 300 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.dismissLamster(ctx)).rejects.toThrow('dismissLamster.succ');
    expect(spies.addCityPeople).toHaveBeenCalledWith(209355, 300);
  });
});

describe('GroundCommands.startManeuver', () => {
  it('queues a mem_maneuver row (state 0) and returns its id', async () => {
    const { cmd, db } = build([{ match: /insert into mem_maneuver/i, insertId: 77 }]);
    await expect(cmd.startManeuver(ctx, ['1,3,10', '1,3,5'])).resolves.toEqual([77]);
    const insert = db.executed.find((q) => /insert into mem_maneuver/i.test(q.sql));
    expect(insert).toBeDefined();
    expect(insert!.parameters).toContain('1,3,10');
    expect(insert!.parameters).toContain('1,3,5');
  });

  it('getManeuverResult reports still-running when no settled row exists', async () => {
    const { cmd } = build([NO(/from mem_maneuver/i)]);
    await expect(cmd.getManeuverResult(ctx, [1])).resolves.toEqual([0]);
  });
});
