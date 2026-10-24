import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import { CityRules } from '../core/city-rules.service';
import { HeroRules } from '../core/hero-rules.service';
import { TaskRules } from '../core/task-rules.service';
import { UserRules } from '../core/user-rules.service';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { CityFoundCommands } from './city-found.commands';

const lang = new LangService({
  createCityFromLand: {
    only_flatlands_can_build: '只有平地才能筑城',
    target_flatlands_notYours: '目标平地不是本城池的附属平地，不能在此处筑城',
    target_flatlands_in_war: '目标平地正在战乱中，不能筑城。',
    no_enough_resource: '本城池资源不足，需要每种资源及黄金各10000才能筑城',
    nobility_not_enough: '你的爵位不够，筑城失败。当你的爵位晋升为“%s”时，才能统治更多的城池。',
  },
  worldfunc: { newcity: '新城池' },
});

const ctx = { uid: 1001, cid: 0, ip: 0, sip: '' };

/** wid2cid(244527) = 242457 (round-trip verified in core/php.spec.ts). */
const WID = 244527;
const TARGET_CID = 242457;
const LAST_CID = 209355;

const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const users = new UserRules(db.scope);
  const cmd = new CityFoundCommands(
    db.scope,
    lang,
    new CityRules(db.scope),
    new HeroRules(db.scope),
    new TaskRules(db.scope, users),
    users,
  );
  return { cmd, db };
}

/** The target tile as a 平地 (type 1) attached to LAST_CID at peace. */
const FLAT = (ownercid = LAST_CID, state = 0): Respond => ({
  match: /select \* from mem_world where wid = \?/i,
  rows: [{ wid: WID, type: 1, ownercid, state, province: 5, level: 0, jun: 1 }],
});
const LASTCID: Respond = {
  match: /select lastcid from sys_user where uid = \?/i,
  rows: [{ lastcid: LAST_CID }],
};
const NO_TROOPS: Respond = {
  match: /from sys_troops where uid = \? and targetcid = \? and state = 4/i,
  rows: [],
};
const FULL_RESOURCES: Respond = {
  match: /select \* from mem_city_resource where cid = \?/i,
  rows: [{ cid: LAST_CID, gold: 50000, food: 50000, wood: 50000, rock: 50000, iron: 50000 }],
};
const NOBLE = (nobility: number): Respond => ({
  match: /select nobility from sys_user where uid = \?/i,
  rows: [{ nobility }],
});
/** getBufferNobility finds no 推恩令 buff. */
const NO_TUIEN: Respond = {
  match: /from `mem_user_buffer` where `uid` = \? and `buftype` in/i,
  rows: [],
};
const CFG_NOBILITY = (cityCount: number): Respond => ({
  match: /select name, city_count from cfg_nobility where id = \?/i,
  rows: [{ name: '官大夫', city_count: cityCount }],
});
const CITY_COUNT = (n: number): Respond => ({
  match: /select count\(\*\) from sys_city where uid = \?/i,
  rows: [{ 'count(*)': n }],
});

/** Write statements of the happy path (both success tests share them). */
const WRITES: Respond[] = [
  NO(/update mem_city_resource set wood = wood \+/i), // addCityResources, spent then granted
  NO(/delete from mem_city_wounded where cid = \?/i),
  NO(/delete from mem_city_lamster where cid = \?/i),
  NO(/delete from mem_city_captive where cid = \?/i),
  NO(/replace into sys_city \(cid, uid, name, type, state, province\)/i),
  NO(/delete from sys_building where cid = \? and xy = \?/i),
  NO(/replace into sys_building/i),
  NO(/replace into mem_city_resource/i),
  NO(/replace into sys_city_res_add \(cid\)/i),
  NO(/update mem_world set ownercid = \?, type = 0\s+where wid = \?/i),
  // resetCityGoodsAdd: no active goods buff
  { match: /select \* from mem_user_buffer\s+where uid = \? and buftype <= 4/i, rows: [] },
  NO(/update sys_city_res_add set goods_food_add/i),
  // CityRules.updateCityResourceAdd (per troop + for the new city)
  NO(/select `ownercid` from `mem_world` where `wid` = \?/i),
  NO(/update `sys_city_res_add` set `resource_changing`/i),
  // HeroRules.updateCityHeroChange for both cities
  NO(/select sum\(level \* 20/i),
  NO(/update mem_city_resource set hero_fee/i),
  // TaskRules.completeTask(169)
  NO(/replace into sys_user_goal/i),
  // UserRules.logUserAction(1)
  NO(/insert into log_user_action/i),
  NO(/insert into log_action_count/i),
];

describe('CityFoundCommands.createCityFromLand', () => {
  it('rejects a tile that is not a 平地', async () => {
    const { cmd } = build([
      {
        match: /select \* from mem_world where wid = \?/i,
        rows: [{ wid: WID, type: 3, ownercid: LAST_CID, state: 0, province: 5 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.createCityFromLand(ctx, [WID])).rejects.toThrow(
      'createCityFromLand.only_flatlands_can_build',
    );
  });

  it('rejects a 平地 owned by another city', async () => {
    const { cmd } = build([FLAT(999999), LASTCID, NO(/.*/)]);
    await expect(cmd.createCityFromLand(ctx, [WID])).rejects.toThrow(
      'createCityFromLand.target_flatlands_notYours',
    );
  });

  it('rejects a 平地 that is at war', async () => {
    const { cmd } = build([FLAT(LAST_CID, 2), LASTCID, NO(/.*/)]);
    await expect(cmd.createCityFromLand(ctx, [WID])).rejects.toThrow(
      'createCityFromLand.target_flatlands_in_war',
    );
  });

  it('rejects when the current city lacks 10000 of a resource', async () => {
    const { cmd } = build([
      FLAT(),
      LASTCID,
      NO_TROOPS,
      {
        match: /select \* from mem_city_resource where cid = \?/i,
        rows: [{ cid: LAST_CID, gold: 50000, food: 9999, wood: 50000, rock: 50000, iron: 50000 }],
      },
      NO(/.*/),
    ]);
    await expect(cmd.createCityFromLand(ctx, [WID])).rejects.toThrow(
      'createCityFromLand.no_enough_resource',
    );
  });

  it('rejects at the nobility city cap and names the next rank', async () => {
    const { cmd } = build([
      FLAT(),
      LASTCID,
      NO_TROOPS,
      FULL_RESOURCES,
      NOBLE(5),
      NO_TUIEN,
      CFG_NOBILITY(2),
      CITY_COUNT(2),
      { match: /select name from cfg_nobility where id = \?/i, rows: [{ name: '官大夫' }] },
      NO(/.*/),
    ]);
    const err = (await cmd.createCityFromLand(ctx, [WID]).catch((e: unknown) => e)) as GameError;
    expect(err).toBeInstanceOf(GameError);
    expect(err.key).toBe('createCityFromLand.nobility_not_enough');
    expect(err.args).toEqual(['官大夫']);
    expect(lang.messageOf(err)).toBe(
      '你的爵位不够，筑城失败。当你的爵位晋升为“官大夫”时，才能统治更多的城池。',
    );
  });

  it('founds the city and merges stationed troops into it', async () => {
    // Two stationed troops: resource CSV is "gold,food,wood,rock,iron",
    // soldiers CSV is "类型数,sid,数量,sid,数量,…".
    const troops = [
      {
        id: 11,
        uid: 1001,
        cid: LAST_CID,
        hid: 80213,
        targetcid: TARGET_CID,
        state: 4,
        soldiers: '2,1,300,3,500',
        resource: '1200,3400,5600,7800,9100',
      },
      {
        id: 12,
        uid: 1001,
        cid: LAST_CID,
        hid: 80214,
        targetcid: TARGET_CID,
        state: 4,
        soldiers: '1,2,50',
        resource: '10,20,30,40,50',
      },
    ];
    const { cmd, db } = build([
      FLAT(),
      LASTCID,
      {
        match: /from sys_troops where uid = \? and targetcid = \? and state = 4/i,
        rows: troops,
      },
      FULL_RESOURCES,
      NOBLE(6),
      NO_TUIEN,
      CFG_NOBILITY(10),
      CITY_COUNT(2),
      ...WRITES.slice(0, 10), // through the plain city writes
      // an active buftype-1 (food) goods buff for the goods-add reset
      {
        match: /select \* from mem_user_buffer\s+where uid = \? and buftype <= 4/i,
        rows: [{ buftype: 1 }],
      },
      ...WRITES.slice(11),
      // troop merge writes
      NO(/update sys_city_hero set cid = \?, state = 1\s+where hid = \?/i),
      NO(/update sys_city set chiefhid = \? where cid = \?/i),
      NO(/update sys_city_hero set cid = \?, state = 0\s+where hid = \?/i),
      NO(/insert into sys_city_soldier/i),
      NO(/insert into log_city_soldier/i),
      NO(/delete from sys_troops where id = \?/i),
      NO(/delete from sys_troop_tactics where troopid = \?/i),
      // the lord hero already exists, so the (buggy) creation branch is skipped
      { match: /select 1 from sys_city_hero where uid = \? and herotype = \?/i, rows: [{ 1: 1 }] },
      NO(/.*/),
    ]);
    expect(await cmd.createCityFromLand(ctx, [WID])).toEqual([]);

    const find = (re: RegExp) => db.executed.filter((q) => re.test(q.sql));

    // the new sys_city row (name from worldfunc.newcity, province from the tile) and tile flip
    expect(find(/replace into sys_city \(cid, uid, name, type, state, province\)/i)).toHaveLength(
      1,
    );
    expect(
      find(/replace into sys_city \(cid, uid, name, type, state, province\)/i)[0]!.parameters,
    ).toEqual([TARGET_CID, 1001, '新城池', 5]); // type/state are SQL literals
    expect(
      find(/update mem_world set ownercid = \?, type = 0\s+where wid = \?/i)[0]!.parameters,
    ).toEqual([TARGET_CID, WID]);

    // wounded / deserters / captives cleared, level-1 官府 at xy 120
    expect(find(/delete from mem_city_wounded/i)).toHaveLength(1);
    expect(find(/delete from mem_city_lamster/i)).toHaveLength(1);
    expect(find(/delete from mem_city_captive/i)).toHaveLength(1);
    expect(
      find(/replace into sys_building \(cid, xy, bid, level\)\s+values \(\?, 120, 6, 1\)/i),
    ).toHaveLength(1);

    // troop resources folded into the new city: column order cid, people, food, wood, rock, iron, gold
    const newRes = find(/replace into mem_city_resource/i);
    expect(newRes).toHaveLength(1);
    expect(newRes[0]!.parameters).toEqual([TARGET_CID, '3420', '5630', '7840', '9150', '1210']);

    // first troop's leader becomes 城守 (state 1), the second just moves in (state 0)
    const chief = find(/update sys_city_hero set cid = \?, state = 1\s+where hid = \?/i);
    expect(chief).toHaveLength(1);
    expect(chief[0]!.parameters).toEqual([TARGET_CID, 80213]);
    expect(find(/update sys_city set chiefhid = \? where cid = \?/i)[0]!.parameters).toEqual([
      80213,
      TARGET_CID,
    ]);
    const movedIn = find(/update sys_city_hero set cid = \?, state = 0\s+where hid = \?/i);
    expect(movedIn).toHaveLength(1);
    expect(movedIn[0]!.parameters).toEqual([TARGET_CID, 80214]);

    // soldiers CSV merged per sid (count bound twice: insert + on duplicate)
    expect(find(/insert into sys_city_soldier/i).map((q) => q.parameters)).toEqual([
      [TARGET_CID, 1, '300', '300'],
      [TARGET_CID, 3, '500', '500'],
      [TARGET_CID, 2, '50', '50'],
    ]);
    expect(find(/insert into log_city_soldier/i).map((q) => q.parameters)).toEqual([
      [TARGET_CID, 1, 1001, '300', '300'],
      [TARGET_CID, 3, 1001, '500', '500'],
      [TARGET_CID, 2, 1001, '50', '50'],
    ]);

    // both troops and their tactics rows are gone
    expect(find(/delete from sys_troops where id = \?/i).map((q) => q.parameters)).toEqual([
      [11],
      [12],
    ]);
    expect(
      find(/delete from sys_troop_tactics where troopid = \?/i).map((q) => q.parameters),
    ).toEqual([[11], [12]]);
    // per-troop + new-city refreshes
    expect(find(/update `sys_city_res_add` set `resource_changing`/i)).toHaveLength(3);

    // upkeep recomputed for the old and the new city
    expect(find(/update mem_city_resource set hero_fee/i).map((q) => q.parameters)).toEqual([
      ['0', LAST_CID],
      ['0', TARGET_CID],
    ]);

    // old city charged 10000 of each, new city granted 5000 of each
    const resUpdates = find(/update mem_city_resource set wood = wood \+/i);
    expect(resUpdates).toHaveLength(2);
    expect(resUpdates[0]!.parameters).toEqual([
      '-10000',
      '-10000',
      '-10000',
      '-10000',
      '-10000',
      LAST_CID,
    ]);
    expect(resUpdates[1]!.parameters).toEqual(['5000', '5000', '5000', '5000', '5000', TARGET_CID]);

    // goal 169 completed and the action logged
    expect(find(/replace into sys_user_goal/i)[0]!.parameters).toEqual([1001, 169]);
    expect(find(/insert into log_user_action/i)[0]!.parameters).toEqual([1001, 1]);

    // goods add reset: the buftype-1 buff gives +25 food only
    expect(find(/update sys_city_res_add set goods_food_add/i)[0]!.parameters).toEqual([
      25,
      0,
      0,
      0,
      TARGET_CID,
    ]);

    // the lord hero already exists, so neither the (cid=0) insert nor the blood row runs
    expect(find(/insert into sys_city_hero/i)).toHaveLength(0);
    expect(find(/insert into mem_hero_blood/i)).toHaveLength(0);
  });

  it('founds the city without troops and creates the missing lord hero at cid 0', async () => {
    const { cmd, db } = build([
      FLAT(),
      LASTCID,
      NO_TROOPS,
      FULL_RESOURCES,
      NOBLE(5),
      NO_TUIEN,
      CFG_NOBILITY(10),
      CITY_COUNT(1),
      ...WRITES,
      // no herotype=1000 hero yet -> the creation branch runs
      { match: /select 1 from sys_city_hero where uid = \? and herotype = \?/i, rows: [] },
      { match: /insert into sys_city_hero/i, rows: [], insertId: 90001 },
      NO(/insert into mem_hero_blood/i),
      NO(/.*/),
    ]);
    expect(await cmd.createCityFromLand(ctx, [WID])).toEqual([]);

    const find = (re: RegExp) => db.executed.filter((q) => re.test(q.sql));

    // no troop resources: the new city starts with zeroes
    expect(find(/replace into mem_city_resource/i)[0]!.parameters).toEqual([
      TARGET_CID,
      '0',
      '0',
      '0',
      '0',
      '0',
    ]);
    // no troop artifacts
    expect(find(/insert into sys_city_soldier/i)).toHaveLength(0);
    expect(find(/delete from sys_troops where id = \?/i)).toHaveLength(0);
    expect(find(/update sys_city set chiefhid/i)).toHaveLength(0);
    expect(find(/update `sys_city_res_add` set `resource_changing`/i)).toHaveLength(1);

    // goal + grant still happen
    expect(find(/replace into sys_user_goal/i)[0]!.parameters).toEqual([1001, 169]);
    expect(find(/update mem_city_resource set wood = wood \+/i)[1]!.parameters).toEqual([
      '5000',
      '5000',
      '5000',
      '5000',
      '5000',
      TARGET_CID,
    ]);

    // the lord hero insert passes cid 0 — WorldFunc.php:409 used the undefined $cid, an
    // empty string that MySQL stored as 0; kept as-is (original bug, faithfully ported).
    const lord = find(/insert into sys_city_hero/i);
    expect(lord).toHaveLength(1);
    expect(lord[0]!.sql).toMatch(
      /select uid, name, sex, face, 0, 0, 1, 50, 1, 1, 1, 100, \?\s+from sys_user where uid = \?/,
    );
    expect(lord[0]!.parameters).toEqual([1000, 1001]);
    expect(find(/insert into mem_hero_blood/i)[0]!.parameters).toEqual([90001]);
  });
});
