import { describe, expect, it } from 'vitest';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { LangService } from '../common/lang.service';
import { TaskRules } from '../core/task-rules.service';
import { ExternService } from './extern.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { GameError } from '../common/game-error';
import { StartTroopCommands } from './start-troop.commands';
import type { WarEventService } from '../push/war-event.service';

const lang = new LangService({
  waigua: { invalid: '数据异常' },
  ground: { scheme_set_succ: '方案设置成功', scheme_update_succ: '方案更新成功' },
  StartTroop: { target_cant_be_current: '目标不能是当前城池。' },
});

const ctx = { uid: 1001, cid: 3003, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new StartTroopCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    new GoodsRules(db.scope) as unknown as GoodsRules,
    { completeTaskWithTaskid: async () => {} } as unknown as TaskRules,
    new ExternService(db.scope),
    { notifyEnemyAlarm: () => 0 } as unknown as WarEventService,
  );
  return { cmd, db };
}

describe('StartTroopCommands schemes', () => {
  it('getTroopScheme rejects an out-of-range type', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.getTroopScheme(ctx, [3])).rejects.toMatchObject({ key: 'waigua.invalid' });
  });

  it('getTroopScheme returns the saved scheme', async () => {
    const { cmd } = build([
      {
        match: /from sys_user_troopScheme where uid = \? and type = \?/i,
        rows: [{ uid: 1001, type: 1, soldiers: '1,1,10' }],
      },
      NO(/.*/),
    ]);
    const ret = await cmd.getTroopScheme(ctx, [1]);
    expect(ret).toEqual([{ uid: 1001, type: 1, soldiers: '1,1,10' }]);
  });

  it('setTroopScheme inserts a new scheme', async () => {
    const { cmd, db } = build([
      NO(/select \* from sys_user_troopScheme where uid = \? and type = \?/i),
      NO(/insert into sys_user_troopScheme/i),
      NO(/.*/),
    ]);
    const ret = await cmd.setTroopScheme(ctx, [1, '1,1,10']);
    expect(ret).toEqual(['方案设置成功']);
    expect(db.executed.some((q) => /insert into sys_user_troopScheme/i.test(q.sql))).toBe(true);
  });

  it('setTroopScheme updates an existing scheme', async () => {
    const { cmd, db } = build([
      {
        match: /select \* from sys_user_troopScheme where uid = \? and type = \?/i,
        rows: [{ uid: 1001, type: 2, soldiers: 'x' }],
      },
      NO(/update sys_user_troopScheme set soldiers/i),
      NO(/.*/),
    ]);
    const ret = await cmd.setTroopScheme(ctx, [2, '1,1,10']);
    expect(ret).toEqual(['方案更新成功']);
    expect(db.executed.some((q) => /update sys_user_troopScheme set soldiers/i.test(q.sql))).toBe(
      true,
    );
  });

  it('setTroopScheme rejects an empty soldier string', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.setTroopScheme(ctx, [1, ''])).rejects.toMatchObject({ key: 'waigua.invalid' });
  });
});

describe('StartTroop early guards', () => {
  it('refuses a target equal to the current city', async () => {
    // Passes checkOutOpen (owner uid > 1000) and checkMianZhanCondition (target type != 0),
    // then targetcid === cid throws.
    const { cmd } = build([
      NO(/select value from mem_state where state = 197/i),
      { match: /select unix_timestamp\(\) as t/i, rows: [{ t: 1000 }] },
      NO(/select vacend from sys_user_state/i),
      // checkOutOpen
      { match: /select ownercid from mem_world where wid = \?/i, rows: [{ ownercid: 3003 }] },
      { match: /select uid from sys_city where cid = \?/i, rows: [{ uid: 1001 }] },
      // checkMianZhanCondition: target world type != 0 → returns early
      { match: /select \* from mem_world where wid = \?/i, rows: [{ type: 1, ownercid: 0 }] },
      NO(/.*/),
    ]);
    await expect(cmd.StartTroop(ctx, [0, 3003, 0, 0, '1,1,10', '0'])).rejects.toBeInstanceOf(
      GameError,
    );
  });
});
