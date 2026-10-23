import { describe, expect, it } from 'vitest';
import { CityRules } from '../core/city-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { GameError } from '../common/game-error';
import { TroopCommands } from './troop.commands';

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new TroopCommands(db.scope, new CityRules(db.scope));
  return { cmd, db };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('TroopCommands.kickTroop', () => {
  it('sends a stationed union troop home and refreshes the target', async () => {
    const { cmd, db } = build([
      {
        match: /from sys_troops where id = \? and task = 1 and state = 4/i,
        rows: [{ id: 7, targetcid: 5005, cid: 3003 }],
      },
      NO(/update sys_troops set .state. = 1, endtime = pathtime/i),
      NO(/from mem_world/i),
      NO(/update sys_city_res_add/i),
      NO(/.*/),
    ]);
    const ret = await cmd.kickTroop(ctx, [7]);
    expect(ret).toEqual([]);
    expect(
      db.executed.some((q) => /update sys_troops set .state. = 1, endtime = pathtime/i.test(q.sql)),
    ).toBe(true);
  });

  it('rejects when the stationed troop is gone', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.kickTroop(ctx, [7])).rejects.toBeInstanceOf(GameError);
  });
});

describe('TroopCommands.callBackTroop', () => {
  it('rejects a gathering troop', async () => {
    const { cmd } = build([
      { match: /from sys_gather where troopid = \?/i, rows: [{ troopid: 7 }] },
      NO(/.*/),
    ]);
    await expect(cmd.callBackTroop(ctx, [7])).rejects.toMatchObject({
      key: 'callBackTroop.gather',
    });
  });

  it('turns an advancing troop (state 0) around', async () => {
    const { cmd, db } = build([
      NO(/from sys_gather/i),
      {
        match: /from sys_troops where id = \? and uid = \?/i,
        rows: [{ id: 7, state: 0, noback: 0, cid: 3003, targetcid: 5005, hid: 0 }],
      },
      NO(/update sys_troops set .state. = 1,\s*endtime = unix_timestamp\(\) - starttime/i),
      NO(/.*/),
    ]);
    const ret = await cmd.callBackTroop(ctx, [7]);
    expect(ret).toEqual([]);
    expect(
      db.executed.some((q) =>
        /endtime = unix_timestamp\(\) - starttime \+ unix_timestamp\(\)/i.test(q.sql),
      ),
    ).toBe(true);
  });

  it('rejects recall of a troop locked by 关门打狗 (noback)', async () => {
    const { cmd } = build([
      NO(/from sys_gather/i),
      {
        match: /from sys_troops where id = \? and uid = \?/i,
        rows: [{ id: 7, state: 0, noback: 1 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.callBackTroop(ctx, [7])).rejects.toMatchObject({
      key: 'callBackTroop.on_back',
    });
  });

  it('recalls a stationed troop (state 4), restores hero and both cities', async () => {
    const { cmd, db } = build([
      NO(/from sys_gather/i),
      {
        match: /from sys_troops where id = \? and uid = \?/i,
        rows: [{ id: 7, state: 4, noback: 0, cid: 3003, targetcid: 5005, hid: 42 }],
      },
      NO(/update sys_troops set .state. = 1, endtime = pathtime/i),
      NO(/from mem_world/i),
      NO(/update sys_city_res_add/i),
      NO(/update sys_city_hero set state = 2/i),
      NO(/.*/),
    ]);
    await cmd.callBackTroop(ctx, [7]);
    expect(
      db.executed.some((q) => /update sys_city_hero set state = 2 where hid = \?/i.test(q.sql)),
    ).toBe(true);
  });

  it('rejects a troop in battle (state 3)', async () => {
    const { cmd } = build([
      NO(/from sys_gather/i),
      {
        match: /from sys_troops where id = \? and uid = \?/i,
        rows: [{ id: 7, state: 3, noback: 0 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.callBackTroop(ctx, [7])).rejects.toMatchObject({
      key: 'callBackTroop.army_in_battle',
    });
  });
});

describe('TroopCommands permission toggles', () => {
  it('allowUnionTroop writes the flag and returns the current value', async () => {
    const { cmd, db } = build([
      NO(/insert into sys_allow_union_troop \(uid, .allow.\)/i),
      { match: /select .allow. from sys_allow_union_troop where uid = \?/i, rows: [{ allow: 1 }] },
      NO(/.*/),
    ]);
    const ret = await cmd.allowUnionTroop(ctx, [1]);
    expect(ret).toEqual([1]);
    expect(db.executed.some((q) => /on duplicate key update .allow. = \?/i.test(q.sql))).toBe(true);
  });

  it('allowAntiPlunder defaults to 1 when the row is still missing (UnionFunc default)', async () => {
    // getAllowAntiPlunder returns 1 when sql_fetch_one_cell finds NO row (`=== false`), unlike
    // getAllowUnionTroop which defaults to 0. A player with no row is protected by default.
    const { cmd } = build([
      NO(/insert into sys_allow_union_troop \(uid, anti_plunder\)/i),
      NO(/select anti_plunder from sys_allow_union_troop/i),
      NO(/.*/),
    ]);
    const ret = await cmd.allowAntiPlunder(ctx, [0]);
    expect(ret).toEqual([1]);
  });

  it('allowAntiPlunder returns a stored 0 as-is (not folded into the default)', async () => {
    const { cmd } = build([
      NO(/insert into sys_allow_union_troop \(uid, anti_plunder\)/i),
      {
        match: /select `anti_plunder` from sys_allow_union_troop where uid = \?/i,
        rows: [{ anti_plunder: 0 }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.allowAntiPlunder(ctx, [0]);
    expect(ret).toEqual([0]);
  });
});

describe('TroopCommands.getArmyTroops', () => {
  it('clears the troops alarm and annotates own marching troops', async () => {
    const { cmd, db } = build([
      NO(/update sys_alarm set troops = 0/i),
      {
        match:
          /from sys_troops t left join sys_city c on c.cid = t.cid\s+where t.uid = \? and t.state < 4/i,
        rows: [{ id: 1, uid: 1001, cid: 3003, targetcid: 5005, task: 0, bid: 0 }],
      },
      { match: /select type from mem_world where wid = \?/i, rows: [{ type: 0 }] },
      { match: /select name from sys_city where cid = \?/i, rows: [{ name: '敌城' }] },
      NO(/.*/),
    ]);
    const troops = (await cmd.getArmyTroops(ctx)) as Record<string, unknown>[];
    expect(db.executed[0]!.sql).toMatch(/update sys_alarm set troops = 0/i);
    expect(troops[0]!.userid).toBe(1001);
    expect(troops[0]!.targetcity).toBe('敌城');
    expect(troops[0]!.inBattleNet).toBe(0);
  });
});

describe('TroopCommands.getTroopDetail', () => {
  it('rejects an unknown troop', async () => {
    const { cmd } = build([NO(/from sys_troops where id = \? and hid = \?/i), NO(/.*/)]);
    await expect(cmd.getTroopDetail(ctx, [7, 42])).rejects.toMatchObject({
      key: 'callBackTroop.invalid_army',
    });
  });

  it('returns full detail (viewLevel 10) for the owner', async () => {
    const { cmd } = build([
      {
        match: /from sys_troops where id = \? and hid = \?/i,
        rows: [{ id: 7, uid: 1001, hid: 42, task: 1, cid: 3003, targetcid: 5005 }],
      },
      {
        match: /select name, union_id from sys_user where uid = \?/i,
        rows: [{ name: '张三', union_id: 0 }],
      },
      {
        match: /select name, level, npcid from sys_city_hero where hid = \?/i,
        rows: [{ name: '关羽', level: 10, npcid: 0 }],
      },
      NO(/from mem_troops_buffer/i),
      NO(/.*/),
    ]);
    const [info] = (await cmd.getTroopDetail(ctx, [7, 42])) as Record<string, unknown>[];
    expect(info!.viewLevel).toBe(10);
    expect(info!.troopowner).toBe('张三');
    expect(info!.hero).toMatchObject({ name: '关羽' });
  });
});
