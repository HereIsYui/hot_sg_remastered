import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { Building, CityRules, cid2wid } from '../core/city-rules.service';
import { GoodsRules } from '../core/goods-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { CityMergeCommands } from './city-merge.commands';

const lang = new LangService({
  MergeCity: {
    used: '您已经使用过名称契约，不能再次合成名城',
    no_mingchengqiyue: '您没有名城契约。',
    not_in_peace: '被合并城池合并时需处于和平状态',
    must_be_user_city: '被合成的分城不是普通城池。',
    not_your_city: '您选择合并的城池已被占领，不能进行合并。请重新选择城池再合并！',
    cannot_be_spacial_city: '您选择的城池是神兵之城，不能进行合并。请重新选择一座普通城池！',
    cannot_be_isSpecial: '您选择的主城池是王者之城，不能进行合并。请重新选择一座普通城池作为主城！',
    cannot_be_famous_city: '您选择的主城池是名城，不能进行合并。请重新选择一座普通城池作为主城！',
    sub_city_not_empty:
      '合并城池时，分城不能有任何军队和将领，请先把分城内的军队和将领派往其他城池，再继续使用合城功能。',
    government_not_enough_level: '合并城池时，作为主城的城池官府必须达到10级。',
    nobility: '升级%s级的官府，需要君主爵位达到%s',
    bak_error: '分城备份失败，请重试！',
    table_start:
      '<table border=0 cellspacing=1 cellpadding=1 bgcolor="#FFFFFF"><tr><td bgcolor="#17292B"><strong>建筑</strong></td><td bgcolor="#17292B"><strong>升级</strong></td></tr>',
    table_item_1: '<tr><td bgcolor="#17292B">',
    table_item_2: '</td><td bgcolor="#17292B">',
    table_item_3: '</td></tr>',
    table_end: '</table>',
  },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };
const UID = 1001;
const MAIN = 209355;
const SUB = 242457;

const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new CityMergeCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    new GoodsRules(db.scope),
    new UserRules(db.scope),
  );
  return { cmd, db };
}

function find(db: FakeDb, re: RegExp) {
  return db.executed.filter((q) => re.test(q.sql));
}

/** 同一条 SQL 首次返回 first、之后返回 then，复刻「update 之后重读」的库状态。 */
function thenAfter(
  first: Record<string, unknown>[],
  then: Record<string, unknown>[],
  match: RegExp,
): Respond {
  let calls = 0;
  return {
    match,
    get rows() {
      return calls++ === 0 ? first : then;
    },
  };
}

const typeOf = (cid: number, type: number): Respond => ({
  match: /^select type from sys_city where cid = \?$/,
  params: [cid],
  rows: [{ type }],
});
const NOBLE = (nobility: number): Respond => ({
  match: /^select nobility from sys_user where uid = \?$/,
  rows: [{ nobility }],
});
/** checkUserNobility 的官府等级查询（原版 SQL 顺序是 bid 在前）。 */
const NOB_GLEVEL = (level: number): Respond => ({
  match: /^select level from sys_building where bid = 6 and cid = \?$/,
  rows: [{ level }],
});
const OWNED = (cid: number): Respond => ({
  match: /^select 1 from sys_city where cid = \? and uid = \?$/,
  params: [cid, UID],
  rows: [{ 1: 1 }],
});
const SPECIAL = (cid: number, sid = 0): Respond => ({
  match: /^select sid from cfg_soldier_special_city where cid = \? and type <> '4'$/,
  params: [cid],
  rows: sid > 0 ? [{ sid }] : [],
});
const MAIN_TYPE = (type: number): Respond => ({
  match: /^select `type` from sys_city where cid = \? and uid = \?$/,
  rows: [{ type }],
});
const HERO_CNT = (n: number): Respond => ({
  match: /^select count\(\*\) from sys_city_hero where cid = \? and uid = \?$/,
  rows: [{ 'count(*)': n }],
});
const TROOP_CNT = (n: number): Respond => ({
  match: /^select count\(\*\) from sys_troops where cid = \?$/,
  rows: [{ 'count(*)': n }],
});
/** 官府等级：校验时 first（10 级），官府 +1 后的重读 then（11 级）。 */
const govLevel = (first = 10, then = 11): Respond =>
  thenAfter(
    [{ level: first }],
    [{ level: then }],
    /^select level from sys_building where cid = \? and bid = 6$/,
  );

/** checkCityMerge 走到城池归属一步之前的规则（名城契约在手、爵位足够、分城和平普通城）。 */
const UP_TO_OWNERSHIP: Respond[] = [
  typeOf(MAIN, 0),
  NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
  { match: /^select count from sys_goods where gid = 160052 and uid = \?$/, rows: [{ count: 1 }] },
  NOBLE(12),
  NOB_GLEVEL(10),
  NO(/^select state from mem_world where type = 0 and ownercid = \?$/),
  typeOf(SUB, 0),
];
/** checkCityMerge 走到分城驻军检查之前的规则。 */
const UP_TO_GARRISON: Respond[] = [
  ...UP_TO_OWNERSHIP,
  OWNED(MAIN),
  OWNED(SUB),
  SPECIAL(MAIN),
  SPECIAL(SUB),
  NO(/^select 1 from sys_city where cid = \? and is_special = '2'$/),
  MAIN_TYPE(0),
];

/** 升到每级的四项资源（upgrade_food/wood/rock/iron）。 */
const levelsTable = (food: number, wood: number, rock: number, iron: number) =>
  Array.from({ length: 10 }, (_, i) => ({
    level: i + 1,
    upgrade_food: food,
    upgrade_wood: wood,
    upgrade_rock: rock,
    upgrade_iron: iron,
  }));
const houseLevels = levelsTable(100, 10, 10, 10);
const farmLevels = levelsTable(50, 50, 50, 50);
const armyLevels = levelsTable(150, 15, 15, 15);

/** getUpgradeResource 的 flag=true 查询（只到 10 级）。 */
const CFG_LEVEL_FLAG = (bid: number, rows: Record<string, unknown>[]): Respond => ({
  match: /FROM cfg_building_level\s+WHERE bid = \? and level <= 10 order by level$/,
  params: [bid],
  rows,
});
/** getUpgradeResource 的全量查询。 */
const CFG_LEVEL_ALL = (rows: Record<string, unknown>[]): Respond => ({
  match: /FROM cfg_building_level\s+WHERE bid = \? order by level$/,
  rows,
});

/** mergeCity 前后各读一次的建筑快照。 */
const SNAPSHOT_ORIGINAL = [
  { bid: 6, name: '官府', levels: '10' },
  { bid: 5, name: '民房', levels: '2' },
  { bid: 9, name: '军营', levels: '2' },
  { bid: 1, name: '农田', levels: '1,2' },
];
const SNAPSHOT_NOW = [
  { bid: 6, name: '官府', levels: '11' },
  { bid: 5, name: '民房', levels: '8' },
  { bid: 9, name: '军营', levels: '6' },
  { bid: 1, name: '农田', levels: '4,4' },
];
const snapshots = (
  original: Record<string, unknown>[] = SNAPSHOT_ORIGINAL,
  now: Record<string, unknown>[] = SNAPSHOT_NOW,
): Respond => thenAfter(original, now, /group_concat\(b\.level\)/);

/** doMergeCity 的分城建筑查询（inner 0 城外 / 1 城内）。 */
const SUB_BUILDINGS = (inner: number, rows: Record<string, unknown>[]): Respond => ({
  match:
    /FROM sys_building sys, cfg_building cfg\s+where sys\.bid = cfg\.bid AND cfg\.inner = \? and sys\.cid = \?$/,
  params: [inner, SUB],
  rows,
});
/** upgradeMainCityBuilding 的主城建筑查询。 */
const MAIN_BUILDINGS = (inner: number, rows: Record<string, unknown>[]): Respond => ({
  match: /FROM sys_building sb, cfg_building_merge cbm, cfg_building cb/,
  params: [MAIN, inner],
  rows,
});

/** 只有 (6, 11)（官府 11 级）能命中 sort=6 的任务目标；其余 count<=10 恒为空。 */
const GOAL_6_11: Respond = {
  match:
    /^select id from cfg_task_goal where sort = 6 and count > 10 and type = \? and count = \?$/,
  params: [6, 11],
  rows: [{ id: 900001 }],
};
const NO_GOAL: Respond = {
  match:
    /^select id from cfg_task_goal where sort = 6 and count > 10 and type = \? and count = \?$/,
  rows: [],
};

const SUB_HOUSES = [
  { bid: 5, level: 2 },
  { bid: 5, level: 12 },
];
const SUB_FARMS = [
  { bid: 1, level: 1 },
  { bid: 1, level: 4 },
];
const MAIN_INNER = [
  { bid: 5, level: 2, xy: 101 },
  { bid: 9, level: 2, xy: 102 },
];
const MAIN_OUTER = [
  { bid: 1, level: 1, xy: 201 },
  { bid: 1, level: 2, xy: 202 },
];

/** 备份、官府 +1、任务目标等通用写入。 */
const COMMON_WRITES: Respond[] = [
  NO(/^replace into \w+_bak/),
  NO(/^insert into log_merge_city/),
  NO(/^update sys_building set level = level \+ 1 where cid = \? and bid = 6$/),
  NO(/^replace into sys_user_goal/),
  NO(/union select xy from mem_building_destroying$/),
];
/** destorySubCity + clearSubCityWild 的写入（分城野地已随 ownercid 清零恒为空）。 */
const DESTORY_WRITES: Respond[] = [
  NO(/^delete from /),
  NO(/^update sys_technic set state = 0 where cid = \?$/),
  NO(/^update mem_world set type = 1, ownercid = 0 where ownercid = \? and type = 0$/),
  NO(/^update mem_world set ownercid = 0 where ownercid = \?$/),
  NO(/^select wid from mem_world where ownercid = \?$/),
];
/** reduceMingchengqiyue：addGoods 的名城契约分支 + count 清零 + type=5。 */
const GOODS_WRITES: Respond[] = [
  NO(/from `log_qiyue` where `uid` = \?/),
  NO(/^insert into sys_goods \(uid, gid, count\)/),
  NO(/^insert into `log_qiyue`/),
  NO(/^update sys_goods set count = 0 where uid = \? and gid = 160052$/),
  NO(/^update sys_city set type = 5 where cid = \?$/),
];
/** updateCityPeopleMax / updateCityGoldMax / updateCityResourceAdd / updateUserPrestige。 */
const REFRESH_WRITES: Respond[] = [
  {
    match:
      /select sum\(level \* \(level \+ 1\) \* 50\) as v from sys_building\s+where cid = \? and bid = \?$/,
    params: [MAIN, Building.House],
    rows: [{ v: 600 }],
  },
  NO(/^update `mem_city_resource` set `people_max` = \?/),
  NO(/set people_stable = people_max \* morale \* 0\.01 where cid = \?$/),
  {
    match: /^select `level` from `sys_building` where `cid` = \? and `bid` = \?$/,
    params: [MAIN, Building.Government],
    rows: [{ level: 11 }],
  },
  NO(/^update `mem_city_resource` set `gold_max` = \?/),
  {
    match: /^select `ownercid` from `mem_world` where `wid` = \?$/,
    params: [cid2wid(MAIN)],
    rows: [{ ownercid: MAIN }],
  },
  NO(/^update `sys_city_res_add`/),
  { match: /^select sum\(r\.people_building\) as v/, rows: [{ v: 10 }] },
  { match: /^select sum\(f\.people_need \* s\.count\) as v/, rows: [{ v: 20 }] },
  { match: /^select sum\(people\) as v from sys_troops/, rows: [{ v: 30 }] },
  { match: /^select warprestige as v from sys_user/, rows: [{ v: 40 }] },
  NO(/^update sys_user set prestige = \? where uid = \?$/),
];
/** makeMergeReport 的战报写入。 */
const REPORT_WRITES: Respond[] = [
  {
    match: /^select name from sys_city where cid = \?$/,
    params: [MAIN],
    rows: [{ name: '长乐城' }],
  },
  NO(/^insert into sys_report/),
  NO(/^insert into sys_alarm/),
];

describe('CityMergeCommands.mergeCity', () => {
  it('merges the sub city: upgrades buildings, folds resources, destroys the sub city', async () => {
    const { cmd, db } = build([
      ...UP_TO_OWNERSHIP,
      ...UP_TO_GARRISON.slice(UP_TO_OWNERSHIP.length),
      HERO_CNT(0),
      NO(/^select sum\(`count`\) from sys_city_soldier/),
      TROOP_CNT(0),
      NO(/^update sys_troops set state = 1 where targetcid = \?$/),
      govLevel(),
      ...COMMON_WRITES,
      snapshots(),
      GOAL_6_11,
      NO_GOAL,
      SUB_BUILDINGS(1, SUB_HOUSES),
      SUB_BUILDINGS(0, SUB_FARMS),
      CFG_LEVEL_FLAG(5, houseLevels),
      CFG_LEVEL_FLAG(1, farmLevels),
      CFG_LEVEL_ALL(armyLevels),
      MAIN_BUILDINGS(1, MAIN_INNER),
      MAIN_BUILDINGS(0, MAIN_OUTER),
      NO(/^update sys_building set level = level \+ 1 where cid = \? and bid = \? and xy = \?$/),
      NO(/^update mem_city_resource set food = food \+/),
      NO(/^update mem_city_resource set wood = wood \+/),
      {
        match: /^select wood, food, iron, rock, gold from mem_city_resource where cid = \?$/,
        params: [SUB],
        rows: [{ wood: 100, food: 200, iron: 300, rock: 400, gold: 500 }],
      },
      ...DESTORY_WRITES,
      ...GOODS_WRITES,
      ...REFRESH_WRITES,
      ...REPORT_WRITES,
      NO(/./),
    ]);
    expect(await cmd.mergeCity(ctx, [MAIN, SUB])).toEqual([1]);

    // 校验阶段：开往分城的军队被召回（在官府等级校验之前）
    expect(find(db, /^update sys_troops set state = 1 where targetcid = \?$/)).toHaveLength(1);
    // 主城官府 +1，之后每次重读都是 11 级
    expect(find(db, /^select level from sys_building where cid = \? and bid = 6$/)).toHaveLength(4);
    expect(
      find(db, /^update sys_building set level = level \+ 1 where cid = \? and bid = 6$/),
    ).toHaveLength(1);

    // 分城建筑折算：民房 L2 + L12（10 级以上折算丢失，只累计 1-10 级）；L12 的 11、12 级
    // 缓存 miss 会重复发起 flag=true 查询；农田 L1 + L4 只查一次
    expect(
      find(db, /WHERE bid = \? and level <= 10 order by level$/).map((q) => q.parameters),
    ).toEqual([[5], [5], [5], [1]]);
    expect(find(db, /WHERE bid = \? order by level$/).map((q) => q.parameters)).toEqual([[9]]);

    // 城内预算 (1200,120,120,120)：每轮民房、军营各升一级（限额计数每轮重置），第 5、6
    // 轮只剩民房升得起，预算耗尽后剩余 0；城外预算 (250,250,250,250)：农田 1 号升 3 级、
    // 2 号升 2 级（每轮两座各 50），资源耗尽后剩余 0
    expect(
      find(
        db,
        /^update sys_building set level = level \+ 1 where cid = \? and bid = \? and xy = \?$/,
      ).map((q) => q.parameters),
    ).toEqual([
      [MAIN, 5, 101],
      [MAIN, 9, 102],
      [MAIN, 5, 101],
      [MAIN, 9, 102],
      [MAIN, 5, 101],
      [MAIN, 9, 102],
      [MAIN, 5, 101],
      [MAIN, 9, 102],
      [MAIN, 5, 101],
      [MAIN, 5, 101],
      [MAIN, 1, 201],
      [MAIN, 1, 202],
      [MAIN, 1, 201],
      [MAIN, 1, 202],
      [MAIN, 1, 201],
    ]);
    expect(
      find(db, /^update mem_city_resource set food = food \+/).map((q) => q.parameters),
    ).toEqual([
      ['0', '0', '0', '0', MAIN],
      ['0', '0', '0', '0', MAIN],
    ]);

    // 分城资源并入主城（wood, rock, iron, food, gold 顺序）
    expect(
      find(db, /^update mem_city_resource set wood = wood \+/).map((q) => q.parameters),
    ).toEqual([['100', '400', '300', '200', '500', MAIN]]);

    // 分城备份 + 合城日志
    expect(find(db, /^replace into \w+_bak/)).toHaveLength(8);
    expect(find(db, /^insert into log_merge_city/)[0]!.parameters).toEqual([UID, SUB]);

    // 分城销毁：sys_building 删两遍（原版 195、206 行），共 25 条 delete
    expect(find(db, /^delete from sys_building where cid = \?$/)).toHaveLength(2);
    expect(find(db, /^delete from /)).toHaveLength(25);
    expect(find(db, /^update mem_world set type = 1, ownercid = 0/)).toHaveLength(1);
    expect(find(db, /^update mem_world set ownercid = 0 where ownercid = \?$/)).toHaveLength(1);

    // 名城契约：addGoods 落 -1 与 log_qiyue，再清零 sys_goods、主城 type=5
    expect(find(db, /^insert into sys_goods \(uid, gid, count\)/)[0]!.parameters).toEqual([
      UID,
      160052,
      -1,
    ]);
    expect(find(db, /^insert into `log_qiyue`/)[0]!.parameters).toEqual([UID, 160052, -1]);
    expect(find(db, /^update sys_goods set count = 0/)[0]!.parameters).toEqual([UID]);
    expect(find(db, /^update sys_city set type = 5/)[0]!.parameters).toEqual([MAIN]);

    // 上限刷新与声望
    expect(find(db, /^update `mem_city_resource` set `people_max` = \?/)[0]!.parameters).toEqual([
      600,
      MAIN,
    ]);
    expect(find(db, /^update `mem_city_resource` set `gold_max` = \?/)[0]!.parameters).toEqual([
      66_000_000,
      MAIN,
    ]);
    expect(find(db, /^update `sys_city_res_add`/)[0]!.parameters).toEqual([1, MAIN]);
    expect(find(db, /^update sys_user set prestige = /)[0]!.parameters).toEqual([100, UID]);

    // 官府 11 级的任务目标 replace 三次（mergeCity + 城内/城外两轮合并各一次）
    expect(find(db, /^replace into sys_user_goal/).map((q) => q.parameters)).toEqual([
      [UID, 900001],
      [UID, 900001],
      [UID, 900001],
    ]);

    // 战报：官府 +1、民房 +6、军营 +4、农田逐座 3,2，title 53 / type 3 / read 0
    const row = (name: string, diff: string) =>
      lang.t('MergeCity.table_item_1') +
      name +
      lang.t('MergeCity.table_item_2') +
      diff +
      lang.t('MergeCity.table_item_3');
    const expectedContent =
      lang.t('MergeCity.table_start') +
      row('官府', '1') +
      row('民房', '6') +
      row('军营', '4') +
      row('农田', '3,2') +
      lang.t('MergeCity.table_end');
    const report = find(db, /^insert into sys_report/);
    expect(report).toHaveLength(1);
    expect(report[0]!.sql).toMatch(
      /values \(\?, \?, \?, \?, \?, 53, 3, unix_timestamp\(\), 0, 0, \?\)/,
    );
    expect(report[0]!.parameters).toEqual([UID, MAIN, '长乐城', MAIN, '长乐城', expectedContent]);
    expect(find(db, /^insert into sys_alarm/)[0]!.parameters).toEqual([UID]);
  });

  it('returns the whole budget to the city when no building can upgrade', async () => {
    const { cmd, db } = build([
      ...UP_TO_OWNERSHIP,
      ...UP_TO_GARRISON.slice(UP_TO_OWNERSHIP.length),
      HERO_CNT(0),
      NO(/^select sum\(`count`\) from sys_city_soldier/),
      TROOP_CNT(0),
      NO(/^update sys_troops set state = 1 where targetcid = \?$/),
      govLevel(),
      ...COMMON_WRITES,
      snapshots(),
      GOAL_6_11,
      NO_GOAL,
      SUB_BUILDINGS(1, SUB_HOUSES),
      SUB_BUILDINGS(0, SUB_FARMS),
      CFG_LEVEL_FLAG(5, houseLevels),
      CFG_LEVEL_FLAG(1, farmLevels),
      CFG_LEVEL_ALL(armyLevels),
      // 全部建筑等级 ≥ 官府 11 级：一轮下来升不了任何建筑
      MAIN_BUILDINGS(1, [
        { bid: 5, level: 11, xy: 101 },
        { bid: 9, level: 11, xy: 102 },
      ]),
      MAIN_BUILDINGS(0, [
        { bid: 1, level: 11, xy: 201 },
        { bid: 1, level: 11, xy: 202 },
      ]),
      NO(/^update sys_building set level = level \+ 1 where cid = \? and bid = \? and xy = \?$/),
      NO(/^update mem_city_resource set food = food \+/),
      NO(/^update mem_city_resource set wood = wood \+/),
      {
        match: /^select wood, food, iron, rock, gold from mem_city_resource where cid = \?$/,
        params: [SUB],
        rows: [{ wood: 0, food: 0, iron: 0, rock: 0, gold: 0 }],
      },
      ...DESTORY_WRITES,
      ...GOODS_WRITES,
      ...REFRESH_WRITES,
      ...REPORT_WRITES,
      NO(/./),
    ]);
    expect(await cmd.mergeCity(ctx, [MAIN, SUB])).toEqual([1]);
    expect(
      find(
        db,
        /^update sys_building set level = level \+ 1 where cid = \? and bid = \? and xy = \?$/,
      ),
    ).toHaveLength(0);
    // 城内 (1200,120,120,120)、城外 (250,250,250,250) 的折算资源全额存回主城
    expect(
      find(db, /^update mem_city_resource set food = food \+/).map((q) => q.parameters),
    ).toEqual([
      ['1200', '120', '120', '120', MAIN],
      ['250', '250', '250', '250', MAIN],
    ]);
  });

  it('rejects a main city that already used a 名城契约', async () => {
    const { cmd } = build([
      typeOf(MAIN, 0),
      {
        match: /^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/,
        rows: [{ 1: 1 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow('MergeCity.used');
  });

  it('rejects when the player owns no 名城契约', async () => {
    const { cmd } = build([
      typeOf(MAIN, 0),
      NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
      { match: /^select count from sys_goods where gid = 160052 and uid = \?$/, rows: [] },
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow('MergeCity.no_mingchengqiyue');
  });

  it('rejects an insufficient nobility with the required rank name', async () => {
    const { cmd } = build([
      typeOf(MAIN, 0),
      NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
      {
        match: /^select count from sys_goods where gid = 160052 and uid = \?$/,
        rows: [{ count: 1 }],
      },
      NOBLE(3),
      NOB_GLEVEL(10),
      // 原版 SQL 里 id 是写死的常量（where id=4），不是参数
      { match: /^select name from cfg_nobility where id = 4$/, rows: [{ name: '大夫' }] },
      NO(/.*/),
    ]);
    const err = (await cmd.mergeCity(ctx, [MAIN, SUB]).catch((e: unknown) => e)) as GameError;
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBe('MergeCity.nobility');
    expect(err.args).toEqual([11, '大夫']);
    expect(lang.messageOf(err)).toBe('升级11级的官府，需要君主爵位达到大夫');
  });

  it('skips the 名城契约 checks when the main city is already type 5', async () => {
    const { cmd, db } = build([
      typeOf(MAIN, 5),
      NOBLE(3),
      NOB_GLEVEL(10),
      // 原版 SQL 里 id 是写死的常量（where id=4），不是参数
      { match: /^select name from cfg_nobility where id = 4$/, rows: [{ name: '大夫' }] },
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow('MergeCity.nobility');
    // type=5 直接跳过名城契约两个查询，走到爵位校验
    expect(find(db, /^select 1 from log_qiyue/)).toHaveLength(0);
    expect(find(db, /^select count from sys_goods/)).toHaveLength(0);
  });

  it('rejects a sub city that is not at peace', async () => {
    const { cmd } = build([
      typeOf(MAIN, 0),
      NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
      {
        match: /^select count from sys_goods where gid = 160052 and uid = \?$/,
        rows: [{ count: 1 }],
      },
      NOBLE(12),
      NOB_GLEVEL(10),
      {
        match: /^select state from mem_world where type = 0 and ownercid = \?$/,
        rows: [{ state: 1 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow('MergeCity.not_in_peace');
  });

  it('rejects a sub city that is not a player city', async () => {
    const { cmd } = build([
      typeOf(MAIN, 0),
      NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
      {
        match: /^select count from sys_goods where gid = 160052 and uid = \?$/,
        rows: [{ count: 1 }],
      },
      NOBLE(12),
      NOB_GLEVEL(10),
      NO(/^select state from mem_world where type = 0 and ownercid = \?$/),
      typeOf(SUB, 3),
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow('MergeCity.must_be_user_city');
  });

  it('rejects when either city is not owned by the player', async () => {
    const mainMissing = build([
      ...UP_TO_OWNERSHIP,
      NO(/^select 1 from sys_city where cid = \? and uid = \?$/),
      OWNED(SUB),
      NO(/.*/),
    ]);
    await expect(mainMissing.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.not_your_city',
    );
    const subMissing = build([
      ...UP_TO_OWNERSHIP,
      OWNED(MAIN),
      NO(/^select 1 from sys_city where cid = \? and uid = \?$/),
      NO(/.*/),
    ]);
    await expect(subMissing.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.not_your_city',
    );
  });

  it('rejects a 神兵之城 as either the main or the sub city', async () => {
    const asMain = build([...UP_TO_GARRISON.slice(0, 9), SPECIAL(MAIN, 5), NO(/.*/)]);
    await expect(asMain.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.cannot_be_spacial_city',
    );
    const asSub = build([...UP_TO_GARRISON.slice(0, 9), SPECIAL(MAIN), SPECIAL(SUB, 7), NO(/.*/)]);
    await expect(asSub.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.cannot_be_spacial_city',
    );
  });

  it('rejects a 王者之城 (is_special=2) main city', async () => {
    const { cmd } = build([
      ...UP_TO_GARRISON.slice(0, 9),
      {
        match: /^select 1 from sys_city where cid = \? and is_special = '2'$/,
        rows: [{ 1: 1 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow('MergeCity.cannot_be_isSpecial');
  });

  it('rejects a famous main city (type neither 0 nor 5)', async () => {
    const { cmd } = build([...UP_TO_GARRISON.slice(0, 10), MAIN_TYPE(3), NO(/.*/)]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.cannot_be_famous_city',
    );
  });

  it('rejects a sub city that still has heroes, soldiers or troops', async () => {
    const withHeroes = build([...UP_TO_GARRISON, HERO_CNT(1), NO(/.*/)]);
    await expect(withHeroes.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.sub_city_not_empty',
    );
    const withSoldiers = build([
      ...UP_TO_GARRISON,
      HERO_CNT(0),
      {
        match: /^select sum\(`count`\) from sys_city_soldier where sid <= 12 and cid = \?$/,
        rows: [{ 'sum(`count`)': 100 }],
      },
      NO(/.*/),
    ]);
    await expect(withSoldiers.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.sub_city_not_empty',
    );
    const withTroops = build([
      ...UP_TO_GARRISON,
      HERO_CNT(0),
      NO(/^select sum\(`count`\) from sys_city_soldier/),
      TROOP_CNT(2),
      NO(/.*/),
    ]);
    await expect(withTroops.cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.sub_city_not_empty',
    );
  });

  it('rejects merging a city into itself via the garrison check', async () => {
    // 原版没有显式的同城校验：mainCid == subCid 时两条查询参数相同，命中同一规则；
    // 主城必然有将领（城守），走到分城驻军检查时被 sub_city_not_empty 挡下。
    const { cmd } = build([
      typeOf(MAIN, 0),
      NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
      {
        match: /^select count from sys_goods where gid = 160052 and uid = \?$/,
        rows: [{ count: 1 }],
      },
      NOBLE(12),
      NOB_GLEVEL(10),
      NO(/^select state from mem_world where type = 0 and ownercid = \?$/),
      OWNED(MAIN),
      SPECIAL(MAIN),
      NO(/^select 1 from sys_city where cid = \? and is_special = '2'$/),
      MAIN_TYPE(0),
      HERO_CNT(1),
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, MAIN])).rejects.toThrow('MergeCity.sub_city_not_empty');
  });

  it('rejects a government below level 10 after recalling the troops (original order)', async () => {
    const { cmd, db } = build([
      ...UP_TO_GARRISON,
      HERO_CNT(0),
      NO(/^select sum\(`count`\) from sys_city_soldier/),
      TROOP_CNT(0),
      NO(/^update sys_troops set state = 1 where targetcid = \?$/),
      govLevel(9, 9),
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [MAIN, SUB])).rejects.toThrow(
      'MergeCity.government_not_enough_level',
    );
    // 原版 308 行的召回写在 313 行的等级校验之前：抛错时这条 update 已执行
    expect(find(db, /^update sys_troops set state = 1 where targetcid = \?$/)).toHaveLength(1);
  });

  it('rejects a government at level 15+ with the original empty message', async () => {
    // lang.php 从未定义 MergeCity.government_max_level，原版异常消息是空串
    const { cmd } = build([
      ...UP_TO_GARRISON,
      HERO_CNT(0),
      NO(/^select sum\(`count`\) from sys_city_soldier/),
      TROOP_CNT(0),
      NO(/^update sys_troops set state = 1 where targetcid = \?$/),
      govLevel(15, 15),
      NO(/.*/),
    ]);
    const err = (await cmd.mergeCity(ctx, [MAIN, SUB]).catch((e: unknown) => e)) as GameError;
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBeNull();
    expect(err.message).toBe('');
  });

  it('refuses an empty sub cid at the backup step (bak_error)', async () => {
    // cid=0 通过脚本化的归属校验后，subCityBak 的 empty($cid) 检查抛出 bak_error
    const { cmd } = build([
      typeOf(0, 0),
      NO(/^select 1 from log_qiyue where uid = \? and gid = 160052 and count < 0$/),
      {
        match: /^select count from sys_goods where gid = 160052 and uid = \?$/,
        rows: [{ count: 1 }],
      },
      NOBLE(12),
      NOB_GLEVEL(10),
      NO(/^select state from mem_world where type = 0 and ownercid = \?$/),
      OWNED(0),
      SPECIAL(0),
      NO(/^select 1 from sys_city where cid = \? and is_special = '2'$/),
      MAIN_TYPE(0),
      HERO_CNT(0),
      NO(/^select sum\(`count`\) from sys_city_soldier/),
      TROOP_CNT(0),
      NO(/^update sys_troops set state = 1 where targetcid = \?$/),
      govLevel(),
      NO(/.*/),
    ]);
    await expect(cmd.mergeCity(ctx, [0, 0])).rejects.toThrow('MergeCity.bak_error');
  });
});
