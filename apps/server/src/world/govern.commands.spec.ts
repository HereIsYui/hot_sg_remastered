import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules, cid2wid } from '../core/city-rules.service';
import { MailService } from '../core/mail.service';
import { ReportService } from '../core/report.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { GovernCommands } from './govern.commands';

const lang = new LangService({
  sendCommand: { command_exception: '你异常了!!!' },
  luoyang: { target_can_not_union: '目标城池不能为本盟的城池！' },
  governOthers: {
    city_cannot_govern: '你所在城池不是名城，不能下达政令。',
    target_not_in_war: '该城池处于免战状态，不能下达政令。',
    not_enouth_government_level: '名城官府等级达到10级，才能下达政令。',
    target_has_been_govern: '该城池今天已经被征收过了，不能重复下达政令。',
    too_many_time: '%s在%s每天可以下达%s次政令，你今天已经下令%s次，不能再次下令了。',
    not_enough_level: '该城池不受你管辖，不能下达政令。',
    gold_report: '%s城（%s,%s）向你征收税赋，你损失黄金%.0f。',
    people_report: '%s城（%s,%s）向强抽壮丁，你损失人口%.0f。',
    food_report: '%s城（%s,%s）向你征收粮食，你损失粮食%.0f。',
    incorporation_report: '%s城（%s,%s））强行收编你的军队，你损失%s%.0f。',
    disarmament_report: '%s城（%s,%s）勒令你裁军，你损失%s%.0f。',
    gold_suc: '收税成功，获得黄金%.0f。',
    people_suc: '抽丁成功，获得人口%.0f。',
    food_suc: '征粮成功，增加粮食%.0f。',
    incorporation_suc: '收编成功，增加%s%.0f。',
    disarmament_suc: '裁军成功，对方减少%s%.0f。',
  },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const TUID = 1002;
/** 郡城（type 2）与同郡的普通城（type 0）。 */
const OWN = 200500; // (x, y) = (500, 200)
const TARGET = 200300;
/** 县城（type 1）与同县/异县的城。 */
const OWN1 = 123456;
const SAME_COUNTY = 123455; // pos(123455) === pos(123456) === 1245
const NOW_TS = 1700000000;

const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new GovernCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    new ReportService(db.scope, new MailService(db.scope)),
  );
  return { cmd, db };
}

/** Both ownership checks (`select 1 from sys_city where uid = ? and cid = ?`). */
const OWNED: Respond = { match: /select 1 from sys_city where uid = \?/i, rows: [{ 1: 1 }] };
const typeOf = (cid: number, type: number): Respond => ({
  match: /select type from sys_city where cid = \?/i,
  params: [cid],
  rows: [{ type }],
});
const levelOf = (level: number): Respond => ({
  match: /select level from sys_building where cid = \? and bid = 6/i,
  rows: [{ level }],
});
const unionOf = (unionId: unknown): Respond => ({
  match: /select union_id from sys_user where uid = \?/i,
  rows: [{ union_id: unionId }],
});
const stateOf = (forbiend: number, vacend: number): Respond => ({
  match: /select forbiend, vacend/i,
  rows: [{ forbiend, vacend, nowtime: NOW_TS }],
});
const cityName = (cid: number, name: string): Respond => ({
  match: /select name from sys_city where cid = \?/i,
  params: [cid],
  rows: [{ name }],
});
const cityTypeName = (name: string): Respond => ({
  match: /select value from cfg_name where name = \?/i,
  rows: [{ value: name }],
});
const officeAt = (pos: number): Respond => ({
  match: /select officepos from sys_user where uid = \?/i,
  rows: [{ officepos: pos }],
});
const OFFICE_NAME: Respond = {
  match: /select name from cfg_office_pos where id = \?/i,
  rows: [{ name: '郡守' }],
};
const worldOf = (cid: number, province: number, jun: number): Respond => ({
  match: /select province, jun from mem_world where wid = \?/i,
  params: [cid2wid(cid)],
  rows: [{ province, jun }],
});
const NOW: Respond = {
  match: /^select unix_timestamp\(\)$/i,
  rows: [{ 'unix_timestamp()': NOW_TS }],
};
const NOT_GOVERNED_TODAY: Respond = {
  match: /select last_be_govern_time from mem_city_schedule where cid = \?/i,
  rows: [],
};
/** 自己城没有任何 schedule 行 → todayFirst。 */
const NO_OWN_SCHEDULE: Respond = {
  match: /select govern_count, last_govern_time from mem_city_schedule where cid = \?/i,
  rows: [],
};
/** 自己城今天已下过 1 次令。 */
const OWN_SCHEDULE: Respond = {
  match: /select govern_count, last_govern_time from mem_city_schedule where cid = \?/i,
  rows: [{ govern_count: 1, last_govern_time: NOW_TS - 3600 }],
};
/** sys_report insert + alarm + the soldier branches' updateCityResourceAdd writes. */
const REPORT_WRITES: Respond[] = [
  NO(/insert into sys_report/i),
  NO(/insert into sys_alarm/i),
  NO(/select `ownercid` from `mem_world` where `wid` = \?/i),
  NO(/update `sys_city_res_add`/i),
];
const SCHEDULE_WRITES: Respond[] = [
  NO(/insert into mem_city_schedule \(cid, last_be_govern_time\)/i),
  NO(/insert into mem_city_schedule \(cid, govern_count/i),
];

describe('GovernCommands.governOthers', () => {
  it('rejects when either city fails the ownership check', async () => {
    const { cmd } = build([NO(/select 1 from sys_city where uid/i), NO(/.*/)]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'sendCommand.command_exception',
    );
  });

  it('rejects a 普通城 (type 5 counts as type 0)', async () => {
    const { cmd } = build([OWNED, typeOf(OWN, 5), NO(/.*/)]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.city_cannot_govern',
    );
  });

  it('rejects when the 官府 is below level 10 (or missing)', async () => {
    const { cmd } = build([OWNED, typeOf(OWN, 2), levelOf(9), NO(/.*/)]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.not_enouth_government_level',
    );
  });

  it('rejects a target of equal or higher level', async () => {
    const { cmd } = build([OWNED, typeOf(OWN, 2), levelOf(10), typeOf(TARGET, 2), NO(/.*/)]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.not_enough_level',
    );
  });

  it("rejects an ally's city", async () => {
    const { cmd } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(7),
      { match: /select 1 from sys_user where uid = \? and union_id = \?/i, rows: [{ 1: 1 }] },
      NO(/.*/),
    ]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'luoyang.target_can_not_union',
    );
  });

  it('rejects a banned or vacationing target (original reuses the 免战 text)', async () => {
    const banned = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(NOW_TS + 100, 0),
      NO(/.*/),
    ]);
    await expect(banned.cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.target_not_in_war',
    );
    const away = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, NOW_TS + 100),
      NO(/.*/),
    ]);
    await expect(away.cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.target_not_in_war',
    );
  });

  it('rejects a target outside the county (type-1 city)', async () => {
    const { cmd } = build([
      OWNED,
      typeOf(OWN1, 1),
      levelOf(10),
      typeOf(200000, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('县城'),
      officeAt(6),
      OFFICE_NAME,
      worldOf(OWN1, 5, 12),
      worldOf(200000, 5, 12),
      NO(/.*/),
    ]);
    await expect(cmd.governOthers(ctx, [0, 200000, TUID, OWN1, '邺城'])).rejects.toThrow(
      'governOthers.not_enough_level',
    );
  });

  it('rejects a target outside the commandery (type-2 city)', async () => {
    const { cmd } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 13),
      NO(/.*/),
    ]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.not_enough_level',
    );
  });

  it('rejects a target already governed today', async () => {
    const { cmd } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      {
        match: /select last_be_govern_time from mem_city_schedule where cid = \?/i,
        rows: [{ last_be_govern_time: NOW_TS - 3600 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])).rejects.toThrow(
      'governOthers.target_has_been_govern',
    );
  });

  it('rejects at the daily cap with the office / city-type names', async () => {
    const { cmd } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      NO(/select value from cfg_name where name = \?/i), // the buggy key matches no row
      officeAt(10), // type-2 city: max 5 per day
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      { ...OWN_SCHEDULE, rows: [{ govern_count: 5, last_govern_time: NOW_TS - 3600 }] },
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])
      .catch((e: unknown) => e)) as GameError;
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBe('governOthers.too_many_time');
    // the cfg_name lookup is really `where name = 2` (the original's "big_city_"+$cityType
    // numeric-addition bug) and no such row exists, so the city-type name is empty
    expect(err.args).toEqual(['郡守', '', 5, 5]);
    expect(lang.messageOf(err)).toBe(
      '郡守在每天可以下达5次政令，你今天已经下令5次，不能再次下令了。',
    );
  });

  it('征税 takes a tenth of the gold', async () => {
    const { cmd, db } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      NO_OWN_SCHEDULE,
      { match: /select gold from mem_city_resource where cid = \?/i, rows: [{ gold: 12345 }] },
      NO(/update mem_city_resource set wood = wood \+/i),
      cityName(OWN, '南皮'),
      cityName(TARGET, '平原'),
      ...REPORT_WRITES,
      ...SCHEDULE_WRITES,
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [0, TARGET, TUID, OWN, '南皮'])
      .catch((e: unknown) => e)) as GameError;
    expect(lang.messageOf(err)).toBe('收税成功，获得黄金1234。');

    const find = (re: RegExp) => db.executed.filter((q) => re.test(q.sql));
    // the target pays a tenth, the governor receives it (wood, rock, iron, food, gold order)
    expect(find(/update mem_city_resource set wood = wood \+/i).map((q) => q.parameters)).toEqual([
      ['0', '0', '0', '0', '-1234', TARGET],
      ['0', '0', '0', '0', '1234', OWN],
    ]);
    // the report goes to the target with the ordering city's name and (x, y)
    const report = find(/insert into sys_report/i);
    expect(report).toHaveLength(1);
    expect(report[0]!.parameters).toEqual([
      TUID,
      OWN,
      '南皮',
      TARGET,
      '平原',
      26,
      3,
      '南皮城（500,200）向你征收税赋，你损失黄金1234。',
    ]);
    // both schedule rows written; first 政令 of the day starts a fresh count
    expect(
      find(/insert into mem_city_schedule \(cid, last_be_govern_time\)/i)[0]!.parameters,
    ).toEqual([TARGET]);
    expect(find(/insert into mem_city_schedule \(cid, govern_count/i)[0]!.parameters).toEqual([
      OWN,
      1,
      1,
    ]);
  });

  it('抽丁 takes a fifth of the people', async () => {
    const { cmd, db } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      NO_OWN_SCHEDULE,
      { match: /select people from mem_city_resource where cid = \?/i, rows: [{ people: 12345 }] },
      NO(/update mem_city_resource set people = people \+/i),
      cityName(OWN, '南皮'),
      cityName(TARGET, '平原'),
      ...REPORT_WRITES,
      ...SCHEDULE_WRITES,
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [1, TARGET, TUID, OWN, '南皮'])
      .catch((e: unknown) => e)) as GameError;
    expect(lang.messageOf(err)).toBe('抽丁成功，获得人口2469。');
    expect(
      find(db, /update mem_city_resource set people = people \+/i).map((q) => q.parameters),
    ).toEqual([
      ['-2469', TARGET],
      ['2469', OWN],
    ]);
  });

  it('征粮 takes a tenth of the food and keeps the day count', async () => {
    const { cmd, db } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      OWN_SCHEDULE,
      { match: /select food from mem_city_resource where cid = \?/i, rows: [{ food: 55555 }] },
      NO(/update mem_city_resource set wood = wood \+/i),
      cityName(OWN, '南皮'),
      cityName(TARGET, '平原'),
      ...REPORT_WRITES,
      ...SCHEDULE_WRITES,
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [2, TARGET, TUID, OWN, '南皮'])
      .catch((e: unknown) => e)) as GameError;
    expect(lang.messageOf(err)).toBe('征粮成功，增加粮食5555。');
    // food is the 4th amount column (wood, rock, iron, food, gold)
    expect(
      find(db, /update mem_city_resource set wood = wood \+/i).map((q) => q.parameters),
    ).toEqual([
      ['0', '0', '0', '-5555', '0', TARGET],
      ['0', '0', '0', '5555', '0', OWN],
    ]);
    // second 政令 of the day: plain count bump, no fresh window
    expect(find(db, /insert into mem_city_schedule \(cid, govern_count/i)[0]!.parameters).toEqual([
      OWN,
      2,
      2,
    ]);
  });

  it('收编 takes a fiftieth of the largest fromcity row, half to self (same county)', async () => {
    const { cmd, db } = build([
      OWNED,
      typeOf(OWN1, 1),
      levelOf(10),
      typeOf(SAME_COUNTY, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('县城'),
      officeAt(6),
      OFFICE_NAME,
      worldOf(OWN1, 5, 12),
      worldOf(SAME_COUNTY, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      NO_OWN_SCHEDULE,
      {
        match: /select a\.sid, a\.count from sys_city_soldier a, cfg_soldier b/i,
        rows: [{ sid: 3, count: 1000 }],
      },
      { match: /select name from cfg_soldier where sid = \?/i, rows: [{ name: '弓箭兵' }] },
      NO(/insert into sys_city_soldier/i),
      NO(/insert into log_city_soldier/i),
      NO(/select `ownercid` from `mem_world` where `wid` = \?/i),
      NO(/update `sys_city_res_add`/i),
      cityName(OWN1, '邺城'),
      cityName(SAME_COUNTY, '馆陶'),
      ...REPORT_WRITES,
      ...SCHEDULE_WRITES,
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [3, SAME_COUNTY, TUID, OWN1, '邺城'])
      .catch((e: unknown) => e)) as GameError;
    expect(lang.messageOf(err)).toBe('收编成功，增加弓箭兵10。');
    // the target loses 20, the governor gains half of that
    expect(find(db, /insert into sys_city_soldier/i).map((q) => q.parameters)).toEqual([
      [SAME_COUNTY, 3, '-20', '-20'],
      [OWN1, 3, '10', '10'],
    ]);
    // 收编 report goes to the target with title 43
    expect(find(db, /insert into sys_report/i)[0]!.parameters).toEqual([
      TUID,
      OWN1,
      '邺城',
      SAME_COUNTY,
      '馆陶',
      43,
      3,
      '邺城城（456,123））强行收编你的军队，你损失弓箭兵20。',
    ]);
  });

  it('裁军 removes a twentieth of the largest row without adding to self', async () => {
    const { cmd, db } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      NO_OWN_SCHEDULE,
      {
        match: /select sid, count from sys_city_soldier where cid = \? order by count desc/i,
        rows: [{ sid: 4, count: 40 }],
      },
      { match: /select name from cfg_soldier where sid = \?/i, rows: [{ name: '民兵' }] },
      NO(/insert into sys_city_soldier/i),
      NO(/insert into log_city_soldier/i),
      cityName(OWN, '南皮'),
      cityName(TARGET, '平原'),
      ...REPORT_WRITES,
      ...SCHEDULE_WRITES,
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [4, TARGET, TUID, OWN, '南皮'])
      .catch((e: unknown) => e)) as GameError;
    expect(lang.messageOf(err)).toBe('裁军成功，对方减少民兵2。');
    expect(find(db, /insert into sys_city_soldier/i).map((q) => q.parameters)).toEqual([
      [TARGET, 4, '-2', '-2'],
    ]);
  });

  it('an unknown 政令类型 still writes the schedule and throws an empty message', async () => {
    const { cmd, db } = build([
      OWNED,
      typeOf(OWN, 2),
      levelOf(10),
      typeOf(TARGET, 0),
      unionOf(0),
      stateOf(0, 0),
      cityTypeName('郡城'),
      officeAt(10),
      OFFICE_NAME,
      worldOf(OWN, 5, 12),
      worldOf(TARGET, 5, 12),
      NOW,
      NOT_GOVERNED_TODAY,
      NO_OWN_SCHEDULE,
      ...SCHEDULE_WRITES,
      NO(/.*/),
    ]);
    const err = (await cmd
      .governOthers(ctx, [9, TARGET, TUID, OWN, '南皮'])
      .catch((e: unknown) => e)) as GameError;
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBeNull();
    expect(err.message).toBe('');
    expect(find(db, /insert into mem_city_schedule \(cid, last_be_govern_time\)/i)).toHaveLength(1);
  });
});

function find(db: { executed: { sql: string; parameters: readonly unknown[] }[] }, re: RegExp) {
  return db.executed.filter((q) => re.test(q.sql));
}
