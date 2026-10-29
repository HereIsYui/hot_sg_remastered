import { describe, expect, it } from 'vitest';
import { LuoyangBelongCommands } from './luoyang-belong.commands';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { MailService } from '../core/mail.service';
import { ReportService } from '../core/report.service';
import { FakeDb, type ExecutedQuery, type Respond } from '../hero/fake-db.testutil';

const lang = new LangService({
  luoyang: {
    can_not_assign: '洛阳城还未开启分配功能！',
    city_not_in_union: '洛阳城不属于本盟，无法进行分配操作！',
    not_union_leader: '你不是盟主，无权分配洛阳',
    not_union_member: '你选在的人不是本联盟成员',
    has_allocated: '洛阳不能被重复分配',
    assign_succ: '您已成功将洛阳分配给%s',
    has_send_inform: '每天只有一次全服公告机会！',
    inform_content: '吾皇万岁万岁万万岁！',
    can_not_send: '该功能只有洛阳归属者才能操作！',
    has_used: '您已经使用过该功能！',
    govern_coord_error: '请输入合法的坐标',
    target_is_not_city: '目标不是城池，请重新选择！',
    target_can_not_user: '目标城池不能为自己的城池！',
    target_can_not_union: '目标城池不能为本盟的城池！',
    target_over_max: '您今天已经征收过10次了',
    over_govern_range: '您只能征收十三州内的城池！',
  },
  rankfunc: { uniontask: '联盟史诗任务，需先加入一个联盟' },
  governOthers: {
    target_has_been_govern: '该城池今天已经被征收过了，不能重复下达政令。',
    target_not_in_war: '该城池处于免战状态，不能下达政令。',
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

const UID = 1001;
const MEMBER = 1002;
const UNION = 9;
const LY = 215265;
const MY_CID = 209355;
const TARGET = 300400; // x=400, y=300
/** NOW = 2023-11-15 06:13:20 Asia/Shanghai —— 周三（date('N')=3）且未过 23:00。 */
const NOW = 1700000000;
const CURDATE = 1699977600;
/** 本周窗口起点：上周三 23:00（周三当日 23:00 前仍算上周）。 */
const START = 1699455600;

const ctx = { uid: UID, cid: 0, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new LuoyangBelongCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    new ReportService(db.scope, new MailService(db.scope)),
  );
  return { cmd, db };
}

/** DB 时钟：unix_timestamp() 与 unix_timestamp(curdate())。 */
const CLOCK: Respond[] = [
  { match: /^select unix_timestamp\(\) as t$/i, rows: [{ t: NOW }] },
  { match: /^select unix_timestamp\(curdate\(\)\) as t$/i, rows: [{ t: CURDATE }] },
];

/** 参考库种子：sys_luoyang_info 单行（uid=710, unionid=0, 贞观）。 */
const LY_SEED: Respond = {
  match: /select \* from sys_luoyang_info$/i,
  rows: [{ uid: 710, unionid: 0, name: '贞观', initname: '贞观', count: 0 }],
};
/** 夹具：UID 是洛阳归属者（联盟 9，本周有分配记录）。 */
const LY_OWNED: Respond = {
  match: /select \* from sys_luoyang_info$/i,
  rows: [{ uid: UID, unionid: UNION, name: '君主甲', initname: '贞观', count: 1 }],
};
const BELONG_THIS_WEEK: Respond = {
  match: /select 1 from log_luoyang_belong\s+where uid = \? and time >= \?/i,
  params: [UID, START],
  rows: [{ 1: 1 }],
};
const NO_BELONG_THIS_WEEK: Respond = {
  match: /select 1 from log_luoyang_belong\s+where uid = \? and time >= \?/i,
  params: [UID, START],
  rows: [],
};
/** checkGovernCondition 的目标城行。 */
const TARGET_CITY = (uid: number, type: number, province: number): Respond => ({
  match: /select uid, type, province from sys_city\s+where cid = \?/i,
  params: [TARGET],
  rows: [{ uid, type, province }],
});
const UNION_OF = (uid: number, unionId: number): Respond => ({
  match: /select union_id from sys_user where uid = \?/i,
  params: [uid],
  rows: [{ union_id: unionId }],
});
const LASTCID: Respond = {
  match: /select lastcid from sys_user where uid = \?/i,
  params: [UID],
  rows: [{ lastcid: MY_CID }],
};
const RESOURCE_OF = (column: string, value: number): Respond => ({
  match: new RegExp(`select ${column} from mem_city_resource where cid = \\?`, 'i'),
  params: [TARGET],
  rows: [{ [column]: value }],
});
/** 洛阳城名（governLuoyangOthers 的战报署名城）。 */
const LY_NAME: Respond = {
  match: /select name from sys_city where cid = \?/i,
  params: [LY],
  rows: [{ name: '洛阳' }],
};
/** 归属校验全部通过 + 目标可被政令的夹具（目标 uid=MEMBER、联盟 8、十三州内）。 */
function governRules(
  overrides: {
    targetCity?: Respond;
    targetUnion?: Respond;
    myUnion?: Respond;
    overMax?: Respond;
    schedule?: Respond;
    userState?: Respond;
  } = {},
): Respond[] {
  return [
    ...CLOCK,
    BELONG_THIS_WEEK,
    LY_OWNED,
    LASTCID,
    overrides.targetCity ?? TARGET_CITY(MEMBER, 0, 5),
    overrides.targetUnion ?? UNION_OF(MEMBER, 8),
    overrides.myUnion ?? UNION_OF(UID, UNION),
    overrides.overMax ?? { match: /govern_count >= 10/i, rows: [] },
    overrides.schedule ?? {
      match: /select \* from mem_city_schedule\s+where cid = \?/i,
      params: [TARGET],
      rows: [{ cid: TARGET, last_be_govern_time: 0 }],
    },
    overrides.userState ?? { match: /sys_user_state/i, rows: [] },
    LY_NAME,
    NO(/insert into sys_report/i),
    NO(/insert into sys_alarm/i),
    NO(/select name from sys_city where cid = \?/i),
    NO(/from mem_world m/i),
    NO(/update `sys_city_res_add`/i),
    NO(/select `ownercid` from `mem_world`/i),
  ];
}

const wrote = (db: FakeDb, re: RegExp): ExecutedQuery[] =>
  db.executed.filter((q) => re.test(q.sql));

describe('LuoyangBelongCommands.getLuoyangInfo', () => {
  it('answers empty (false) — mem_luoyang_info has no rows on the seeded databases', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await cmd.getLuoyangInfo()).toBe(false);
  });
});

describe('LuoyangBelongCommands.getLuoyangEvent', () => {
  it('resolves union/user names per record', async () => {
    const { cmd } = build([
      {
        match: /select \* from mem_luoyang_record/i,
        rows: [
          { id: 1, time: 123, unionid: UNION, type: 1, uid: MEMBER },
          { id: 2, time: 456, unionid: 8, type: 1, uid: 9999 },
        ],
      },
      { match: /select name from sys_union/i, params: [UNION], rows: [{ name: '盟九' }] },
      { match: /select name from sys_user/i, params: [MEMBER], rows: [{ name: '成员' }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getLuoyangEvent()) as Record<string, unknown>[];
    expect(res[0]).toMatchObject({ id: 1, unionName: '盟九', userName: '成员' });
    // 查不到的名字照 PHP 的 fetch_one_cell 语义为 false。
    expect(res[1]).toMatchObject({ id: 2, unionName: false, userName: false });
  });
});

describe('LuoyangBelongCommands.getLYBelongInfo', () => {
  it('returns the seed row with false names, the battle field and isCanSend=false', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      LY_SEED,
      {
        match: /select \* from cfg_battle_field where id = \?/i,
        rows: [{ id: 12001, content: '洛阳战场' }],
      },
      { match: /select \* from log_luoyang_belong where time >= \?/i, rows: [] },
      NO(/.*/),
    ]);
    const [info, battle, isCanSend] = (await cmd.getLYBelongInfo(ctx)) as [
      Record<string, unknown>,
      Record<string, unknown>,
      boolean,
    ];
    expect(info).toMatchObject({ uid: 710, name: '贞观', userName: false, unionName: false });
    expect(info).not.toHaveProperty('yearCount');
    expect(battle).toEqual({ id: 12001, content: '洛阳战场' });
    expect(isCanSend).toBe(false);
    // 周界：本周窗口起点是上周三 23:00。
    const logQuery = db.executed.find((q) => /log_luoyang_belong where time >= \?/.test(q.sql));
    expect(logQuery?.parameters[0]).toBe(START);
  });

  it('overlays yearCount from this week’s allocation record', async () => {
    const { cmd } = build([
      ...CLOCK,
      LY_SEED,
      NO(/select \* from cfg_battle_field/i),
      {
        match: /select \* from log_luoyang_belong where time >= \?/i,
        rows: [{ uid: MEMBER, unionid: UNION, time: NOW, count: 3 }],
      },
      NO(/.*/),
    ]);
    const [info] = (await cmd.getLYBelongInfo(ctx)) as [Record<string, unknown>, unknown, unknown];
    expect(info).toMatchObject({ uid: 710, yearCount: 3 });
  });

  it('keeps the PHP auto-vivification when sys_luoyang_info is empty but a record exists', async () => {
    const { cmd } = build([
      ...CLOCK,
      { match: /select \* from sys_luoyang_info$/i, rows: [] },
      NO(/select \* from cfg_battle_field/i),
      {
        match: /select \* from log_luoyang_belong where time >= \?/i,
        rows: [{ count: 2 }],
      },
      NO(/.*/),
    ]);
    const [info] = (await cmd.getLYBelongInfo(ctx)) as [Record<string, unknown>, unknown, unknown];
    expect(info).toEqual({ yearCount: 2 });
  });
});

describe('LuoyangBelongCommands point rankings', () => {
  it('getUnionRankPoint: totals with rank and union/leader names; empty table → []', async () => {
    const empty = build([NO(/.*/)]);
    expect(await empty.cmd.getUnionRankPoint()).toEqual([]);

    const { cmd } = build([
      {
        match: /select unionid, sum\(score\) as totalScore/i,
        rows: [
          { unionid: UNION, totalScore: 50 },
          { unionid: 8, totalScore: 30 },
        ],
      },
      {
        match: /select name,\s*\(select name from sys_user where uid = leader\)/i,
        params: [UNION],
        rows: [{ name: '盟九', leaderName: '君主甲' }],
      },
      {
        match: /select name,\s*\(select name from sys_user where uid = leader\)/i,
        params: [8],
        rows: [],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getUnionRankPoint()) as Record<string, unknown>[];
    expect(res[0]).toMatchObject({
      unionid: UNION,
      totalScore: 50,
      rank: 1,
      unionName: '盟九',
      leaderName: '君主甲',
    });
    // 联盟缺失时 PHP 读 false['name'] → null。
    expect(res[1]).toMatchObject({ rank: 2, unionName: null, leaderName: null });
  });

  it('getUserRankPoint: rows ordered by score with per-row names', async () => {
    const empty = build([NO(/.*/)]);
    expect(await empty.cmd.getUserRankPoint()).toEqual([]);

    const { cmd } = build([
      {
        match: /select \* from sys_user_luoyang order by score desc/i,
        rows: [
          { uid: MEMBER, unionid: UNION, score: 5, second: 1 },
          { uid: 9999, unionid: 8, score: 2, second: 0 },
        ],
      },
      {
        match: /select name from sys_user where uid = \?/i,
        params: [MEMBER],
        rows: [{ name: '成员' }],
      },
      {
        match: /select name from sys_union where id = \?/i,
        params: [UNION],
        rows: [{ name: '盟九' }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getUserRankPoint()) as Record<string, unknown>[];
    expect(res[0]).toMatchObject({ uid: MEMBER, rank: 1, name: '成员', unionName: '盟九' });
    expect(res[1]).toMatchObject({ uid: 9999, rank: 2, name: false, unionName: false });
  });

  it('getUserInfoPoint: own score (0 without a row) and both-direction events', async () => {
    const { cmd } = build([
      { match: /select score from sys_user_luoyang where uid = \?/i, rows: [] },
      {
        match: /from mem_luoyang_event where uid = \? or touid = \?/i,
        rows: [
          {
            uid: MEMBER,
            name: '成员',
            cityname: '洛阳',
            touid: UID,
            toname: '君主甲',
            score: 3,
            flag: 1,
          },
        ],
      },
      NO(/.*/),
    ]);
    expect(await cmd.getUserInfoPoint(ctx)).toEqual([
      0,
      [
        {
          uid: MEMBER,
          name: '成员',
          cityname: '洛阳',
          touid: UID,
          toname: '君主甲',
          score: 3,
          flag: 1,
        },
      ],
    ]);

    const withScore = build([
      { match: /select score from sys_user_luoyang where uid = \?/i, rows: [{ score: 42 }] },
      NO(/from mem_luoyang_event/i),
      NO(/.*/),
    ]);
    expect(await withScore.cmd.getUserInfoPoint(ctx)).toEqual([42, []]);
  });
});

describe('LuoyangBelongCommands.luoyangAllocate', () => {
  it('rejects while the seed holder uid < 1000', async () => {
    const { cmd } = build([LY_SEED, NO(/.*/)]);
    await expect(cmd.luoyangAllocate(ctx, ['成员'])).rejects.toThrow('luoyang.can_not_assign');
  });

  it('rejects when the caller’s union does not hold 洛阳', async () => {
    const { cmd } = build([
      {
        match: /select \* from sys_luoyang_info$/i,
        rows: [{ uid: 1002, unionid: UNION, name: '成员' }],
      },
      { match: /select 1 from sys_user where uid = \?\s*and union_id = \?/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(cmd.luoyangAllocate(ctx, ['成员'])).rejects.toThrow('luoyang.city_not_in_union');
  });

  it('rejects a non-leader and an unknown member', async () => {
    const info: Respond = {
      match: /select \* from sys_luoyang_info$/i,
      rows: [{ uid: 1002, unionid: UNION, name: '成员' }],
    };
    const inUnion: Respond = {
      match: /select 1 from sys_user where uid = \?\s*and union_id = \?/i,
      rows: [{ 1: 1 }],
    };
    const noLeader = build([
      info,
      inUnion,
      { match: /select 1 from sys_union/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(noLeader.cmd.luoyangAllocate(ctx, ['成员'])).rejects.toThrow(
      'luoyang.not_union_leader',
    );

    const noPreRecord = build([
      info,
      inUnion,
      { match: /select 1 from sys_union/i, rows: [{ 1: 1 }] },
      { match: /select \* from log_luoyang_belong order by time desc/i, rows: [] },
      { match: /select uid from sys_user where union_id = \? and name = \?/i, rows: [] },
      NO(/.*/),
    ]);
    await expect(noPreRecord.cmd.luoyangAllocate(ctx, ['路人'])).rejects.toThrow(
      'luoyang.not_union_member',
    );
  });

  it('rejects a repeated allocation inside the same window', async () => {
    const { cmd } = build([
      ...CLOCK,
      {
        match: /select \* from sys_luoyang_info$/i,
        rows: [{ uid: 1002, unionid: UNION, name: '成员' }],
      },
      { match: /select 1 from sys_user where uid = \?\s*and union_id = \?/i, rows: [{ 1: 1 }] },
      { match: /select 1 from sys_union/i, rows: [{ 1: 1 }] },
      {
        match: /select \* from log_luoyang_belong order by time desc/i,
        rows: [{ uid: MEMBER, unionid: UNION, time: NOW - 100, count: 1 }],
      },
      {
        match: /select 1 from log_luoyang_belong where time >= \?/i,
        params: [START],
        rows: [{ 1: 1 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.luoyangAllocate(ctx, ['成员'])).rejects.toThrow('luoyang.has_allocated');
  });

  it('first allocation: count=1 record, holder row, event, 王爵位 buffer and nobility 21', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      {
        match: /select \* from sys_luoyang_info$/i,
        rows: [{ uid: 1002, unionid: UNION, name: '成员' }],
      },
      { match: /select 1 from sys_user where uid = \?\s*and union_id = \?/i, rows: [{ 1: 1 }] },
      { match: /select 1 from sys_union/i, rows: [{ 1: 1 }] },
      { match: /select \* from log_luoyang_belong order by time desc/i, rows: [] },
      {
        match: /select uid from sys_user\s+where union_id = \? and name = \?/i,
        params: [UNION, '成员'],
        rows: [{ uid: MEMBER }],
      },
      {
        match: /select \(21 - nobility\) as addLevel/i,
        params: [MEMBER],
        rows: [{ addLevel: 14 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.luoyangAllocate(ctx, ['成员'])).toEqual(['您已成功将洛阳分配给成员']);

    const insert = db.executed.find((q) => /insert into log_luoyang_belong/i.test(q.sql));
    expect(insert?.parameters).toEqual([MEMBER, UNION, 1]);
    const update = db.executed.find((q) => /update sys_luoyang_info set uid/i.test(q.sql));
    expect(update?.parameters).toEqual([MEMBER, '成员']);
    expect(db.executed.some((q) => /insert into mem_luoyang_record/i.test(q.sql))).toBe(true);
    const buffer = db.executed.find((q) => /insert into mem_user_buffer/i.test(q.sql));
    expect(buffer?.parameters).toEqual([MEMBER, 130527, 14]);
    const nobility = db.executed.find((q) => /update sys_user set nobility/i.test(q.sql));
    expect(nobility?.parameters).toEqual([MEMBER]);
  });

  it('continues the streak from the last record — the dead $isGap branch never resets', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      {
        match: /select \* from sys_luoyang_info$/i,
        rows: [{ uid: 1002, unionid: UNION, name: '成员' }],
      },
      { match: /select 1 from sys_user where uid = \?\s*and union_id = \?/i, rows: [{ 1: 1 }] },
      { match: /select 1 from sys_union/i, rows: [{ 1: 1 }] },
      {
        match: /select \* from log_luoyang_belong order by time desc/i,
        rows: [{ uid: MEMBER, unionid: UNION, time: START - 30 * 86400, count: 4 }],
      },
      // 上一条在窗口外很多周，但原版 $isGap 恒 false，仍然续算 count。
      { match: /select 1 from log_luoyang_belong where time >= \?/i, params: [START], rows: [] },
      {
        match: /select uid from sys_user\s+where union_id = \? and name = \?/i,
        rows: [{ uid: MEMBER }],
      },
      { match: /select \(21 - nobility\) as addLevel/i, rows: [{ addLevel: 14 }] },
      NO(/.*/),
    ]);
    await cmd.luoyangAllocate(ctx, ['成员']);
    const insert = db.executed.find((q) => /insert into log_luoyang_belong/i.test(q.sql));
    expect(insert?.parameters).toEqual([MEMBER, UNION, 5]);
  });
});

describe('LuoyangBelongCommands.sendBelongInform', () => {
  it('rejects a non-holder', async () => {
    const { cmd } = build([...CLOCK, NO_BELONG_THIS_WEEK, LY_SEED, NO(/.*/)]);
    await expect(cmd.sendBelongInform(ctx)).rejects.toThrow('luoyang.can_not_send');
  });

  it('sends once per day: resets yesterday’s stamp, files the inform and stamps now', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      BELONG_THIS_WEEK,
      LY_OWNED,
      // 昨天（< 今日 00:00）发过 → 先清零。
      {
        match: /select 1 from sys_luoyang_info\s+where last_send_inform < \?/i,
        rows: [{ 1: 1 }],
      },
      { match: /select 1 from sys_luoyang_info where last_send_inform > 0/i, rows: [] },
      NO(/.*/),
    ]);
    expect(await cmd.sendBelongInform(ctx)).toEqual([false]);

    const reset = db.executed.find((q) =>
      /update sys_luoyang_info set last_send_inform = '0'/i.test(q.sql),
    );
    expect(reset).toBeDefined();
    const inform = db.executed.find((q) => /insert into sys_inform/i.test(q.sql));
    expect(inform?.parameters).toEqual(['吾皇万岁万岁万万岁！']);
    expect(inform?.sql).toContain('49151');
    const stamp = db.executed.find((q) =>
      /update sys_luoyang_info set last_send_inform = unix_timestamp\(\)/i.test(q.sql),
    );
    expect(stamp).toBeDefined();
  });

  it('rejects a second inform on the same day', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      BELONG_THIS_WEEK,
      LY_OWNED,
      { match: /select 1 from sys_luoyang_info\s+where last_send_inform < \?/i, rows: [] },
      { match: /select 1 from sys_luoyang_info where last_send_inform > 0/i, rows: [{ 1: 1 }] },
      NO(/.*/),
    ]);
    await expect(cmd.sendBelongInform(ctx)).rejects.toThrow('luoyang.has_send_inform');
    expect(wrote(db, /insert into sys_inform/i)).toHaveLength(0);
  });
});

describe('LuoyangBelongCommands.openUnionZhaoAn', () => {
  it('rejects a non-holder and a repeat use', async () => {
    const noOwn = build([...CLOCK, NO_BELONG_THIS_WEEK, LY_SEED, NO(/.*/)]);
    await expect(noOwn.cmd.openUnionZhaoAn(ctx)).rejects.toThrow('luoyang.can_not_send');

    const used = build([
      ...CLOCK,
      BELONG_THIS_WEEK,
      LY_OWNED,
      { match: /select 1 from sys_luoyang_info where last_use_buffer > 0/i, rows: [{ 1: 1 }] },
      NO(/.*/),
    ]);
    await expect(used.cmd.openUnionZhaoAn(ctx)).rejects.toThrow('luoyang.has_used');
  });

  it('grants the 72h buffer to every member and stamps last_use_buffer', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      BELONG_THIS_WEEK,
      LY_OWNED,
      { match: /select 1 from sys_luoyang_info where last_use_buffer > 0/i, rows: [] },
      {
        match: /select union_id from sys_user where uid = \?/i,
        params: [UID],
        rows: [{ union_id: UNION }],
      },
      {
        match: /select uid from sys_user where union_id = \?/i,
        rows: [{ uid: UID }, { uid: MEMBER }, { uid: 1003 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.openUnionZhaoAn(ctx)).toEqual([true]);

    const buffers = wrote(db, /insert into mem_user_buffer/i);
    expect(buffers).toHaveLength(3);
    expect(buffers[0]?.sql).toContain('on duplicate key update endtime = endtime + ?');
    expect(buffers[0]?.parameters).toEqual([UID, 10333, 259200, 259200]);
    expect(buffers[2]?.parameters).toEqual([1003, 10333, 259200, 259200]);
    expect(
      db.executed.some((q) => /update sys_luoyang_info set last_use_buffer/i.test(q.sql)),
    ).toBe(true);
  });
});

describe('LuoyangBelongCommands.getLuoyangGovernCount', () => {
  it('rejects a non-holder', async () => {
    const { cmd } = build([...CLOCK, NO_BELONG_THIS_WEEK, LY_SEED, NO(/.*/)]);
    await expect(cmd.getLuoyangGovernCount(ctx)).rejects.toThrow('luoyang.can_not_send');
  });

  it('resets the stale 2008 seed row and answers 0', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      BELONG_THIS_WEEK,
      LY_OWNED,
      {
        match: /select \* from mem_city_schedule where cid = \?/i,
        params: [LY],
        rows: [{ cid: LY, last_govern_time: 1225281386, govern_count: 0 }],
      },
      {
        match: /select govern_count from mem_city_schedule where cid = \?/i,
        rows: [{ govern_count: 0 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.getLuoyangGovernCount(ctx)).toEqual([0]);
    expect(
      db.executed.some((q) =>
        /update mem_city_schedule set last_govern_time = '0', govern_count = '0'/i.test(q.sql),
      ),
    ).toBe(true);
  });

  it('creates the missing schedule row, still resets it and answers 0', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      BELONG_THIS_WEEK,
      LY_OWNED,
      { match: /select \* from mem_city_schedule where cid = \?/i, params: [LY], rows: [] },
      {
        match: /select govern_count from mem_city_schedule where cid = \?/i,
        rows: [{ govern_count: 0 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.getLuoyangGovernCount(ctx)).toEqual([0]);
    expect(
      db.executed.some((q) =>
        /insert into mem_city_schedule \(cid, last_govern_time\)/i.test(q.sql),
      ),
    ).toBe(true);
    // 快照取自补建之前（PHP 读到 false → 0 < 今日）→ 照走清零。
    expect(
      db.executed.some((q) =>
        /update mem_city_schedule set last_govern_time = '0', govern_count = '0'/i.test(q.sql),
      ),
    ).toBe(true);
  });
});

describe('LuoyangBelongCommands.governLuoyangOthers', () => {
  it('rejects coordinates outside 0..500 before anything else', async () => {
    const { cmd } = build([NO(/.*/)]);
    await expect(cmd.governLuoyangOthers(ctx, [0, 501, 300])).rejects.toThrow(
      'luoyang.govern_coord_error',
    );
    await expect(cmd.governLuoyangOthers(ctx, [0, 400, -1])).rejects.toThrow(
      'luoyang.govern_coord_error',
    );
  });

  it('rejects a non-holder', async () => {
    const { cmd } = build([...CLOCK, NO_BELONG_THIS_WEEK, LY_SEED, NO(/.*/)]);
    await expect(cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'luoyang.can_not_send',
    );
  });

  it('runs the target checks in the original order', async () => {
    const noCity = governRules({
      targetCity: {
        match: /select uid, type, province from sys_city\s+where cid = \?/i,
        params: [TARGET],
        rows: [],
      },
    });
    await expect(build(noCity).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'luoyang.target_is_not_city',
    );

    const ownCity = governRules({ targetCity: TARGET_CITY(UID, 0, 5) });
    await expect(build(ownCity).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'luoyang.target_can_not_user',
    );

    const outOfRange = governRules({ targetCity: TARGET_CITY(MEMBER, 0, 14) });
    await expect(build(outOfRange).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'luoyang.over_govern_range',
    );

    // 无守卫的联盟比较：目标与自己都无联盟（0 == 0）也拒绝。
    const bothUnionless = governRules({
      targetUnion: UNION_OF(MEMBER, 0),
      myUnion: UNION_OF(UID, 0),
    });
    await expect(build(bothUnionless).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'luoyang.target_can_not_union',
    );

    const overMax = governRules({ overMax: { match: /govern_count >= 10/i, rows: [{ 1: 1 }] } });
    await expect(build(overMax).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'luoyang.target_over_max',
    );

    const governedToday = governRules({
      schedule: {
        match: /select \* from mem_city_schedule\s+where cid = \?/i,
        params: [TARGET],
        rows: [{ cid: TARGET, last_be_govern_time: NOW - 60 }],
      },
    });
    await expect(build(governedToday).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'governOthers.target_has_been_govern',
    );

    const forbidden = governRules({
      userState: {
        match: /sys_user_state/i,
        rows: [{ forbiend: NOW + 100, vacend: 0, nowtime: NOW }],
      },
    });
    await expect(build(forbidden).cmd.governLuoyangOthers(ctx, [0, 400, 300])).rejects.toThrow(
      'governOthers.target_not_in_war',
    );
  });

  it('征税 (type 0): moves 20% gold, files the report naming 洛阳 (265,215) and returns the text', async () => {
    const { cmd, db } = build([
      ...governRules(),
      RESOURCE_OF('gold', 1000),
      {
        match: /select uid from sys_city where cid = \?/i,
        params: [TARGET],
        rows: [{ uid: MEMBER }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.governLuoyangOthers(ctx, [0, 400, 300])).toEqual(['收税成功，获得黄金200。']);

    const moves = wrote(db, /update mem_city_resource set wood = wood \+ \?, rock = rock \+ \?/i);
    expect(moves[0]?.parameters).toEqual(['0', '0', '0', '0', '-200', TARGET]);
    expect(moves[1]?.parameters).toEqual(['0', '0', '0', '0', '200', MY_CID]);
    const report = db.executed.find((q) => /insert into sys_report/i.test(q.sql));
    expect(report?.parameters[0]).toBe(MEMBER);
    expect(report?.parameters[1]).toBe(MY_CID);
    expect(report?.parameters[3]).toBe(TARGET);
    expect(report?.parameters.at(-1)).toBe('洛阳城（265,215）向你征收税赋，你损失黄金200。');
    expect(
      db.executed.some((q) =>
        /update mem_city_schedule set govern_count = govern_count \+ 1/i.test(q.sql),
      ),
    ).toBe(true);
    const beGoverned = db.executed.find((q) =>
      /update mem_city_schedule set last_be_govern_time/i.test(q.sql),
    );
    expect(beGoverned?.parameters).toEqual([TARGET]);
  });

  it('抽丁 (type 1): moves 30% people', async () => {
    const { cmd, db } = build([
      ...governRules(),
      RESOURCE_OF('people', 1000),
      {
        match: /select uid from sys_city where cid = \?/i,
        params: [TARGET],
        rows: [{ uid: MEMBER }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.governLuoyangOthers(ctx, [1, 400, 300])).toEqual(['抽丁成功，获得人口300。']);
    const moves = wrote(db, /update mem_city_resource set people = people \+ \?/i);
    expect(moves[0]?.parameters).toEqual(['-300', TARGET]);
    expect(moves[1]?.parameters).toEqual(['300', MY_CID]);
    expect(db.executed.some((q) => /insert into sys_report/i.test(q.sql))).toBe(true);
  });

  it('征粮 (type 2): moves 50% food', async () => {
    const { cmd, db } = build([
      ...governRules(),
      RESOURCE_OF('food', 1000),
      {
        match: /select uid from sys_city where cid = \?/i,
        params: [TARGET],
        rows: [{ uid: MEMBER }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.governLuoyangOthers(ctx, [2, 400, 300])).toEqual(['征粮成功，增加粮食500。']);
    const moves = wrote(db, /update mem_city_resource set wood = wood \+ \?, rock = rock \+ \?/i);
    expect(moves[0]?.parameters).toEqual(['0', '0', '0', '-500', '0', TARGET]);
    expect(moves[1]?.parameters).toEqual(['0', '0', '0', '500', '0', MY_CID]);
  });

  it('收编 (type 3): takes 5% of the top fromcity soldier row, the holder gets half', async () => {
    const { cmd, db } = build([
      ...governRules(),
      {
        match: /from sys_city_soldier a,\s*cfg_soldier b/i,
        rows: [{ sid: 4, count: 1000 }],
      },
      { match: /select name from cfg_soldier where sid = \?/i, rows: [{ name: '长枪兵' }] },
      {
        match: /select uid from sys_city where cid = \?/i,
        params: [TARGET],
        rows: [{ uid: MEMBER }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.governLuoyangOthers(ctx, [3, 400, 300])).toEqual(['收编成功，增加长枪兵25。']);
    const soldierWrites = wrote(db, /insert into sys_city_soldier/i);
    // on-dup 子句把同样的数值再绑一次。
    expect(soldierWrites[0]?.parameters).toEqual([TARGET, 4, '-50', '-50']);
    expect(soldierWrites[1]?.parameters).toEqual([MY_CID, 4, '25', '25']);
    expect(soldierWrites).toHaveLength(2);
  });

  it('裁军 (type 4): cuts 10% of the biggest row and grants the holder nothing', async () => {
    const { cmd, db } = build([
      ...governRules(),
      {
        match: /select sid, count from sys_city_soldier\s+where cid = \? order by count desc/i,
        rows: [{ sid: 1, count: 100 }],
      },
      { match: /select name from cfg_soldier where sid = \?/i, rows: [{ name: '民弓' }] },
      {
        match: /select uid from sys_city where cid = \?/i,
        params: [TARGET],
        rows: [{ uid: MEMBER }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.governLuoyangOthers(ctx, [4, 400, 300])).toEqual([
      '裁军成功，对方减少民弓10。',
    ]);
    const soldierWrites = wrote(db, /insert into sys_city_soldier/i);
    expect(soldierWrites).toHaveLength(1);
    expect(soldierWrites[0]?.parameters).toEqual([TARGET, 1, '-10', '-10']);
  });

  it('an unknown type still bumps the schedule and returns the empty message', async () => {
    const { cmd, db } = build([
      ...governRules(),
      {
        match: /select uid from sys_city where cid = \?/i,
        params: [TARGET],
        rows: [{ uid: MEMBER }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.governLuoyangOthers(ctx, [9, 400, 300])).toEqual(['']);
    expect(
      db.executed.some((q) =>
        /update mem_city_schedule set govern_count = govern_count \+ 1/i.test(q.sql),
      ),
    ).toBe(true);
    expect(
      db.executed.some((q) => /update mem_city_schedule set last_be_govern_time/i.test(q.sql)),
    ).toBe(true);
  });
});

describe('LuoyangBelongCommands.getBeiZhanLuoYangProgress', () => {
  it('rejects a non-zero type and union-less users', async () => {
    const inUnion = build([
      ...CLOCK,
      {
        match: /select union_id from sys_user where uid = \?/i,
        params: [UID],
        rows: [{ union_id: UNION }],
      },
      NO(/.*/),
    ]);
    await expect(inUnion.cmd.getBeiZhanLuoYangProgress(ctx, [1])).rejects.toThrow(
      'rankfunc.uniontask',
    );

    const unionless = build([
      ...CLOCK,
      {
        match: /select union_id from sys_user where uid = \?/i,
        params: [UID],
        rows: [{ union_id: 0 }],
      },
      NO(/.*/),
    ]);
    await expect(unionless.cmd.getBeiZhanLuoYangProgress(ctx, [0])).rejects.toThrow(
      'rankfunc.uniontask',
    );
  });

  it('seeds the four union tasks from cfg_task/cfg_task_goal and answers the progress rows', async () => {
    const { cmd, db } = build([
      ...CLOCK,
      {
        match: /select union_id from sys_user where uid = \?/i,
        params: [UID],
        rows: [{ union_id: UNION }],
      },
      {
        match: /select \* from cfg_task where id = \? limit 1/i,
        rows: [{ id: 112001, group: 112001, name: '搜集罪证' }],
      },
      {
        match: /select count from cfg_task_goal where sort = \?\s+and type = \?/i,
        rows: [{ count: 400 }],
      },
      {
        match: /select tid, name, maxvalue, curvalue,\s*maxvalue - curvalue as remainvalue/i,
        rows: [{ tid: 112001, name: '搜集罪证', maxvalue: 400, curvalue: 100, remainvalue: 300 }],
      },
      NO(/.*/),
    ]);
    expect(await cmd.getBeiZhanLuoYangProgress(ctx, [0])).toEqual([
      { tid: 112001, name: '搜集罪证', maxvalue: 400, curvalue: 100, remainvalue: 300 },
    ]);

    const inserts = wrote(db, /insert into luoyang_progress/i);
    expect(inserts).toHaveLength(4);
    // curvalue 的 0 是模板内联字面量，不是绑定参数。
    expect(inserts[0]?.parameters).toEqual([UNION, 112001, 400, 112001, '搜集罪证']);
    expect(inserts[0]?.sql).toContain('on duplicate key update curvalue = curvalue');
    expect(inserts[3]?.parameters).toEqual([UNION, 112004, 400, 112001, '搜集罪证']);
  });
});
