import { describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { FieldCommands } from '../city/field.commands';
import { CityRules } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { MailService } from '../core/mail.service';
import { RandomService, ScriptedRandom, sequenceSource } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import type { DefaultBoxService } from '../goods/default-box.service';
import type { TaskRewards } from '../task/task-rewards.service';
import { GatherCommands } from './gather.commands';

const lang = new LangService({
  gatherFieldStart: { field_is_city: '该地为城池，不能采集。' },
  gatherFieldEnd: { through_gathering: '经过%s的采集，共收获' },
  gatherFieldResult: { rock: '石料' },
  MakeTimeLeft: { hour: '小时', min: '分钟', sec: '秒' },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[], draws: number[] = [0]) {
  const db = new FakeDb([...rules, NO(/.*/)]);
  const scripted = new ScriptedRandom();
  const cityRules = new CityRules(db.scope);
  const cmd = new GatherCommands(
    db.scope,
    lang,
    new RandomService(scripted),
    cityRules,
    new HeroRules(db.scope),
    new GoodsRules(db.scope),
    new ReportService(db.scope, new MailService(db.scope)),
    new TaskRules(db.scope, new UserRules(db.scope)),
    {} as TaskRewards,
    {} as DefaultBoxService,
    new FieldCommands(db.scope, {} as never, cityRules),
  );
  const run = <T>(fn: () => Promise<T>): Promise<T> => scripted.run(sequenceSource(draws), fn);
  return { cmd, db, run };
}

describe('GatherCommands.gatherFieldStart', () => {
  it('refuses a city tile', async () => {
    const { cmd } = build([{ match: /from mem_world where wid/i, rows: [{ type: 0 }] }]);
    await expect(cmd.gatherFieldStart(ctx, [3003])).rejects.toMatchObject({
      key: 'gatherFieldStart.field_is_city',
    });
  });

  it('does nothing while the player is on vacation', async () => {
    const { cmd, db } = build([
      { match: /select vacend from sys_user_state/i, rows: [{ vacend: 2000 }] },
      { match: /^select unix_timestamp\(\)$/i, rows: [{ now: 1000 }] },
    ]);
    expect(await cmd.gatherFieldStart(ctx, [3003])).toBeUndefined();
    expect(db.executed.some((q) => /sys_gather/i.test(q.sql))).toBe(false);
  });
});

describe('GatherCommands.gatherStartAll', () => {
  it('starts only the troops not gathering yet', async () => {
    const { cmd, db } = build([
      {
        match: /from sys_troops\s+where state = 4/i,
        rows: [
          { id: 1, fooduse: 10, targetcid: 3003 },
          { id: 2, fooduse: 20, targetcid: 5005 },
        ],
      },
      { match: /from mem_world/i, rows: [{ state: 0, type: 2, level: 3 }] },
      { match: /from sys_gather where wid = \?\s+and troopid = \?/i, params: [55, 2], rows: [{}] },
    ]);
    expect(await cmd.gatherStartAll(ctx)).toEqual([true]);
    const started = db.executed.filter((q) => /replace into sys_gather/i.test(q.sql));
    expect(started.map((q) => q.parameters[1])).toEqual([1]);
  });
});

describe('GatherCommands.gatherFieldEnd', () => {
  it('gathers rock by level, food eaten and hours', async () => {
    const { cmd, db, run } = build(
      [
        {
          match: /select \* from mem_world where wid/i,
          rows: [{ wid: 303, type: 2, state: 0, level: 5, ownercid: 209355 }],
        },
        { match: /select uid from sys_city where cid/i, rows: [{ uid: 1001 }] },
        {
          match: /select \* from sys_gather where wid/i,
          rows: [{ wid: 303, troopid: 7, fooduse: 10, level: 5, starttime: 1000 }],
        },
        { match: /select \* from sys_troops where id/i, rows: [{ id: 7, hid: 9, state: 4 }] },
        { match: /select level from sys_city_hero/i, rows: [{ level: 30 }] },
        { match: /^select unix_timestamp\(\)$/i, rows: [{ now: 1000 + 37800 }] },
      ],
      [999],
    );
    const ret = await run(() => cmd.gatherFieldEnd(ctx, [303]));
    expect(ret[1]).toBe('经过10小时30分钟0秒的采集，共收获石料50。');
    const res = db.executed.find((q) => /update mem_city_resource/i.test(q.sql));
    expect(res?.parameters.slice(0, 4)).toEqual(['0', '50', '0', '0']);
  });
});
