import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import type { GoodsRules } from '../core/goods-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { BattleReadCommands } from './battle-read.commands';

const lang = new LangService({
  getBattleData: { battle_end: '战斗已经结束，请查看报战。', battle_data_lost: '战斗数据丢失！' },
  setSoldierTactics: { cant_change_enemy_tactics: '你不能改变对方的战术。' },
  king: {
    not_find_kingHero: '当前没有您的君主将，无法领取奖励',
    has_get_reward: '您已经领取过奖励',
    get_reward_succ: '领取奖励成功，恭喜您获得五铢钱*%d个',
  },
});

const ctx = (uid = 1001) => ({ uid, cid: 0, ip: 0, sip: '' });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const added: { gid: number; count: number }[] = [];
  const goods = {
    addGoods: async (_uid: number, gid: number, count: number) => void added.push({ gid, count }),
  } as unknown as GoodsRules;
  return { cmd: new BattleReadCommands(db.scope, lang, goods), db, added };
}

describe('BattleReadCommands.getBattleReport', () => {
  it('bundles battle state, rounds and both tactics sides', async () => {
    const { cmd } = build([
      {
        match: /select state, result from sys_battle where id = \?/i,
        rows: [{ state: 0, result: 0 }],
      },
      { match: /select \* from mem_battle where id = \?/i, rows: [{ id: 7, wallhp: 100 }] },
      {
        match: /from sys_battle_report\s+where battleid = \? and round > \?/is,
        rows: [{ round: 1 }],
      },
      {
        match: /from mem_battle_tactics where battleid = \? and attack = 1/i,
        rows: [{ attack: 1 }],
      },
      {
        match: /from mem_battle_tactics where battleid = \? and attack = 0/i,
        rows: [{ attack: 0 }],
      },
    ]);
    const ret = await cmd.getBattleReport(ctx(), [7, 0]);
    expect(ret).toHaveLength(5);
    expect(Array.isArray(ret[2])).toBe(true);
  });
});

describe('BattleReadCommands.getBattleData', () => {
  it('throws battle_end when the battle already finished', async () => {
    const { cmd } = build([
      { match: /select \* from sys_battle where id = \?/i, rows: [{ id: 1, state: 1 }] },
    ]);
    await expect(cmd.getBattleData(ctx(), [1])).rejects.toBeInstanceOf(GameError);
  });

  it('throws battle_data_lost when mem_battle is missing', async () => {
    const { cmd } = build([
      { match: /select \* from sys_battle where id = \?/i, rows: [{ id: 1, state: 0 }] },
      { match: /select \* from mem_battle where id = \?/i, rows: [] },
    ]);
    await expect(cmd.getBattleData(ctx(), [1])).rejects.toMatchObject({
      key: 'getBattleData.battle_data_lost',
    });
  });

  it('returns a city-battle snapshot ending in the first getBattleReport batch', async () => {
    const { cmd } = build([
      {
        match: /select \* from sys_battle where id = \?/i,
        rows: [{ id: 5, type: 1, attackuid: 1001, resistuid: 1002, state: 0 }],
      },
      {
        match: /select \* from mem_battle where id = \?/i,
        rows: [
          { id: 5, type: 1, attackcid: 11, resistcid: 22, attackhid: 0, resisthid: 0, wallhp: 0 },
        ],
      },
      { match: /select uid, name from sys_user where uid = \?/i, rows: [{ uid: 1001, name: 'A' }] },
      { match: /select \* from sys_city where cid = \?/i, rows: [{ cid: 11, name: 'city' }] },
      { match: /select state, result from sys_battle where id = \?/i, rows: [{ state: 0 }] },
      { match: /from sys_battle_report/i, rows: [] },
      { match: /from mem_battle_tactics/i, rows: [] },
    ]);
    const ret = await cmd.getBattleData(ctx(), [5]);
    expect(ret[0]).toBe(1); // sysbattle.type
    expect(ret[1]).toBe(1001); // attackuid
    // the trailing element is a getBattleReport reply (a 5-element array)
    expect(Array.isArray(ret.at(-1))).toBe(true);
    expect((ret.at(-1) as unknown[]).length).toBe(5);
  });
});

describe('BattleReadCommands.setSoldierTactics', () => {
  it('rejects setting the enemy side', async () => {
    const { cmd } = build([
      {
        match: /select \* from sys_battle where id = \?/i,
        rows: [{ attackuid: 2002, resistuid: 3003 }],
      },
    ]);
    // player 1001 claims the attack side but is neither attacker nor defender
    await expect(cmd.setSoldierTactics(ctx(1001), [9, true, 1, 2, 3])).rejects.toMatchObject({
      key: 'setSoldierTactics.cant_change_enemy_tactics',
    });
  });

  it('replaces the row (keeping action2/target2) once the wall is down', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_battle where id = \?/i,
        rows: [{ attackuid: 1001, resistuid: 2002 }],
      },
      { match: /select wallhp from mem_battle where id = \?/i, rows: [{ wallhp: 0 }] },
      { match: /replace into mem_battle_tactics/i, rows: [] },
    ]);
    await cmd.setSoldierTactics(ctx(1001), [9, true, 1, 2, 3]);
    expect(db.executed.some((q) => /replace into mem_battle_tactics/i.test(q.sql))).toBe(true);
  });

  it('maps a sid >= 51 to its soldier type before storing', async () => {
    const { cmd, db } = build([
      { match: /select type from cfg_soldier where sid = \?/i, rows: [{ type: 4 }] },
      {
        match: /select \* from sys_battle where id = \?/i,
        rows: [{ attackuid: 1001, resistuid: 2002 }],
      },
      { match: /select wallhp from mem_battle where id = \?/i, rows: [{ wallhp: 5 }] },
      { match: /update mem_battle_tactics set/i, rows: [] },
    ]);
    await cmd.setSoldierTactics(ctx(1001), [9, true, 1, 2, 60]);
    const upd = db.executed.find((q) => /update mem_battle_tactics set/i.test(q.sql));
    expect(upd?.parameters).toContain(4); // mapped target type, not 60
  });
});

describe('BattleReadCommands.getKingReward', () => {
  it('throws when there is no 君主将', async () => {
    const { cmd } = build([
      { match: /from sys_city_hero where uid = \? and herotype = '1000'/i, rows: [] },
    ]);
    await expect(cmd.getKingReward(ctx())).rejects.toMatchObject({ key: 'king.not_find_kingHero' });
  });

  it('refuses a second claim on the same day', async () => {
    const { cmd } = build([
      { match: /from sys_city_hero where uid = \? and herotype = '1000'/i, rows: [{ level: 5 }] },
      { match: /select \* from sys_user_level where uid = \? limit 1/i, rows: [{ uid: 1001 }] },
      { match: /from_unixtime\(getrewardtime\)/i, rows: [{ x: '2026-10-23' }] },
      { match: /substr\(now\(\), 1, 10\)/i, rows: [{ x: '2026-10-23' }] },
    ]);
    await expect(cmd.getKingReward(ctx())).rejects.toMatchObject({ key: 'king.has_get_reward' });
  });

  it('grants the level-tiered reward and reports the count', async () => {
    const { cmd, added } = build([
      { match: /from sys_city_hero where uid = \? and herotype = '1000'/i, rows: [{ level: 25 }] },
      { match: /select \* from sys_user_level where uid = \? limit 1/i, rows: [{ uid: 1001 }] },
      { match: /from_unixtime\(getrewardtime\)/i, rows: [{ x: '2026-10-22' }] },
      { match: /substr\(now\(\), 1, 10\)/i, rows: [{ x: '2026-10-23' }] },
      { match: /update sys_user_level set .getrewardtime./i, rows: [] },
    ]);
    const ret = await cmd.getKingReward(ctx());
    // level 25 falls in the <=29 tier -> 15 五铢钱
    expect(added).toEqual([{ gid: 10960, count: 15 }]);
    expect(ret[0]).toContain('15');
  });
});
