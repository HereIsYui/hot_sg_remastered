import type { Side } from '../lib/difftest/side.ts';
import type { TableRule } from '../lib/difftest/normalize.ts';

export interface DiffCase {
  name: string;
  run(side: Side): Promise<unknown>;
  /**
   * Per-case overrides for the table comparison, merged over (and winning against) the global
   * `tableRules` for THIS case only. Use it to relax a column that is only nondeterministic — or
   * only recomputed off to one side — in this specific scenario, instead of blunting the global
   * rule for every case. Each entry replaces the global rule for that table wholesale.
   */
  tables?: Record<string, TableRule>;
}

function cid2wid(cid: number): number {
  const y = Math.floor(cid / 1000);
  const x = cid % 1000;
  return Math.floor(y / 10) * 10000 + Math.floor(x / 10) * 100 + (y % 10) * 10 + (x % 10);
}

/**
 * New cities land on a random free tile. On a tile whose cid equals its wid, the `<cid>` and
 * `<wid>` aliases collide and that side compares wrong; take those tiles out of the draw (state 1)
 * before creating a city in `province`. The snapshot rollback puts them back.
 */
async function avoidCidWidTiles(side: Side, province: number): Promise<void> {
  const rows = await side.query<{ wid: string }>(
    'select wid from mem_world where type = 1 and province = ? and ownercid = 0 and state = 0',
    [province],
  );
  const clash = rows.map((r) => Number(r.wid)).filter((wid) => wid2cid(wid) === wid);
  if (clash.length) {
    await side.query(`update mem_world set state = 1 where wid in (${clash.join(',')})`);
  }
}

/** New cities land on a random tile; alias its ids so both sides compare equal. */
async function aliasNewCity(side: Side, uid: number): Promise<void> {
  const [row] = await side.query<{ lastcid: string }>(
    'select lastcid from sys_user where uid = ?',
    [uid],
  );
  const cid = Number(row?.lastcid ?? 0);
  if (!cid) return;
  side.alias(cid, '<cid>');
  side.alias(cid2wid(cid), '<wid>');
}

/** Shipped save: changle (uid 1001) is a newbie player with a city. */
const EXISTING_PLAYER = 'changle';

/**
 * The HandleTroop scout tail runs `refreshFoodArmyUse` + `check_city_resource` on the scout's and
 * the target owner's cities. `check_city_resource(uid, cid)` is the full `getUsersCityProduct`
 * economy recompute (caps, add rates, food upkeep) — NOT ported (it belongs to the resource wave),
 * and the legacy harness also boots global.php which recomputes these from building levels. None of
 * it is scout intelligence, and the ported `ScoutService` deliberately leaves the two cities'
 * economy untouched, so the scout difftest cases scope `mem_city_resource` out of the comparison
 * entirely (the scout's real effects live in sys_report / sys_troops / sys_user_goal).
 */
const SCOUT_RESOURCE_IGNORE = {
  mem_city_resource: { skip: () => true },
} satisfies Record<string, TableRule>;

/**
 * The 掠夺/占领 empty-field early-out sends the FIELD OWNER a "野地空无一人" report and then runs
 * `refreshFoodArmyUse` + `check_city_resource` on the owner's city — the full economy recompute
 * (caps, add-rates, food upkeep, and the owner's own daily task-goal seeding) that is NOT battle
 * logic and belongs to the resource wave, exactly as the scout cases scope out. The ported arrival
 * sends the owner report but deliberately leaves the owner's economy untouched, so scope the
 * owner-recompute tables out of the comparison (the battle's real effects live in
 * sys_troops / sys_report / mem_world / the attacker's own sys_user_goal).
 */
const BATTLE_OWNER_RECOMPUTE_IGNORE = {
  mem_city_resource: { skip: () => true },
  sys_city_res_add: { skip: () => true },
  // The field owner (uid 1002) is the marker-troop player; its goal rows are the economy
  // recompute's daily seeding, not the attacker's battle task completion.
  sys_user_goal: { skip: (row) => String(row.uid) === '1002' },
} satisfies Record<string, TableRule>;

/**
 * 占领 an NPC city takes the city over, which on the legacy side triggers the FULL economy
 * recompute for the new owner (mem_city_resource caps/add-rates, sys_city_res_add, and the owner's
 * daily task-goal seeding via check_city_resource / getUsersCityProduct) — none of which is ported
 * (it belongs to the resource wave, exactly as the scout/empty-field cases scope out). The capture
 * also stamps a few owner-economy side tables. Scope those out so the comparison stays on the
 * battle's real effects: the city ownership change (sys_city.uid / chiefhid), the hero capture
 * (sys_city_hero / sys_hero_captive), the defences/garrison (sys_city_defence / sys_city_soldier),
 * the troop mutations (sys_troops), the inform banner (sys_inform) and the reports (sys_report).
 */
const NPC_CITY_CAPTURE_IGNORE = {
  mem_city_resource: { skip: () => true },
  sys_city_res_add: { skip: () => true },
} satisfies Record<string, TableRule>;

export const cases: DiffCase[] = [
  {
    name: 'login announcement',
    run: (s) => s.service('Login', 'getLoginAnnouncement', []),
  },
  {
    name: 'doLogin rejects an old client',
    run: async (s) => {
      await s.service('Login', 'doLogin', ['1000', 0, 'testpassport', EXISTING_PLAYER]);
      await s.service('Login', 'doLogin', ['1000', 1, 'testpassport', EXISTING_PLAYER]);
    },
  },
  {
    name: 'existing player logs in and loads data',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'loadUserInfo', 1);
      await s.command(session, 'loadGlobalData');
      s.unordered(4, 6); // cfg_things without ORDER BY: MyISAM insertion order vs InnoDB key order
      await s.command(session, 'loadProvinceInfo');
      await s.command(session, 'getUserCities');
      await s.command({ ...session, sid: 'wrong' }, 'loadUserInfo', 1);
      await s.command(session, 'noSuchCommand');
      await s.command(session, 'createCity', '另城', 3);
      await s.service('Login', 'checkQueue', [session.uid, session.sid]);
    },
  },
  {
    name: 'existing player logs in twice on one day',
    run: async (s) => {
      await s.login(EXISTING_PLAYER);
      await s.login(EXISTING_PLAYER);
    },
  },
  {
    name: 'new account creates a role',
    run: async (s) => {
      const session = await s.login('difftest_new');
      await s.command(session, 'loadUserInfo', 1);
      await avoidCidWidTiles(s, 3);
      // Free tiles can retain buildings / schedule / resource rows from a deleted NPC city; remove
      // those stale rows so a random choice cannot produce a one-sided deletion when the new role
      // reuses the tile (doCreateCity's replace-into would delete the stale row on one side only).
      await s.query('delete from sys_building where cid not in (select cid from sys_city)');
      await s.query('delete from mem_city_schedule where cid not in (select cid from sys_city)');
      await s.query('delete from mem_city_resource where cid not in (select cid from sys_city)');
      await s.command(session, 'createRole', '风云子', '新城', 3, '风', 1, 2, 0);
      await aliasNewCity(s, session.uid);
      await s.command(session, 'loadUserInfo', 1);
      await s.command(session, 'createRole', '风云子', '新城', 3, '风', 1, 2, 0);
      await s.login('difftest_new');
    },
  },
  {
    name: 'createRole rejects invalid input',
    run: async (s) => {
      const [taken] = await s.query<{ name: string }>('select name from sys_user where uid = 1002');
      const session = await s.login('difftest_invalid');
      const attempts: unknown[][] = [
        ['', '新城', 3, '风'],
        ['一二三四五六七八九', '新城', 3, '风'],
        ['风云子', '一二三四五六七八九', 3, '风'],
        ['风<云', '新城', 3, '风'],
        ["风'云", '新城', 3, '风'],
        ['风\\云', '新城', 3, '风'],
        ['测试君主', '新城', 3, '风'],
        ['风云子', "新'城", 3, '风'],
        ['风云子', '测试城', 3, '风'],
        ['风云子', '新城', 3, ''],
        ['风云子', '新城', 3, '风云'],
        ['风云子', '新城', 3, "'"],
        [taken?.name ?? '', '新城', 3, '风'],
        ['0', '新城', 3, '风'],
        ['风 云', '新城', 3, '风'],
        ['abc_1', '新城', 3, '风'],
      ];
      for (const [name, city, province, flag] of attempts) {
        await s.command(session, 'createRole', name, city, province, flag, 1, 1, 0);
      }
    },
  },
  {
    name: 'existing player loads the city screen',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'getCityInfo', cid, 1);
      s.mask(4, 2, '*', 'state_timeleft');
      for (const type of [0, 1, 2, 3, 4, 9]) await s.cityCommand(session, cid, type);
      await s.command(session, 'getCityProduct', cid);
      await s.cityCommand({ ...session, sid: 'wrong' }, cid, 0);
      await s.cityCommand(session, FOREIGN_CITY, 0);
      await s.cityCommand(session, FOREIGN_CITY, 1);
      await s.command(session, 'getCityInfo', FOREIGN_CITY, 1);
      await s.command(session, 'getCityInfo', cid, 1);
      s.mask(4, 2, '*', 'state_timeleft');
    },
  },
  {
    name: 'city load finishes due upgrades and demolitions',
    // The 6-minute population tick can run on only one side when the sequential calls straddle
    // its 16-second window. Keep every non-time-dependent resource assertion.
    tables: { mem_city_resource: { ignore: ['people'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.query(
        'update sys_building set state = 1, state_endtime = unix_timestamp() - 1 where cid = ?',
        [cid],
      );
      await s.query(
        `update sys_building set state = 2, state_endtime = unix_timestamp() - 1
          where cid = ? and bid = 20`,
        [cid],
      );
      await s.command(session, 'getCityBuilding', cid);
      s.mask(4, '*', 'state_timeleft');
      await s.command(session, 'getCityInfo', cid, 1);
      s.mask(4, 2, '*', 'state_timeleft');
      await s.cityCommand(session, cid, 0);
      s.mask(2, 1, 'people');
    },
  },
  {
    name: 'new role opens its city',
    tables: { mem_city_resource: { ignore: ['people'] } },
    run: async (s) => {
      const session = await s.login('difftest_city');
      await avoidCidWidTiles(s, 5);
      // A reused free tile can retain the deleted NPC city's schedule; remove that stale fixture
      // so the random tile choice does not add a legacy-only deletion to the comparison.
      await s.query('delete from mem_city_schedule where cid not in (select cid from sys_city)');
      await s.command(session, 'createRole', '城主', '新城', 5, '城', 0, 3, 0);
      await aliasNewCity(s, session.uid);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'getCityInfo', cid, 1);
      s.mask(4, 2, '*', 'state_timeleft');
      s.mask(4, 4, 0, 'jun'); // random tile
      await s.cityCommand(session, cid, 0);
      s.mask(2, 1, 'people');
      await s.command(session, 'getCityProduct', cid);
    },
  },
  {
    name: 'building dialogs describe slots',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      for (const kind of [0, 1, 2]) {
        await s.dialog(session, cid, 100, kind, 'getAllValidBuilding', kind);
      }
      await s.query('delete from sys_building where cid = ? and bid in (8, 13)', [cid]);
      await s.dialog(session, cid, 100, 1, 'getAllValidBuilding', 1);
      for (const [inner, x, y, bid] of [
        [1, 0, 0, 5],
        [1, 2, 0, 6],
        [0, 1, 3, 1],
        [1, 3, 5, 19],
        [1, 9, 9, 20],
        [1, 0, 0, 6],
      ] as const) {
        await s.dialog(session, cid, bid, y * 10 + x, 'getBuildingInfo', inner, x, y, bid);
      }
      await s.dialog(session, FOREIGN_CITY, 6, 2, 'getBuildingInfo', 1, 2, 0, 6);
    },
  },
  {
    name: 'building honglu shows stationed union troops and permission toggles',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const [building] = await s.query<{ xy: number }>(
        'select xy from sys_building where cid = ? and bid = 12 limit 1',
        [cid],
      );
      if (!building) throw new Error('missing 鸿胪寺 fixture');
      const x = building.xy % 10;
      const y = Math.floor(building.xy / 10);
      await s.query('delete from sys_allow_union_troop where uid = ?', [session.uid]);
      await s.query('delete from sys_troops where id = 900601');
      await s.query(
        `insert into sys_troops
          (id, uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
         values (900601, 1002, 188128, 0, ?, 1, 4, unix_timestamp() - 600, 600,
           unix_timestamp() + 600, '1,1,20', '0')`,
        [cid],
      );
      const honglu = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 12, building.xy, func, ...args);
      await honglu('getBuildingInfo', 1, x, y, 12);
      await honglu('allowUnionTroop', 1);
      await honglu('allowAntiPlunder', 0);
      await honglu('allowAntiInvade', 0);
      await honglu('getBuildingInfo', 1, x, y, 12);
      await s.query('delete from sys_troops where id = 900601');
      await s.query('delete from sys_allow_union_troop where uid = ?', [session.uid]);
    },
  },
  {
    name: 'building upgrades start and stop',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const upgrade = async (...args: number[]) => {
        await s.command(session, 'startUpgradeBuilding', cid, ...args);
        buildingTimes(s);
      };
      await s.query('update sys_building set level = 3 where cid = ? and xy in (100, 101, 102)', [
        cid,
      ]);
      await s.query('delete from sys_building where cid = ? and xy in (104, 82)', [cid]);
      await upgrade(1, 0, 0, 5);
      await upgrade(1, 0, 0, 5);
      await upgrade(1, 0, 4, 8);
      await upgrade(1, 0, 1, 5);
      await s.command(session, 'stopUpgradeBuilding', cid, 1, 0, 0, 5);
      buildingTimes(s);
      await s.command(session, 'stopUpgradeBuilding', cid, 1, 0, 4, 8);
      buildingTimes(s);
      await upgrade(1, 0, 4, 14);
      await upgrade(1, 0, 4, 6);
      await upgrade(1, 5, 5, 5);
      await upgrade(1, 1, 0, 6);
      await upgrade(1, 1, 0, 5);
      await upgrade(0, 1, 3, 1);
      await upgrade(1, 0, 4, 99);
      await s.command(session, 'stopUpgradeBuilding', cid, 1, 0, 2, 5);
      await upgrade(1, 0, 2, 5);
      await s.query('update sys_building set level = 1 where cid = ? and bid = 6', [cid]);
      await upgrade(0, 8, 2, 1);
      await s.query('update mem_city_resource set wood = 0 where cid = ?', [cid]);
      await upgrade(1, 0, 4, 8);
      await s.command(session, 'startUpgradeBuilding', FOREIGN_CITY, 1, 0, 0, 5);
    },
  },
  {
    name: 'building demolitions start and stop',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const destroy = async (func: string, ...args: number[]) => {
        await s.command(session, func, cid, ...args);
        buildingTimes(s);
      };
      await destroy('startDestroyBuilding', 1, 0, 0, 5);
      await destroy('startDestroyBuilding', 1, 0, 0, 5);
      await destroy('startDestroyBuilding', 1, 0, 1, 5);
      await destroy('startDestroyBuilding', 1, 0, 2, 5);
      await destroy('stopDestroyBuilding', 1, 0, 0, 5);
      await destroy('startDestroyBuilding', 1, 2, 0, 6);
      await destroy('startDestroyBuilding', 1, 0, 3, 6);
      await destroy('startDestroyBuildingAll', 1, 2, 0, 6);
      await destroy('startDestroyBuildingAll', 1, 0, 4, 8);
      await s.query(
        `insert into sys_goods (uid, gid, count) values (?, 83, 1)
          on duplicate key update count = 1`,
        [session.uid],
      );
      await destroy('startDestroyBuildingAll', 1, 0, 1, 5);
      await destroy('startDestroyBuildingAll', 1, 9, 9, 20);
      await destroy('startDestroyBuildingAll', 1, 0, 4, 8);
      await s.command(session, 'startDestroyBuilding', FOREIGN_CITY, 1, 2, 0, 6);
    },
  },
  {
    name: 'fields change kind with a 地变符',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const change = async (...args: number[]) => {
        await s.command(session, 'startChangeBuilding', cid, ...args);
        buildingTimes(s);
      };
      // The 农田 at field (1, 3).
      await change(0, 1, 3, 2, 1);
      await s.query(
        `insert into sys_goods (uid, gid, count) values (?, 161504, 2)
          on duplicate key update count = 2`,
        [session.uid],
      );
      await change(0, 1, 3, 2, 3);
      await change(0, 1, 3, 2, 1);
      await change(0, 1, 3, 3, 2);
      await s.command(session, 'startChangeBuilding', FOREIGN_CITY, 0, 1, 3, 2, 1);
      // The original also levelled the changed field up when it finished; the rewrite keeps it.
      await s.query(
        `update sys_building set state_endtime = unix_timestamp() - 1,
            level = level - ${s.label === 'legacy' ? 1 : 0}
          where cid = ? and xy = 13`,
        [cid],
      );
      await s.command(session, 'getCityBuilding', cid);
      buildingTimes(s);
    },
  },
  {
    name: 'college researches technics',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      // The 书院 sits at inner (4, 4); its dialog is addressed by bid 7 and y * 10 + x.
      const college = async (func: string, ...args: unknown[]) => {
        await s.dialog(session, cid, 7, 44, func, ...args);
        technicTimes(s);
      };
      // A non-lord 军师 speeds research up and gains exp when it finishes.
      await s.query('update sys_city_hero set herotype = 0, wisdom_base = 60 where hid = 80213');
      await s.query('update sys_city set counsellorid = 80213 where cid = ?', [cid]);
      await college('getBuildingInfo', 1, 4, 4, 7);
      await college('startUpgradeTechnic', 1);
      await college('startUpgradeTechnic', 2);
      await college('stopUpgradeTechnic', 2);
      await college('stopUpgradeTechnic', 1);
      await college('startUpgradeTechnic', 99);
      await college('startUpgradeTechnic', 1);
      await s.query('update mem_technic_upgrading set state_endtime = unix_timestamp() - 1');
      await s.tick('UpdateUsersTechnic');
      const [done] = await s.query<{ level: string }>(
        'select level from sys_technic where uid = ? and tid = 1 and state = 0',
        [session.uid],
      );
      if (Number(done?.level) !== 1) throw new Error('the tick did not finish the research');
      await college('getBuildingInfo', 1, 4, 4, 7);
      await s.query(
        `insert into sys_technic (cid, tid, uid, level, state) values (?, 21, ?, 6, 0)`,
        [cid, session.uid],
      );
      await s.query('update sys_technic set level = 10 where uid = ? and tid = 1', [session.uid]);
      await college('startUpgradeTechnic', 1);
      await college('startUpgradeTechnic', 21);
      await s.query('update mem_city_resource set gold = 0 where cid = ?', [cid]);
      await college('startUpgradeTechnic', 3);
      await s.dialog(session, FOREIGN_CITY, 7, 44, 'startUpgradeTechnic', 2);
    },
  },
  {
    name: 'army drafts soldiers',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      // A level 15 兵营 sits at inner (2, 2); its dialog is addressed by bid 9 and y * 10 + x.
      const army = async (func: string, ...args: unknown[]) => {
        await s.dialog(session, cid, 9, 22, func, ...args);
        draftTimes(s);
      };
      const queued = async (state: number) => {
        const [row] = await s.query<{ id: string }>(
          'select id from sys_city_draftqueue where cid = ? and state = ? order by id limit 1',
          [cid, state],
        );
        return Number(row?.id ?? 0);
      };
      // A non-lord 主将 speeds drafting up and gains exp when a batch finishes.
      await s.query('update sys_city_hero set herotype = 0, bravery_base = 60 where hid = 80213');
      await s.query('update sys_city set generalid = 80213 where cid = ?', [cid]);
      await army('getBuildingInfo', 1, 2, 2, 9);
      await army('startDraftQueue', 1, 2, 2, 1, 10);
      await army('startDraftQueue', 1, 2, 2, 2, 5, 1);
      await army('startDraftQueue', 1, 2, 2, 1, 7);
      await army('stopDraftQueue', 1, 2, 2, await queued(0));
      await army('startDraftQueue', 1, 2, 2, 1, 0);
      await army('startDraftQueue', 1, 2, 2, 99, 1);
      await army('startDraftQueue', 1, 2, 2, 4, 1);
      await army('startDraftQueue', 1, 2, 2, 46, 1);
      await army('startDraftQueue', 1, 0, 0, 1, 1);
      await army('dissolveSoldier', 1, 2, 2, 7, 40);
      await army('dissolveSoldier', 1, 2, 2, 7, 100000);
      await s.command(session, 'changeSoldierInfo', 1, cid, 2);
      await s.command(session, 'changeSoldierInfo', 0, cid, 7);
      // 轻骑兵 convert to 民夫 at 1:10.
      await army('soldierConvert', 1, 2, 2, 7, 10, 1, 280);
      await army('soldierConvert', 1, 2, 2, 7, 10, 1, 100);
      await s.query('insert into sys_soldier_convert (cid, value, `convert`) values (?, 5000, 0)', [
        cid,
      ]);
      await army('soldierConvert', 1, 2, 2, 7, 10, 1, 100);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 125, 1), (?, 63, 1)', [
        session.uid,
        session.uid,
      ]);
      await army('useHanXinShangBu', 1, 2, 2, await queued(0));
      await army('useHanXinXiaBu', 1, 2, 2, await queued(1));
      await army('useHanXinXiaBu', 1, 2, 2, await queued(1));
      await s.query('update mem_city_draft set state_endtime = unix_timestamp() - 1');
      await s.tick('UpdateUsersSoldier');
      const [done] = await s.query<{ count: string }>(
        'select count from sys_city_soldier where cid = ? and sid = 1',
        [cid],
      );
      if (Number(done?.count) !== 110) throw new Error('the tick did not finish the batch');
      await army('getBuildingInfo', 1, 2, 2, 9);
      await s.dialog(session, FOREIGN_CITY, 9, 22, 'startDraftQueue', 1, 2, 2, 1, 1);
    },
  },
  {
    name: 'wall builds defences',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      // The level 15 城墙 sits at inner (9, 9); its dialog is addressed by bid 20 and y * 10 + x.
      const wall = async (func: string, ...args: unknown[]) => {
        await s.dialog(session, cid, 20, 99, func, ...args);
        reinforceTimes(s);
      };
      const queued = async (state: number) => {
        const [row] = await s.query<{ id: string }>(
          'select id from sys_city_reinforcequeue where cid = ? and state = ? order by id limit 1',
          [cid, state],
        );
        return Number(row?.id ?? 0);
      };
      // A 城守 with 内政 speeds building up; 兵法 1 unlocks the second defence.
      await s.query('update sys_city_hero set affairs_base = 40 where hid = 80213');
      await s.query('update sys_city set chiefhid = 80213 where cid = ?', [cid]);
      await s.query('insert into sys_technic (uid, tid, level, cid) values (?, 5, 1, ?)', [
        session.uid,
        cid,
      ]);
      await wall('getBuildingInfo', 1, 9, 9, 20);
      await wall('startReinforceQueue', 1, 10);
      await wall('startReinforceQueue', 2, 5);
      await wall('startReinforceQueue', 1, 3);
      await wall('stopReinforceQueue', await queued(0));
      await wall('startReinforceQueue', 1, 0);
      await wall('startReinforceQueue', 99, 1);
      await wall('startReinforceQueue', 3, 1);
      await wall('startReinforceQueue', 1, 100000);
      // At level 1 the two entries fill the queue.
      await s.query('update sys_building set level = 1 where cid = ? and bid = 20', [cid]);
      await wall('startReinforceQueue', 1, 1);
      await s.query('update sys_building set level = 15 where cid = ? and bid = 20', [cid]);
      await s.query('update sys_city_defence set count = 29990 where cid = ? and did = 5', [cid]);
      await wall('startReinforceQueue', 1, 100);
      await wall('dissolveDefence', 5, 10);
      await wall('dissolveDefence', 4, 1);
      await wall('dissolveDefence', 5, 0);
      await wall('accReinforceQueue', await queued(1));
      await s.query('insert into sys_goods (uid, gid, count) values (?, 64, 2)', [session.uid]);
      await wall('accReinforceQueue', await queued(1));
      await wall('accReinforceQueue', await queued(1));
      await wall('accReinforceQueue', await queued(0));
      await s.query('update mem_city_reinforce set state_endtime = unix_timestamp() - 1');
      await s.tick('UpdateUsersDeinforce');
      const [done] = await s.query<{ count: string }>(
        'select count from sys_city_defence where cid = ? and did = 1',
        [cid],
      );
      if (Number(done?.count) !== 10) throw new Error('the tick did not finish the defences');
      await wall('getBuildingInfo', 1, 9, 9, 20);
      await s.dialog(session, FOREIGN_CITY, 20, 99, 'startReinforceQueue', 1, 1);
    },
  },
  {
    name: 'curse punishes cities and pays rewards',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [other] = await s.query<{ uid: string; cid: string }>(
        'select uid, cid from sys_city where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const otherUid = Number(other?.uid);
      const otherCid = Number(other?.cid);
      // Starving, broke, over-full and unhappy at once; 2 soldiers lose round(0.4) = none.
      await s.query(
        `update mem_city_resource set food = 0, gold = 0, wood = wood_max + 12345.5,
          people = people_max + 1000, morale = 30 where cid = ?`,
        [cid],
      );
      await s.query('update sys_city_soldier set count = 100 where cid = ? and sid = 1', [cid]);
      await s.query('update sys_city_soldier set count = 2 where cid = ? and sid = 2', [cid]);
      // A starving city with an army camped outside gets the army back instead.
      await s.query('update mem_city_resource set food = 0 where cid = ?', [otherCid]);
      await s.query(
        `insert into sys_troops (id, uid, cid, hid, targetcid, state, pathtime, soldiers, resource)
          values (900001, ?, ?, 0, ?, 4, 600, '', '')`,
        [otherUid, otherCid, cid],
      );
      await s.query(
        `insert into sys_gather (wid, troopid, fooduse, level, starttime)
          values (1, 900001, 0, 1, 0)`,
      );
      // Disloyal heroes that stay: mt_rand(1, 600) is never below loyalty 1 (0 once the empty
      // treasury costs a point), and a captive taken within a day is kept. A real desertion
      // kills the legacy cron (see HeroRules.throwUsersHeroField).
      await s.query(
        `insert into sys_city_hero (hid, uid, cid, name, state, level, loyalty, affairs_base,
            bravery_base, wisdom_base, command_base)
          values (900001, ?, ?, '甲', 0, 12, 1, 50, 60, 70, 40),
            (900002, ?, ?, '乙', 5, 3, 20, 10, 20, 30, 5)`,
        [uid, cid, otherUid, otherCid],
      );
      await s.query(
        'insert into sys_hero_captive (hid, uid, captivetime) values (900002, ?, unix_timestamp())',
        [uid],
      );
      // 联盟排行 is due (sys_user_act state 2) and the player leads the week's honour.
      await s.query(
        `insert into sys_union (id, name, leader, creator, member, prestige, intro, announcement)
          values (900, '测试盟', ?, ?, 1, 10, '', '')`,
        [uid, uid],
      );
      await s.query('update sys_user set union_id = 900, honour = 5000 where uid = ?', [uid]);
      await s.query(
        `insert into log_battle_honour (uid, battlefieldid, honour, starttime, battleid,
            finishtime, quittime, metal)
          values (?, 1, 300, 0, 1, unix_timestamp(), 0, 0)`,
        [uid],
      );
      await s.query('update sys_user_act set state = 2, con = 1, time = 1 where id = 1');
      // Saturday 16:00 (hour 8 of the server clock).
      await s.tick('UpdateUsersCurse', { hour: 8, weekday: 6 });
      const [left] = await s.query<{ count: string }>(
        'select count from sys_city_soldier where cid = ? and sid = 1',
        [cid],
      );
      if (Number(left?.count) !== 80) throw new Error('the curse did not take the deserters');
    },
  },
  {
    name: 'government sets tax, renames, levies and pacifies',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // `null` clears the cooldown; a fixed time keeps the row out of the clock-window rules.
      const schedule = (column: string, ago: number | null) =>
        ago === null
          ? s.query(`update mem_city_schedule set ${column} = 0 where cid = ?`, [cid])
          : s.query(`update mem_city_schedule set ${column} = unix_timestamp() - ? where cid = ?`, [
              ago,
              cid,
            ]);
      await s.query('update sys_city set chiefhid = 80213 where cid = ?', [cid]);
      await s.query('insert into sys_user_task (uid, tid, state) values (?, 410263, 0)', [uid]);

      for (const tax of [-1, 101, 20, 5]) await s.command(session, 'changeTax', cid, tax);
      await s.command(session, 'changeTax', FOREIGN_CITY, 10);

      for (const name of ['一二三四五六七八九', "新'城", '新<城', '新@城', '城&']) {
        await s.command(session, 'changeCityName', cid, name);
      }
      await s.command(session, 'changeCityName', FOREIGN_CITY, '新城');
      await s.command(session, 'changeCityName', cid, '新城');
      await s.command(session, 'changeCityName', cid, '又城');
      await s.query('update mem_city_schedule set last_change_name = 1 where cid = ?', [cid]);
      await s.query('update sys_city set type = 1 where cid = ?', [cid]);
      await s.command(session, 'changeCityName', cid, '又城');
      await s.query('update sys_city set type = 5 where cid = ?', [cid]);
      await s.query('insert into cfg_soldier_special_city (cid, sid, type) values (?, 45, 1)', [
        cid,
      ]);
      await s.command(session, 'changeCityName', cid, '又城');
      const fields = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = ?',
        [cid],
      );
      for (const field of fields) {
        await s.query('delete from sys_troops where targetcid = ? and state = 4', [
          wid2cid(Number(field.wid)),
        ]);
      }
      await s.query('delete from cfg_soldier_special_city where cid = ?', [cid]);

      for (const resid of [0, 1, 2, 3, 4, 9]) {
        await schedule('last_levy_resource', null);
        await s.query('update mem_city_resource set morale = 80 where cid = ?', [cid]);
        await s.command(session, 'levyResource', cid, resid);
      }
      await schedule('last_levy_resource', 300);
      await s.command(session, 'levyResource', cid, 0);
      s.mask(1); // the wait counts down
      await schedule('last_levy_resource', null);
      await s.query('update mem_city_resource set morale = 20 where cid = ?', [cid]);
      await s.command(session, 'levyResource', cid, 0);
      await s.command(session, 'levyResource', FOREIGN_CITY, 0);

      // 祭天 moves the next disaster by a random amount and may bring a blessing.
      await s.query('update mem_city_resource set morale = 50, complaint = 30 where cid = ?', [
        cid,
      ]);
      for (const action of [0, 1, 2, 3, 7]) {
        await schedule('last_pacify_people', null);
        await s.command(session, 'pacifyPeople', cid, action);
      }
      await schedule('last_pacify_people', 300);
      await s.command(session, 'pacifyPeople', cid, 0);
      s.mask(1);
      await s.query('update mem_city_resource set food = 100, gold = 100 where cid = ?', [cid]);
      for (const action of [0, 1, 2, 3]) {
        await schedule('last_pacify_people', null);
        await s.command(session, 'pacifyPeople', cid, action);
      }
      await s.query('update mem_city_resource set food = 1e9 where cid = ?', [cid]);
      await s.command(session, 'pacifyPeople', cid, 2);
      await s.query(
        `insert into sys_troops (id, uid, cid, hid, targetcid, state, pathtime, endtime,
            soldiers, resource)
          values (900001, 1, 1, 0, ?, 2, 600, unix_timestamp() - 1, '', '')`,
        [cid],
      );
      await s.command(session, 'pacifyPeople', cid, 0);
      await s.command(session, 'pacifyPeople', FOREIGN_CITY, 0);
    },
  },
  {
    name: 'government sets production rates and reads the building queue item',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.command(session, 'setCityProductRate', cid, 100, 100, 100, 100);
      await s.command(session, 'getCityProduct', cid);
      await s.command(session, 'setCityProductRate', cid, 50, '60', 70);
      await s.command(session, 'getCityProduct', cid);
      await s.command(session, 'setCityProductRate', FOREIGN_CITY, 10, 10, 10, 10);

      await s.command(session, 'getYaoYiLinTime');
      await s.query('insert into mem_user_buffer (uid, buftype, endtime) values (?, 11, 1)', [uid]);
      await s.command(session, 'getYaoYiLinTime');
      await s.query(
        'update mem_user_buffer set endtime = 2000000000 where uid = ? and buftype = 11',
        [uid],
      );
      await s.command(session, 'getYaoYiLinTime');
    },
  },
  {
    name: 'city list discards a city behind the second password',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const wid = cid2wid(cid);
      await s.command(session, 'getCityList');

      await s.query('delete from sys_user_password where uid = ?', [uid]);
      await s.command(session, 'openLock', 'discardCityType', 'sanguo', 'abc12');
      await s.command(session, 'modifyPassword', 'any', 'sanguo', 'abc12');
      await s.command(session, 'openLock', 'discardCityType', 'sanguo', 'abc');
      await s.command(session, 'openLock', 'discardCityType', 'sanguo', ' abc12 ');
      await s.command(session, 'modifyPassword', 'wrong', 'sanguo', 'pw2');
      await s.command(session, 'modifyPassword', 'abc12', 'sanguo', 'pw2');

      await s.command(session, 'discardCity', FOREIGN_CITY);
      await s.query('update mem_world set state = 1 where wid = ?', [wid]);
      await s.command(session, 'discardCity', cid);
      await s.query('update mem_world set state = 0 where wid = ?', [wid]);
      const troop = `insert into sys_troops (id, uid, cid, hid, targetcid, state, pathtime,
          endtime, soldiers, resource) values (900002, ?, ?, 0, ?, ?, 600, 0, '', '')`;
      await s.query(troop, [uid, cid, FOREIGN_CITY, 0]);
      await s.command(session, 'discardCity', cid);
      await s.query('delete from sys_troops where id = 900002');
      await s.query('update sys_city set type = 5 where cid = ?', [cid]);
      await s.command(session, 'discardCity', cid);
      await s.query('update sys_city set type = 1 where cid = ?', [cid]);
      await s.query('insert into cfg_soldier_special_city (cid, sid, type) values (?, 45, 1)', [
        cid,
      ]);
      await s.command(session, 'discardCity', cid);
      const fields = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = ?',
        [cid],
      );
      for (const field of fields) {
        await s.query('delete from sys_troops where targetcid = ? and state = 4', [
          wid2cid(Number(field.wid)),
        ]);
      }
      await s.query('delete from cfg_soldier_special_city where cid = ?', [cid]);

      const [field] = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 order by wid limit 1',
      );
      const fieldWid = Number(field?.wid);
      await s.query('update mem_world set ownercid = ? where wid = ?', [cid, fieldWid]);
      await s.query(troop, [1, FOREIGN_CITY, wid2cid(fieldWid), 4]);
      await s.command(session, 'discardCity', cid);
      await s.query('update sys_troops set uid = ? where id = 900002', [uid]);
      await s.command(session, 'discardCity', cid);
      await s.query('delete from sys_troops where id = 900002');

      await s.query('update sys_user set officepos = 7 where uid = ?', [uid]);
      await s.command(session, 'discardCity', cid);
      await s.command(session, 'getCityList');
    },
  },
  {
    name: 'government inspects, clears and discards its fields',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const free = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 order by wid limit 3',
      );
      const [a, b, c] = free.map((f) => Number(f.wid)) as [number, number, number];
      await s.query('update mem_world set ownercid = ?, level = 3 where wid in (?, ?)', [
        cid,
        a,
        b,
      ]);
      await s.command(session, 'getCityField', cid);
      s.unordered(4); // no ORDER BY: MyISAM vs InnoDB row order
      await s.command(session, 'getCityField', FOREIGN_CITY);

      const troop = `insert into sys_troops (id, uid, cid, hid, targetcid, task, state, starttime,
          pathtime, endtime, soldiers, resource) values (?, ?, ?, 0, ?, 1, ?, 0, 600, 0, '', '')`;
      await s.query(troop, [900003, uid, cid, wid2cid(a), 4]);
      await s.query(troop, [900004, 1, FOREIGN_CITY, wid2cid(a), 4]);
      await s.command(session, 'getFieldDetail', a);
      await s.query(
        'insert into sys_gather (wid, troopid, fooduse, level, starttime) values (?, 900003, 0, 3, 1)',
        [a],
      );
      await s.command(session, 'getCityField', cid);
      s.unordered(4);
      await s.command(session, 'getFieldDetail', a);
      await s.command(session, 'callBackFieldTroop', 900003, a);
      await s.query('delete from sys_gather where wid = ?', [a]);
      await s.command(session, 'callBackFieldTroop', 900003, a);
      s.mask(4); // the original answers with the field numbered like the troop
      await s.command(session, 'callBackFieldTroop', 900003, a);
      await s.command(session, 'callBackFieldTroop', 900004, a);
      await s.command(session, 'kickBackFieldTroop', cid, 900004, a);
      await s.command(session, 'kickBackFieldTroop', cid, 900004, a);

      await s.command(session, 'discardField', FOREIGN_CITY, a);
      await s.command(session, 'discardField', cid, c);
      await s.query(troop, [900005, 1, FOREIGN_CITY, wid2cid(b), 2]);
      await s.command(session, 'discardField', cid, b);
      await s.query('delete from sys_troops where id = 900005');
      await s.command(session, 'discardField', cid, a);
      await s.command(session, 'getCityProduct', cid);
    },
  },
  {
    name: 'troops gather on their fields and bring in what they found',
    tables: {
      sys_gather: { offsets: ['starttime'] },
      log_gather_count: { offsets: ['time'] },
      sys_report: { offsets: ['time'], map: { content: gatherSeconds } },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const field = async (type: number) => {
        const [row] = await s.query<{ wid: string }>(
          `select wid from mem_world where ownercid = 0 and type = ? and state = 0
            order by wid limit 1`,
          [type],
        );
        return Number(row?.wid);
      };
      const desert = await field(2);
      const mountain = await field(5);
      const lake = await field(6);
      const barren = await field(3);
      const empty = await field(7);
      const foreign = await field(4);
      const plain = await field(1);
      await s.query('update mem_world set ownercid = ?, level = 5 where wid in (?, ?, ?, ?)', [
        cid,
        desert,
        mountain,
        lake,
        empty,
      ]);
      await s.query('update mem_world set ownercid = ?, level = 0 where wid = ?', [cid, barren]);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, npcid, sex, face, cid, state, level, exp,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (900011, ?, '甲', 0, 1, 10, ?, 4, 30, 0, 20, 40, 60, 50, 60, 0),
          (900012, ?, '乙', 0, 1, 10, ?, 4, 45, 0, 20, 40, 60, 50, 60, 0)`,
        [uid, cid, uid, cid],
      );
      const troop = `insert into sys_troops (id, uid, cid, hid, targetcid, task, state, starttime,
          pathtime, endtime, soldiers, resource, fooduse)
        values (?, ?, ?, ?, ?, 1, 4, 0, 600, 0, '', '', ?)`;
      await s.query(troop, [900011, uid, cid, 900011, wid2cid(desert), 10]);
      await s.query(troop, [900012, uid, cid, 900012, wid2cid(mountain), 20000]);
      await s.query(troop, [900013, uid, cid, 0, wid2cid(lake), 10]);

      await s.command(session, 'gatherFieldStart', cid2wid(cid));
      await s.command(session, 'gatherFieldStart', plain);
      await s.command(session, 'gatherFieldStart', barren);
      await s.command(session, 'gatherFieldStart', foreign);
      await s.command(session, 'gatherFieldStart', empty);
      await s.command(session, 'gatherFieldStart', lake);
      await s.query('update mem_world set state = 1 where wid = ?', [desert]);
      await s.command(session, 'gatherFieldStart', desert);
      await s.query('update mem_world set state = 0 where wid = ?', [desert]);
      await s.query(
        `insert into sys_user_state (uid, vacstart, vacend, reason)
        values (?, 0, unix_timestamp() + 3600, '')`,
        [uid],
      );
      await s.command(session, 'gatherFieldStart', desert);
      await s.query('delete from sys_user_state where uid = ?', [uid]);
      await s.command(session, 'gatherFieldStart', desert);
      s.offset(4, 1, 'starttime');
      await s.command(session, 'gatherFieldStart', desert);

      await s.command(session, 'gatherFieldEnd', foreign);
      await s.command(session, 'gatherFieldEnd', desert);
      await s.command(session, 'gatherFieldEnd', desert);
      await s.query('insert into mem_treasure_map (uid, cid, endtime) values (?, ?, 0)', [
        uid,
        wid2cid(desert),
      ]);
      await s.query('insert into sys_hero_task (uid, `group`, tid, state) values (?, 4, 411, 1)', [
        uid,
      ]);
      for (const seed of [11, 12, 13]) {
        await s.query(
          `replace into sys_gather (wid, troopid, fooduse, level, starttime)
          values (?, 900011, 10, 5, unix_timestamp() - 37800)`,
          [desert],
        );
        s.seed(seed);
        await s.command(session, 'gatherFieldEnd', desert);
        gatherSecondsIn(s, 4, 1);
      }
      s.stopRng();
      await s.query(
        `insert into sys_gather (wid, troopid, fooduse, level, starttime)
        values (?, 900013, 10, 0, unix_timestamp() - 7200), (?, 999999, 10, 5, 0)`,
        [barren, lake],
      );
      await s.command(session, 'gatherFieldEnd', barren);
      await s.command(session, 'gatherFieldEnd', lake);

      await s.command(session, 'gatherStartAll');
      await s.command(session, 'gatherStartAll');
      await s.query('update sys_gather set starttime = unix_timestamp() - 1000 where wid = ?', [
        mountain,
      ]);
      await s.query('update sys_gather set starttime = unix_timestamp() - 40000 where wid = ?', [
        desert,
      ]);
      s.seed(21);
      await s.command(session, 'gatherEndAll');
      s.stopRng();
      await s.command(session, 'gatherEndAll');

      await s.command(session, 'allowAutoDiscard', false);
      await s.command(session, 'allowAutoDiscard', true);
      await s.command(session, 'getStayTroops', 1);
      s.unordered(1);
    },
  },
  {
    name: 'lord tasks refresh, free once a day',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // Ten candidates, so every refresh deals all of them whatever the draw.
      await s.query('update cfg_systask_rate set nobility = 99 where tid >= 86010 and tid < 86300');
      try {
        await s.query('update sys_user set money = 10 where uid = ?', [session.uid]);
        await s.query('update mem_user_schedule set last_reset_sys_task = 0 where uid = ?', [
          session.uid,
        ]);
        // The original's lord task list does not parse, so only the effects are compared.
        await s.command(session, 'getTaskTypeGroupList', 7);
        s.mask();
        await s.command(session, 'refreshSysTask', 7);
        s.mask();
        await s.command(session, 'refreshSysTask', 7);
        await s.query('update sys_user set money = 100 where uid = ?', [session.uid]);
        await s.command(session, 'refreshSysTask', 7);
        s.mask();
      } finally {
        await s.query(
          'update cfg_systask_rate set nobility = 0 where tid >= 86010 and tid < 86300',
        );
      }
    },
  },
  {
    name: 'task dialog lists tasks and pays rewards',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // Type 7 is left out: the original's lord-task query does not parse.
      for (const type of [0, 1, 2, 3, 4, 5, 6, 9]) {
        await s.command(session, 'getTaskTypeGroupList', type);
      }
      await s.command(session, 'getTaskList', 1);
      await s.command(session, 'getTaskList', 80);
      await s.command(session, 'getTaskDetail', 2);
      await s.command(session, 'getTaskDetail', 999999);

      await s.command(session, 'getReward', 2);
      await s.query('insert into sys_user_goal (uid, gid) values (?, 2)', [uid]);
      await s.command(session, 'getTaskList', 1);
      await s.command(session, 'getReward', 2);
      await s.command(session, 'getReward', 2);
      await s.command(session, 'getTaskTypeGroupList', 0);

      const things = `insert into sys_things (uid, tid, count) values (?, ?, ?)
        on duplicate key update count = values(count)`;
      await s.query(things, [uid, 10400, 100]);
      await s.command(session, 'getTaskDetail', 801);
      await s.command(session, 'getReward', 801);
      await s.command(session, 'getReward', 801);
      await s.command(session, 'getMultiReward', 801, 2);
      await s.command(session, 'getMultiReward', 801, 0);

      for (const [tid, count] of [
        [11001, 5],
        [12001, 40],
        [13001, 5],
      ]) {
        await s.query(things, [uid, tid, count]);
      }
      await s.command(session, 'getMultiReward', 10101, 10);
      await s.command(session, 'getMultiReward', 10101, 3);

      await s.query('insert into sys_user_task (uid, tid, state) values (?, 250, 0)', [uid]);
      await s.command(session, 'getReward', 250);
      await s.query('update sys_user set officepos = 1 where uid = ?', [uid]);
      await s.command(session, 'getTaskDetail', 250);
      await s.command(session, 'getReward', 250);

      await s.query('update sys_user_task_num set num = maxnum where uid = ?', [uid]);
      await s.command(session, 'getReward', 86001);

      await s.command(session, 'dropSysTask', 999999);
      await s.command(session, 'dropSysTask', 2);
      await s.query('insert into sys_user_task (uid, tid, state) values (?, 80000, 0)', [uid]);
      await s.command(session, 'dropSysTask', 80000);
      await s.command(session, 'dropTask', 20010);
    },
  },
  {
    name: 'guide reads its steps and remembers finished ones',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getGuidesByGroup', 1);
      await s.command(session, 'getGuidesByGroup', 2);
      await s.command(session, 'getGuidesByGroup', 'x');
      await s.command(session, 'completeGuide', 3);
      await s.command(session, 'completeGuide', 3);
      await s.command(session, 'completeGuide', 14);
    },
  },
  {
    name: 'goods are listed, opened and sold',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );
      // The login hands out one of two daily boxes at random.
      await s.query('delete from sys_goods where uid = ? and gid in (50186, 50187)', [uid]);
      await s.command(session, 'loadUserGoods');
      await s.command(session, 'useGoods', 999);
      await s.command(session, 'useGoods', 57);
      await s.command(session, 'useGoods', 50101, 100);
      await s.command(session, 'useGoods', 1, 2);
      await s.command(session, 'useGoods', 8);
      await s.command(session, 'useGoods', 87, 2);
      await s.command(session, 'useGoods', 86);
      await s.command(session, 'useGoods', 50104);
      await give(50101, 1);
      await s.command(session, 'useGoods', 50101);
      await s.command(session, 'useGoods', 50101);

      await give(16, 2);
      await give(19, 1);
      // Only 藏宝图 can drop, once: a weight of 5 or less always comes alone. Other drops could
      // also hit mt_rand(1, 0), which the legacy server's PHP 7 rejects and PHP 5 answered 1.
      await s.query(`update cfg_goods set copperbox = -copperbox, silverbox = -silverbox
        where gid <> 118 and (copperbox > 0 or silverbox > 0)`);
      try {
        await s.command(session, 'useGoods', 16);
        await s.command(session, 'useGoods', 16);
        await s.command(session, 'useGoods', 19);
        await give(19, 1);
        await s.command(session, 'useGoods', 19);
      } finally {
        await s.query(`update cfg_goods set copperbox = abs(copperbox), silverbox = abs(silverbox)
          where copperbox < 0 or silverbox < 0`);
      }

      await s.command(session, 'sellGoods', cid, 67, 3);
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.command(session, 'sellGoods', cid, 67, 3);
      await s.command(session, 'sellGoods', cid, 67, 100);
      await s.command(session, 'sellGoods', cid, 67, 0);
      await s.command(session, 'sellGoods', cid, 160052, 1);
      await s.command(session, 'loadUserGoods');
    },
  },
  {
    name: 'goods compose 聚魂珠, 马鬃 and 马鞭',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );
      await give(10830, 3);
      await give(10839, 2);
      await give(19081, 6);
      await give(19082, 4);
      await s.command(session, 'goodsCompose', 999);
      await s.command(session, 'goodsCompose', 10839);
      await s.command(session, 'goodsCompose', 10830);
      await s.command(session, 'goodsCompose', 10830);
      await s.command(session, 'goodsCompose', 19081);
      await s.command(session, 'goodsCompose', 19081);
      s.rng([10]);
      await s.command(session, 'goodsCompose', 19082);
      s.rng([50]);
      await s.command(session, 'goodsCompose', 19082);
      s.stopRng();
      await s.command(session, 'goodsCompose', 19082);
    },
  },
  {
    name: 'speed-up items shorten buildings and research',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );
      // The 民房 at inner (0, 0) and the 书院 at inner (4, 4).
      const house = [cid, 1, 0, 0, 5];
      const college = [cid, 1, 4, 4, 7];
      const luban = async (gid: number, ...extra: number[]) => {
        await s.command(session, 'useTypeGoods', 0, gid, cid, ...house, ...extra);
        buildingTimes(s);
      };
      const mojia = async (gid: number, ...extra: number[]) => {
        await s.command(session, 'useTypeGoods', 1, gid, cid, ...college, ...extra);
        s.mask(4, 2, 0, '*', 'state_timeleft');
        s.offset(4, 2, 0, '*', 'state_endtime');
        s.unordered(4, 2, 0);
      };
      await give(67, 2);
      await give(73, 0);
      await s.command(session, 'getUserTypeGoods', 0, 7200);
      await s.command(session, 'getUserTypeGoods', 1, -5);
      await s.command(session, 'getUserTypeGoods', 42);
      await s.command(session, 'getUserTypeGoods', 160026);

      await luban(67);
      await luban(66);
      await s.query('update sys_building set level = 3 where cid = ? and xy in (100, 101, 102)', [
        cid,
      ]);
      await s.command(session, 'startUpgradeBuilding', ...house);
      buildingTimes(s);
      for (const table of ['sys_building', 'mem_building_upgrading']) {
        await s.query(
          `update ${table} set state_endtime = unix_timestamp() + 36000 where cid = ? and xy = 100`,
          [cid],
        );
      }
      await give(69, 0);
      await luban(69);
      await luban(67);
      await give(68, 1);
      await luban(68);
      await give(72, 1);
      await luban(72);
      // A fixed time left keeps the 元宝 cost away from its 800 second steps.
      await s.query(
        `update sys_building set state_endtime = unix_timestamp() + 400
          where cid = ? and xy = 100`,
        [cid],
      );
      await s.query('update sys_user set money = 10, gift = 1000 where uid = ?', [uid]);
      await luban(73, 0);
      await luban(73, 1);

      await mojia(8);
      await s.dialog(session, cid, 7, 44, 'startUpgradeTechnic', 1);
      technicTimes(s);
      // Long enough for every cut: 墨家宝典 on a due research fails in the original.
      for (const table of ['sys_technic', 'mem_technic_upgrading']) {
        await s.query(`update ${table} set state_endtime = unix_timestamp() + 7200 where cid = ?`, [
          cid,
        ]);
      }
      await mojia(8);
      await give(8, 1);
      await mojia(8);
      await give(10, 1);
      await mojia(10);
      await s.query('update sys_technic set state_endtime = unix_timestamp() + 400 where uid = ?', [
        uid,
      ]);
      await mojia(53);
      await mojia(53, 1);
      await mojia(53, 1);
      await s.command(session, 'useTypeGoods', 44, 10152, cid);
    },
  },
  {
    name: 'buff items add timed effects',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );
      /** `[gid, 2, text, endtime]`: the end time is now + duration. */
      const use = async (gid: number, count?: number) => {
        await (count === undefined
          ? s.command(session, 'useGoods', gid)
          : s.command(session, 'useGoods', gid, count));
        s.offset(4, 3);
      };
      for (const gid of [2, 3, 4, 5, 44, 6, 7, 25, 165, 51, 54, 55, 133, 154, 142, 120, 60, 62]) {
        await give(gid, 3);
      }
      await use(2, 2);
      await use(3);
      await use(4);
      await use(5);
      await use(44);
      await use(6, 2);
      await use(6);
      await s.query(
        `insert into mem_user_buffer (uid, buftype, endtime) values (?, 10085, unix_timestamp() + 60)
          on duplicate key update endtime = values(endtime)`,
        [uid],
      );
      await use(7);
      await s.query('delete from mem_user_buffer where uid = ? and buftype = 10085', [uid]);
      await use(7, 2);
      await give(10085, 1);
      await use(10085);
      await use(25, 2);
      await use(165);
      await use(51);
      await use(54);
      await use(55);
      await use(133);
      await use(154);
      await use(142);
      await use(142);
      await use(120);
      await use(120);
      await use(60);
      await use(62);
      await use(61);
      await give(56, 3);
      await use(56, 2);
      await use(56);
      await use(56);
      await give(166, 3);
      await use(166, 3);
      await give(10333, 2);
      await use(10333, 2);
      await give(10321, 1);
      await use(10321);
      await give(10158, 2);
      await use(10158);

      await give(117, 3);
      await give(124, 3);
      await s.query('update sys_user set nobility = 3 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 117);
      await s.query('update sys_user set nobility = 18 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 124);
      await s.query('update sys_user set nobility = 6 where uid = ?', [uid]);
      for (const gid of [117, 117, 124, 124]) {
        await s.command(session, 'useGoods', gid);
        s.mask(4, 2);
      }

      await give(57, 2);
      await give(139, 2);
      await s.query('update mem_city_resource set people = 10 where cid = ?', [cid]);
      await s.command(session, 'useGoods', 57);
      await s.command(session, 'useGoods', 139);
      await s.query('update mem_city_resource set people = people_max where cid = ?', [cid]);
      await s.command(session, 'useGoods', 57);
      await s.command(session, 'useGoods', 139);
      await give(58, 2);
      await s.query('update mem_city_resource set morale = 50, complaint = 20 where cid = ?', [
        cid,
      ]);
      await s.command(session, 'useGoods', 58);
      await s.command(session, 'useGoods', 58);
      // "请在71小时59分钟59秒后再使用": the countdown is to the second, so a clock tick between
      // the two calls shifts it on one side only.
      s.mask(1);

      await give(134, 2);
      await s.query('update sys_user set honour = 0 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 134);
      await s.query('update sys_user set honour = -50 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 134);
      await give(138, 2);
      await s.query('update mem_user_schedule set today_war_count = 0 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 138);
      await s.query('update mem_user_schedule set today_war_count = 3 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 138);
      await s.command(session, 'useGoods', 47);
    },
  },
  {
    name: 'default boxes give one configured reward',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );
      // The pick is random: all rows of a box but one get no weight.
      const rates = await s.query<{ id: number; rate: number }>(
        'select id, rate from cfg_box_details where srctype = 0 and srcid in (1001, 10128, 10144, 10217)',
      );
      const pin = (srcid: number, id: number) =>
        s.query(
          'update cfg_box_details set rate = if(id = ?, 1, 0) where srctype = 0 and srcid = ?',
          [id, srcid],
        );
      try {
        await give(10164, 1);
        await s.command(session, 'useGoods', 10164);
        await give(161502, 1);
        await s.command(session, 'useGoods', 161502);
        await give(161503, 2);
        await s.command(session, 'useGoods', 161503);
        await s.command(session, 'useGoods', 161503);
        await give(10057, 1);
        await give(10058, 1);
        await s.command(session, 'useGoods', 10057);
        for (const gid of [10139, 10137, 10317, 10318]) {
          await give(gid, 1);
          await s.command(session, 'useGoods', gid);
        }
        await give(24, 1);
        await s.command(session, 'useGoods', 24);

        // 1001: resources, things, an announced item and a resource the list does not show.
        for (const id of [203, 204, 222, 223, 209]) {
          await pin(1001, id);
          await give(1001, 1);
          await s.command(session, 'useGoods', 1001);
        }
        // 10144: soldiers; 10128: gear three times per player.
        await pin(10144, 10525);
        await give(10144, 1);
        await s.command(session, 'useGoods', 10144);
        await pin(10128, 10134);
        for (let i = 0; i < 4; i++) {
          await give(10128, 1);
          await s.command(session, 'useGoods', 10128);
        }
        // 10217: strengthened gear.
        await pin(10217, 11469);
        await give(10217, 1);
        await s.command(session, 'useGoods', 10217);
      } finally {
        for (const { id, rate } of rates) {
          await s.query('update cfg_box_details set rate = ? where id = ?', [rate, id]);
        }
      }
    },
  },
  {
    name: 'hotel recruits heroes and refreshes its list',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // The level 15 客栈 sits at inner (2, 4); its dialog is addressed by bid 10 and y * 10 + x.
      const hotel = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 10, 42, func, ...args);
      // A refresh ahead keeps the shipped list; the regenerated one is random.
      await s.query(
        'update mem_city_schedule set last_reset_recruit = unix_timestamp() + 3600 where cid = ?',
        [cid],
      );
      await hotel('getBuildingInfo', 1, 2, 4, 10);
      await hotel('recruitHero', 30231);
      await hotel('recruitHero', 1);
      await s.query('update mem_city_resource set gold = 100 where cid = ?', [cid]);
      await hotel('recruitHero', 30235);
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);
      await s.query('update sys_building set level = 2 where cid = ? and bid = 11', [cid]);
      await hotel('recruitHero', 30235);
      await s.query('update sys_building set level = 15 where cid = ? and bid = 11', [cid]);

      // 西域胡商 of the running event 2054 comes with a once-per-player gift, already taken in
      // the save; a cap of one per player then refuses the second.
      const eventHero = (id: number) =>
        s.query(
          `insert into sys_recruit_hero (id, name, sex, face, cid, level, exp, affairs_base,
            bravery_base, wisdom_base, loyalty, gold_need, gen_time, herotype)
          values (?, '西域胡商', 1, 1001, ?, 10, 4500, 30, 40, 85, 70, 9000, 0, 197)`,
          [id, cid],
        );
      await s.query('delete from log_act where uid = ? and actid = 197 and log_type = 2000', [uid]);
      await eventHero(40001);
      await hotel('recruitHero', 40001);
      try {
        await s.query('update cfg_recruit_hero set userhavecnt = 1 where herotype = 197');
        await eventHero(40002);
        await hotel('recruitHero', 40002);
      } finally {
        await s.query('update cfg_recruit_hero set userhavecnt = 0 where herotype = 197');
      }

      await s.query('delete from sys_goods where uid = ? and gid = 23', [uid]);
      await hotel('resetRecruitHero');
      await s.query('insert into sys_goods (uid, gid, count) values (?, 23, 1)', [uid]);
      await hotel('resetRecruitHero');
      s.mask(6, 2);
      const [fresh] = await s.query<{ n: string }>(
        'select count(*) as n from sys_recruit_hero where cid = ? and id > 40002',
        [cid],
      );
      if (Number(fresh?.n) !== 15) throw new Error('the 招贤榜 did not refill the list');
      await s.query('delete from sys_recruit_hero where cid = ? and id > 40002', [cid]);
    },
  },
  {
    name: 'hero dialog upgrades, trains, renames, rewards and dismisses heroes',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hero = (func: string, ...args: unknown[]) => s.command(session, func, cid, ...args);
      const LORD = 80213;
      const HERO = 90001;
      const FAR_FUTURE = 2000000000;

      // The lord wears three pieces of the 龙渊 set: strengthened, smelted, with gems, deified
      // (+10% 统率) and with an attack addon; 虎符, 勇武 and 马鞭 buffers and a 统率 book.
      const gear: [spart: number, sid: number, armorid: number][] = [
        [1, 50956, 53029],
        [2, 50957, 53030],
        [11, 50968, 53039],
      ];
      for (const [spart, sid, armorid] of gear) {
        await s.query('insert into sys_hero_armor (hid, spart, sid, armorid) values (?, ?, ?, ?)', [
          LORD,
          spart,
          sid,
          armorid,
        ]);
        await s.query('update sys_user_armor set hid = ? where sid = ?', [LORD, sid]);
      }
      await s.query('update sys_user_armor set strong_level = 4 where sid = 50956');
      await s.query('update sys_user_armor set combine_level = 3 where sid = 50957');
      await s.query("update sys_user_armor set embed_pearls = '305,0,302' where sid = 50968");
      await s.query(
        'insert into sys_user_tie_deify_attribute (attid, sid, value) values (10001, 50956, 10)',
      );
      await s.query('insert into sys_armor_addon (sid, attid, value) values (50968, 10008, 10)');
      for (const buftype of [160040, 3, 19057]) {
        await s.query(
          'insert into mem_hero_buffer (hid, buftype, endtime, bufparam) values (?, ?, ?, 0)',
          [LORD, buftype, FAR_FUTURE],
        );
      }
      await s.query(
        'insert into sys_user_book (id, bid, uid, hid, level) values (900001, 4, ?, ?, 1)',
        [uid, LORD],
      );

      await hero('upgradeHero', LORD);
      await s.query('update sys_city_hero set exp = 100 where hid = ?', [LORD]);
      await hero('upgradeHero', LORD);
      await hero('addHeroPoint', LORD, 3, 3, 3);
      await hero('addHeroPoint', LORD, 2, 3, 3);
      await hero('addHeroPoint', LORD, 9, 3, 3);
      await hero('largessHero', LORD, 1);
      await hero('dismissHero', LORD);
      await s.query('delete from sys_goods where uid = ? and gid = 22', [uid]);
      await hero('clearHeroPoint', LORD);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 22, 2)', [uid]);
      await hero('clearHeroPoint', LORD);

      await s.query(
        `insert into sys_city_hero (hid, uid, name, npcid, sex, face, cid, state, level, exp,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (?, ?, '甲乙', 0, 1, 10, ?, 0, 30, 0, 20, 40, 60, 50, 60, 0)`,
        [HERO, uid, cid],
      );
      await s.query(
        `insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
        values (?, 100, 120, 100, 120)`,
        [HERO],
      );
      await hero('upgradeHero', HERO);
      // Above the cap: put back to 120 although the upgrade fails.
      await s.query('update sys_city_hero set level = 121 where hid = ?', [HERO]);
      await hero('upgradeHero', HERO);
      await s.query('update sys_city_hero set level = 30 where hid = ?', [HERO]);

      for (const name of ['一二三四五', "a'b", '  ', 'A.CN', ' 新名 ']) {
        await hero('changeHeroName', HERO, name);
      }

      await s.query('update sys_goods set count = 2 where uid = ? and gid = 30', [uid]);
      await hero('largessHero', HERO, 1);
      await hero('largessHero', HERO, 1);
      s.mask(1); // 15 minutes less the second or two since the last reward
      const resetLargess = () =>
        s.query('update mem_hero_schedule set last_largess = 0 where hid = ?', [HERO]);
      await resetLargess();
      await s.query('delete from sys_goods where uid = ? and gid = 31', [uid]);
      await hero('largessHero', HERO, 2);
      // Gold: the gain is random, the loyalty cap of 100 is not.
      await s.query('update sys_city_hero set loyalty = 100 where hid = ?', [HERO]);
      await hero('largessHero', HERO, 0);
      await resetLargess();
      await s.query('update mem_city_resource set gold = 100 where cid = ?', [cid]);
      await hero('largessHero', HERO, 0);
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);
      await s.query('update sys_city_hero set bravery_base = 250 where hid = ?', [HERO]);
      await hero('largessHero', HERO, 0);
      await s.query('update sys_city_hero set bravery_base = 60 where hid = ?', [HERO]);

      await s.query('update sys_city_hero set state = 1 where hid = ?', [HERO]);
      await hero('dismissHero', HERO);
      await s.query('update sys_city_hero set state = 0 where hid = ?', [HERO]);
      await s.query('update sys_user_armor set hid = ? where sid = 50969', [HERO]);
      await hero('dismissHero', HERO);
      await s.query('update sys_user_armor set hid = 0 where sid = 50969');

      // Item bonuses are taken back; the hero goes to the only free wild tile left.
      await s.query(
        `insert into sys_city_hero_base_add (hid, uid, type, command_base_add_on,
          affairs_base_add_on, bravery_base_add_on, wisdom_base_add_on)
        values (?, ?, 1, 1, 2, 3, 4)`,
        [HERO, uid],
      );
      await s.query(
        'update sys_city_hero set affairs_base = affairs_base + 2, bravery_base = bravery_base + 3 where hid = ?',
        [HERO],
      );
      const [tile] = await s.query<{ wid: number }>(
        'select wid from mem_world where ownercid = 0 and type > 1 and state = 0 order by wid limit 1',
      );
      const wid = Number(tile?.wid);
      await s.query('delete from sys_city_hero where uid = 0 and cid = ?', [wid2cid(wid)]);
      try {
        await s.query(
          'update mem_world set state = 100 where ownercid = 0 and type > 1 and state = 0 and wid <> ?',
          [wid],
        );
        await hero('dismissHero', HERO);
      } finally {
        await s.query('update mem_world set state = 0 where state = 100');
      }
    },
  },
  {
    name: 'hero gear is equipped, repaired, renovated and taken off',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // Equal-strength gear and its parallel attribute arrays have no deterministic secondary order.
      const GEAR_LISTS: Record<string, (string | number)[]> = {
        loadUserPartArmor: [4],
        getHeroArmor: [4],
        equipArmor: [4, 1],
        offloadArmor: [4, 1],
        offloadAllArmor: [4, 1],
      };
      const cmd = async (func: string, ...args: unknown[]) => {
        await s.command(session, func, ...args);
        const at = GEAR_LISTS[func];
        if (!at) return;
        const [ties, tieAttributes] = func === 'loadUserPartArmor' ? [3, 4] : [6, 7];
        for (let i = 0; i < 8; i++) s.unordered(...at, i);
        s.unordered(...at, ties);
        s.unordered(...at, tieAttributes);
      };
      const LORD = 80213;
      // 白虎 pieces need level 120; 龙渊 110.
      const HELMET = 50939;
      const NECKLACE = 50938;
      const SHOULDER = 50941;
      const LONGYUAN_HELMET = 50956;
      const damage = (sid: number, hp: number, hpMax = 255) =>
        s.query('update sys_user_armor set hp = ?, hp_max = ? where sid = ?', [hp, hpMax, sid]);

      await cmd('getHeroArmor', LORD);
      await cmd('loadUserPartArmor', 1);
      await cmd('equipArmor', LORD, HELMET, 20);
      await cmd('equipArmor', LORD, 999999, 10);
      await cmd('equipArmor', LORD, HELMET, 10);
      await s.query('update sys_city_hero set level = 120 where hid = ?', [LORD]);
      await cmd('equipArmor', LORD, HELMET, 10);
      await cmd('equipArmor', LORD, LONGYUAN_HELMET, 10);
      await cmd('equipArmor', LORD, HELMET, 10);
      await cmd('equipArmor', LORD, NECKLACE, 20);
      await cmd('equipArmor', LORD, LONGYUAN_HELMET, 10);
      await cmd('equipArmor', LORD, LONGYUAN_HELMET, 10);
      await damage(SHOULDER, 0);
      await cmd('equipArmor', LORD, SHOULDER, 30);
      await damage(SHOULDER, 2550);
      await s.query('update sys_city_hero set state = 2 where hid = ?', [LORD]);
      await cmd('equipArmor', LORD, SHOULDER, 30);
      await s.query('update sys_city_hero set state = 1 where hid = ?', [LORD]);
      await cmd('equipArmor', LORD, SHOULDER, 30);
      await s.query('update sys_city_hero set state = 0 where hid = ?', [LORD]);
      await s.query('insert into sys_armor_special (sid, type) values (?, 2)', [NECKLACE]);
      await cmd('offloadArmor', LORD, 20);
      await cmd('offloadArmor', LORD, 20);
      await cmd('equipArmor', LORD, NECKLACE, 20);

      // 黄金 repairs lower the maximum; 元宝 / 礼金 renovations restore it.
      await s.query('update mem_city_resource set gold = 10000000 where cid = ?', [cid]);
      await damage(LONGYUAN_HELMET, 1000);
      await cmd('repairArmor', cid, LONGYUAN_HELMET);
      await cmd('repairArmor', cid, LONGYUAN_HELMET);
      await damage(NECKLACE, 500);
      await s.query('update mem_city_resource set gold = 100 where cid = ?', [cid]);
      await cmd('repairArmor', cid, NECKLACE);
      await s.query('update mem_city_resource set gold = 10000000 where cid = ?', [cid]);
      await damage(SHOULDER, 1200);
      await cmd('repairAllArmor', cid, LORD, `${NECKLACE},${SHOULDER}`);
      await cmd('repairAllArmor', cid, LORD, '');
      await cmd('renovateArmor', LONGYUAN_HELMET);
      await cmd('renovateArmor', LONGYUAN_HELMET);
      await cmd('renovateArmorWithGift', NECKLACE);
      await damage(LONGYUAN_HELMET, 2000, 240);
      await damage(SHOULDER, 900, 250);
      await cmd('renovateAllArmor', LORD, `${LONGYUAN_HELMET},${SHOULDER}`);
      await damage(NECKLACE, 100, 200);
      await cmd('renovateAllArmorWithGift', LORD, `${NECKLACE}`);
      await damage(NECKLACE, 100, 200);
      await s.query('update sys_user set money = 0, gift = 0 where uid = ?', [uid]);
      await cmd('renovateArmor', NECKLACE);
      await cmd('renovateAllArmorWithGift', LORD, `${NECKLACE}`);

      // A complete 白虎 set can be deified, with a 炼化鼎.
      await cmd('deifyArmor', LORD);
      await cmd('offloadAllArmor', LORD);
      const set: [spart: number, sid: number, armorid: number][] = [
        [10, 50939, 53041],
        [20, 50938, 53042],
        [30, 50941, 53043],
        [40, 50942, 53044],
        [50, 50943, 53045],
        [60, 50944, 53046],
        [70, 50945, 53047],
        [80, 50946, 53048],
        [90, 50947, 53049],
        [91, 50948, 53049],
        [100, 50949, 53050],
        [101, 50950, 53050],
        [110, 50951, 53051],
        [111, 50952, 53051],
        [112, 50953, 53051],
        [120, 50954, 53052],
      ];
      for (const [spart, sid, armorid] of set) {
        await s.query('insert into sys_hero_armor (hid, spart, sid, armorid) values (?, ?, ?, ?)', [
          LORD,
          spart,
          sid,
          armorid,
        ]);
        await s.query('update sys_user_armor set hid = ? where sid = ?', [LORD, sid]);
      }
      await damage(NECKLACE, 2550);
      await cmd('getHeroArmor', LORD);
      await s.query('delete from sys_goods where uid = ? and gid = 155', [uid]);
      await cmd('deifyArmor', LORD);
      await s.query(
        'insert into sys_user_tie_deify_attribute (attid, sid, value) values (10003, 50945, 7)',
      );
      await cmd('getHeroArmor', LORD);
      await cmd('offloadAllArmor', LORD);
    },
  },
  {
    name: 'gear store lists, sells, breaks up, analyzes and activates specials',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const LORD = 80213;
      const cmd = (func: string, ...args: unknown[]) => s.command(session, func, ...args);
      // Equal-strength pieces and their parallel tables have no deterministic secondary order.
      const list = async (func: string, ...args: unknown[]) => {
        await cmd(func, ...args);
        for (let i = 1; i < 8; i++) s.unordered(4, i);
      };
      const GREY = 900601;
      const WHITE = 900602;
      const GREEN = 900603;
      const LORD_BLUE = 900604;
      const BLUE = 900605;
      const PURPLE = 900606;
      const MORIZHIREN = 900607;
      const HORSE = 900608;
      const BREAK = 900609;
      const UNKNOWN = 900610;
      const GREY_2 = 900611;
      const TIE_PIECE = 900612;
      const pieces: [sid: number, armorid: number, holes: string, pearls: string, level: number][] =
        [
          [GREY, 1, '', '', 0],
          [WHITE, 5, '', '', 0],
          [GREEN, 29, '', '', 0],
          [LORD_BLUE, 15001, '', '', 0],
          [BLUE, 15040, '', '', 0],
          [PURPLE, 12009, '', '', 0],
          [MORIZHIREN, 12016, '', '', 0],
          [HORSE, 1381, '0,0,0,0,0', '0,502,0,0,0', 0],
          [BREAK, 12010, '0,0,0,0,0', '305,17505,300,17500,305,17505', 12],
          [UNKNOWN, 999999, '', '', 0],
          [GREY_2, 1, '', '', 0],
          [TIE_PIECE, 10191, '0,0,0', '', 3],
        ];
      for (const [sid, armorid, holes, pearls, level] of pieces) {
        await s.query(
          `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, strong_level,
             strong_value, embed_holes, embed_pearls)
           values (?, ?, ?, 1000, 100, 0, ?, 0, ?, ?)`,
          [sid, uid, armorid, level, holes, pearls],
        );
      }

      await list('loadUserArmor');
      await list('loadUserActivedArmor', 0);
      await list('loadUserActivedArmor', 1);
      await list('loadUserActivedArmor', 5);

      // 神兵鉴符 activates a special; 末日之刃 re-rolls one of four effects each time.
      await s.query('delete from sys_goods where uid = ? and gid = 10522', [uid]);
      await cmd('loadActiveArmorSpecialGoods', PURPLE);
      await cmd('activeArmorSpecial', 999999);
      await cmd('activeArmorSpecial', PURPLE);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 10522, 9)', [uid]);
      await cmd('loadActiveArmorSpecialGoods', PURPLE);
      await cmd('activeArmorSpecial', PURPLE);
      await cmd('activeArmorSpecial', PURPLE);
      for (const draws of [[49, 1, 6], [49, 0, 2], [82], [89], [98]]) {
        s.rng(draws);
        await cmd('activeArmorSpecial', MORIZHIREN);
      }
      s.stopRng();

      // Selling needs a level 5 市场 and 公士; a 坐骑 must have its pearls taken off first.
      await s.query('update sys_building set level = 4 where cid = ? and bid = 13', [cid]);
      await cmd('sellArmor', cid, GREY);
      await s.query('update sys_building set level = 15 where cid = ? and bid = 13', [cid]);
      await s.query('update sys_user set nobility = 0 where uid = ?', [uid]);
      await cmd('sellArmor', cid, GREY);
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await cmd('sellArmor', cid, 999999);
      await cmd('sellArmor', cid, HORSE);
      s.rng([0]);
      await cmd('sellArmor', cid, GREY);
      await s.query('update cfg_act set endtime = 0 where type = 6402');
      await cmd('sellArmor', cid, WHITE);
      s.stopRng();

      // Breaking up gives 装备碎片, 强化宝珠 and (half the time each) gems or lower gems.
      await cmd('zhuangbeichaijie', 999999);
      await s.query('update sys_user_armor set hid = ? where sid = ?', [LORD, BLUE]);
      await cmd('zhuangbeichaijie', BLUE);
      await cmd('zhuangbeichaijie', GREEN);
      await cmd('zhuangbeichaijie', HORSE);
      s.rng([10, 60, 70, 20, 30, 80, 1]);
      await cmd('zhuangbeichaijie', BREAK);
      s.stopRng();

      // Analyzing checks every piece first, then rolls 0..100 for each.
      await cmd('multipAnalyzeArmor', 999999);
      await cmd('multipAnalyzeArmor', GREEN, BLUE);
      await s.query('update sys_user_armor set hid = 0 where sid = ?', [BLUE]);
      s.rng([40, 70, 31, 65, 100, 0]);
      await cmd('multipAnalyzeArmor', GREY_2, GREEN, LORD_BLUE, BLUE, PURPLE, MORIZHIREN);
      s.rng([66]);
      await cmd('multipAnalyzeArmor', TIE_PIECE);
      await cmd('multipAnalyzeArmor', UNKNOWN);
      s.stopRng();
      await list('loadUserArmor');
    },
  },
  {
    name: 'smithy 洗练 / 熔炼 / 装备升级 and the barn tames, strengthens and dresses mounts',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const LORD = 80213;
      const cmd = (func: string, ...args: unknown[]) => s.command(session, func, ...args);
      // Lists sorted by combine level only (or not at all) have no deterministic tie order.
      const list = async (from: number, func: string, ...args: unknown[]) => {
        await cmd(func, ...args);
        for (let i = from; i < from + 7; i++) s.unordered(4, i);
      };
      const combine = async (...args: unknown[]) => {
        await cmd('combineArmor', ...args);
        for (let i = 2; i < 9; i++) s.unordered(4, i);
      };
      const upgrade = async (...args: unknown[]) => {
        await cmd('doUpgradeArmor', ...args);
        for (let i = 0; i < 7; i++) s.unordered(4, 4, i);
      };
      const give = async (gid: number, count: number) => {
        await s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
           on duplicate key update count = ?`,
          [uid, gid, count, count],
        );
      };
      const XILIAN = 900701;
      const F = [900711, 900712, 900713, 900714, 900715, 900716];
      const F_HIGH = [900721, 900722, 900723];
      const F_MAX = [900724, 900725, 900726];
      const F_LEVEL1 = 900727;
      const F_OTHER = 900728;
      const MINGJIANG = [900731, 900732, 900733];
      const SHENWU = 900734;
      const LONGYUAN = 900735;
      const WORN = 900736;
      const HORSE = 900741;
      const HORSE_BLUE = 900742;
      const pieces: [
        sid: number,
        armorid: number,
        holes: string,
        level: number,
        combine: number,
      ][] = [
        [XILIAN, 53001, '0,0,0,0,3', 0, 0],
        ...F.map((sid): [number, number, string, number, number] => [sid, 10103, '', 0, 0]),
        ...F_HIGH.map((sid): [number, number, string, number, number] => [sid, 10103, '', 0, 3]),
        ...F_MAX.map((sid): [number, number, string, number, number] => [sid, 10103, '', 0, 7]),
        [F_LEVEL1, 10103, '', 0, 1],
        [F_OTHER, 10191, '', 0, 0],
        ...MINGJIANG.map((sid): [number, number, string, number, number] => [sid, 10191, '', 0, 0]),
        [SHENWU, 12001, '', 0, 0],
        [LONGYUAN, 53029, '', 0, 0],
        [WORN, 10191, '', 0, 0],
        [HORSE, 12011, '', 0, 0],
        [HORSE_BLUE, 10098, '0,0,0,0,0', 10, 0],
      ];
      for (const [sid, armorid, holes, level, combine] of pieces) {
        await s.query(
          `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, strong_level,
             strong_value, embed_holes, embed_pearls, combine_level)
           values (?, ?, ?, 1000, 100, 0, ?, 0, ?, '0,0,0,0,0', ?)`,
          [sid, uid, armorid, level, holes, combine],
        );
      }
      await s.query('update sys_user_armor set hid = ? where sid = ?', [LORD, WORN]);

      // 洗练: 祝融之符 adds a 极品 attribute, 清洗符 wipes it, 洗练符 re-rolls it.
      for (const index of [0, 1, 2, 3]) await cmd('loadXilianGoods', index);
      await cmd('doXilian', 0, 12079);
      await cmd('doXilian', 1, 12079, XILIAN);
      await cmd('doXilian', 0, 12079, 999999);
      await cmd('doXilian', 0, 12079, XILIAN);
      await give(12079, 2);
      await give(12080, 1);
      await give(12081, 1);
      await cmd('doXilian', 1, 12080, XILIAN);
      s.rng([0, 4, 1, 1]);
      await cmd('doXilian', 0, 12079, XILIAN);
      await cmd('doXilian', 0, 12079, XILIAN);
      await cmd('doXilian', 2, 12081, XILIAN);
      await give(12081, 5);
      s.rng([0, 9, 2, 1]);
      await cmd('doXilian', 2, 12081, XILIAN);
      s.stopRng();
      await cmd('doXilian', 1, 12080, XILIAN);
      await cmd('doXilian', 1, 12080, XILIAN);

      // 熔炼 lists: groups by (piece, level), and part / set filters minus the chosen slots.
      await cmd('loadFusionableArmor', 1);
      await list(2, 'loadPartArmor', 1, 0);
      await list(2, 'loadPartArmor', 1, 6);
      await list(2, 'loadPartArmor', 1, 10);
      await cmd('loadPartArmor', 1, 99);
      await list(2, 'reloadArmor', [F[0], F[1]], 1, 6);

      // 熔炼 checks the parameters, the pieces, their levels and the stones.
      await combine(F[0], 1, F[1], F[2]);
      await combine(F[0], 0, F[1], F[2], 0);
      await combine(F[0], 1, 0, F[2], 0);
      await combine(F[0], 1, F[1], F[2], 2);
      await combine(F[0], 1, F[0], F[2], 0);
      await combine(999999, 1, F[1], F[2], 0);
      await combine(HORSE, 1, F[1], F[2], 0);
      await combine(F[0], 1, F_OTHER, F[2], 0);
      await s.query(
        'insert into sys_hero_armor (hid, spart, sid, armorid) values (?, 999, ?, 10103)',
        [LORD, F[1]],
      );
      await combine(F[0], 1, F[1], F[2], 0);
      await s.query('delete from sys_hero_armor where sid = ?', [F[1]]);
      await combine(F[0], 1, F[1], F_LEVEL1, 0);
      await combine(F_MAX[0], 1, F_MAX[1], F_MAX[2], 0);
      await combine(F[0], 1, F[1], F[2], 0);
      await combine(F_HIGH[0], 1, F_HIGH[1], F_HIGH[2], 0);
      await give(10776, 3);
      await give(10777, 1);
      await combine(F[0], 1, F[1], F[2], 1);

      // Success raises the main piece; failure keeps all with the 保护符, loses all without.
      await give(10778, 1);
      s.rng([9999]);
      await combine(F[0], 1, F[1], F[2], 1);
      s.rng([0]);
      await combine(F[0], 1, F[1], F[2], 0);
      s.rng([9999]);
      await combine(F[3], 1, F[4], F[5], 0);
      s.rng([0]);
      await combine(F_HIGH[0], 1, F_HIGH[1], F_HIGH[2], 0);
      s.stopRng();
      await cmd('loadFusionableArmor', 1);

      // 装备升级: 名将 -> 冰封 -> 冰魂, 神武 -> 神龙; failures lose the piece unless protected.
      await upgrade(0, false);
      await upgrade(999999, false);
      await upgrade(WORN, false);
      await upgrade(F[0], false);
      await upgrade(MINGJIANG[0], false);
      await give(12158, 10);
      await give(12159, 3);
      await give(12160, 1);
      await give(12161, 3);
      await upgrade(MINGJIANG[0], true);
      await give(12157, 1);
      s.rng([29]);
      await upgrade(MINGJIANG[0], false);
      s.rng([0]);
      await upgrade(MINGJIANG[0], false);
      s.rng([50, 10]);
      await upgrade(MINGJIANG[1], false);
      s.rng([50, 50]);
      await upgrade(MINGJIANG[2], false);
      s.rng([99]);
      await upgrade(SHENWU, true);
      s.rng([0]);
      await upgrade(SHENWU, false);
      s.rng([0]);
      await upgrade(LONGYUAN, false);
      s.stopRng();

      // Unactivated gear and mounts; taming costs 黄金 and logs its own action.
      await list(0, 'loadUnActivePartArmor', 1, 0);
      await list(0, 'loadUnActivePartArmor', 1, 4);
      await list(0, 'loadUnActivePartArmor', 12, 0);
      await list(0, 'loadUnActiveHorseArmor');
      await s.query('update mem_city_resource set gold = 10000000 where cid = ?', [cid]);
      await cmd('initHoles', cid, HORSE);
      await cmd('initHoles', cid, HORSE);
      await upgrade(HORSE, false);

      // The barn strengthens with 灵通甘草 under 驯马技巧; mounts past 10 have their own odds.
      await cmd('doStrong', cid, 212, 0, 213, 0, HORSE, 0);
      await cmd('doStrong', cid, 212, 0, 213, 0, XILIAN, 1);
      await cmd('doStrong', cid, 212, 0, 213, 0, 999999, 1);
      await cmd('doStrong', cid, 212, 0, 213, 0, HORSE, 1);
      await give(214, 5);
      await cmd('doStrong', cid, 212, 1, 213, 0, HORSE, 1);
      await cmd('doStrong', cid, 212, 0, 213, 0, HORSE, 1);
      await s.query(
        `insert into sys_city_technic (cid, tid, level) values (?, 22, 10)
         on duplicate key update level = 10`,
        [cid],
      );
      await give(212, 1);
      await give(213, 1);
      s.rng([0, 50]);
      await cmd('doStrong', cid, 212, 1, 213, 0, HORSE, 1);
      s.rng([9999, 50]);
      await cmd('doStrong', cid, 212, 0, 213, 1, HORSE, 1);
      await cmd('doStrong', cid, 212, 0, 213, 0, HORSE_BLUE, 1);
      await give(11171, 2);
      s.rng([499, 0, 0, 0, 0]);
      await cmd('doStrong', cid, 212, 0, 213, 0, HORSE_BLUE, 1);
      s.rng([500, 0]);
      await cmd('doStrong', cid, 212, 0, 213, 0, HORSE_BLUE, 1);
      s.stopRng();

      // 马装 go in their own hole, need the mount's level, and some fit one mount only.
      await give(402, 1);
      await give(409, 1);
      await give(442, 0);
      await cmd('doEmbed', HORSE, 1, 402, 1);
      await cmd('doEmbed', HORSE, 1, 422, 1);
      await cmd('doEmbed', HORSE, 0, 409, 1);
      await cmd('doEmbed', HORSE, 2, 442, 1);
      await cmd('doEmbed', HORSE, 0, 402, 0);
      await cmd('doEmbed', HORSE, 0, 402, 1);
      await cmd('loadZuojiArmor', 1, 12011);
    },
  },
  {
    name: 'hero skills are learnt, books worn and taken off, the shelf grows and books sell',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // Book lists come without ORDER BY: MyISAM reuses the slots of deleted rows.
      const BOOK_LISTS: Record<string, number[]> = {
        loadUserValidSkillBook: [4, 1],
        loadUserSkillBook: [4, 0],
      };
      const cmd = async (func: string, ...args: unknown[]) => {
        await s.command(session, func, ...args);
        const at = BOOK_LISTS[func];
        if (at) s.unordered(...at);
      };
      const LORD = 80213;
      const HERO = 90002;
      // 运筹帷幄 (skill 4) at levels 1 and 2, 安居乐业 (9, production) and 骁勇善战 (5).
      const [COMMAND_1, COMMAND_2, HARVEST_1, BRAVERY_3] = [900101, 900102, 900103, 900104];

      await s.query('delete from sys_user_book where uid = ?', [uid]);
      await s.query('delete from sys_hero_skill where hid in (?, ?)', [LORD, HERO]);
      await s.query('delete from sys_user_bookshelfnum where uid = ?', [uid]);
      await s.query('delete from sys_goods where uid = ? and gid = 10668', [uid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, npcid, sex, face, cid, state, level, exp,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (?, ?, '丙丁', 0, 1, 10, ?, 0, 30, 0, 20, 40, 60, 50, 60, 0)`,
        [HERO, uid, cid],
      );
      await s.query(
        `insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
        values (?, 100, 120, 100, 120)`,
        [HERO],
      );
      for (const [id, bid, level] of [
        [COMMAND_1, 4, 1],
        [COMMAND_2, 4, 2],
        [HARVEST_1, 9, 1],
        [BRAVERY_3, 5, 3],
      ]) {
        await s.query(
          'insert into sys_user_book (id, bid, uid, hid, level) values (?, ?, ?, 0, ?)',
          [id, bid, uid, level],
        );
      }

      await cmd('loadUserValidSkillBook');
      await cmd('getHeroSkill', LORD);
      await cmd('resetHeroSkill', cid, LORD);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 10668, 3)', [uid]);
      await cmd('resetHeroSkill', cid, 999999);
      await s.query('update sys_city_hero set state = 1 where hid = ?', [HERO]);
      await cmd('resetHeroSkill', cid, HERO);
      await s.query('update sys_city_hero set state = 0 where hid = ?', [HERO]);

      // The new skill is random: only one row of cfg_skill_rate keeps a weight.
      const rates = await s.query<{ skill_id: number; rate: number }>(
        'select skill_id, rate from cfg_skill_rate',
      );
      const pin = (skill: number) =>
        s.query('update cfg_skill_rate set rate = if(skill_id = ?, 100, 0)', [skill]);
      try {
        await pin(4);
        await cmd('resetHeroSkill', cid, LORD);
        await cmd('getHeroSkill', LORD);
        await cmd('loadUserSkillBook', 4);
        await cmd('setHeroBook', LORD, HARVEST_1, cid);
        await cmd('setHeroBook', LORD, 999999, cid);
        await cmd('setHeroBook', LORD, COMMAND_1, cid);
        await cmd('getHeroSkill', LORD);
        await cmd('setHeroBook', LORD, COMMAND_2, cid);
        await cmd('resetHeroSkill', cid, LORD);
        await cmd('loadUserSkillBook', 4);

        await pin(9);
        await cmd('resetHeroSkill', cid, HERO);
        await cmd('setHeroBook', HERO, COMMAND_1, cid);
        await cmd('setHeroBook', HERO, HARVEST_1, cid);
        await cmd('getHeroSkill', HERO);
        await s.query('update sys_city_hero set state = 1 where hid = ?', [HERO]);
        await cmd('moveHeroBook', HERO, HARVEST_1, cid);
        await s.query('update sys_city_hero set state = 0 where hid = ?', [HERO]);
        await cmd('moveHeroBook', HERO, HARVEST_1, cid);
        await cmd('moveHeroBook', HERO, HARVEST_1, cid);
        // The worn book of the same skill only has to exist: the one named is taken off.
        await cmd('moveHeroBook', LORD, COMMAND_2, cid);
        await cmd('moveHeroBook', LORD, COMMAND_1, cid);
        await cmd('getHeroSkill', LORD);
      } finally {
        for (const { skill_id, rate } of rates) {
          await s.query('update cfg_skill_rate set rate = ? where skill_id = ?', [rate, skill_id]);
        }
      }

      await cmd('AddSkillBookShelf');
      await cmd('AddSkillBookShelf');
      await s.query('update sys_user_bookshelfnum set num = 500 where uid = ?', [uid]);
      await cmd('AddSkillBookShelf');
      const [user] = await s.query<{ money: number }>('select money from sys_user where uid = ?', [
        uid,
      ]);
      await s.query('update sys_user set money = 49 where uid = ?', [uid]);
      await cmd('AddSkillBookShelf');
      await s.query('update sys_user set money = ? where uid = ?', [user?.money, uid]);
      await cmd('loadUserValidSkillBook');

      await cmd('sellBook', cid, BRAVERY_3);
      await cmd('sellBook', cid, BRAVERY_3);
      await cmd('sellBook', FOREIGN_CITY, HARVEST_1);
      await s.query('update sys_user_book set hid = ? where id = ?', [LORD, HARVEST_1]);
      await cmd('sellBook', cid, HARVEST_1);
      await s.query('update sys_user_book set hid = 0 where id = ?', [HARVEST_1]);
    },
  },
  {
    name: 'shop lists its wares and item tooltips',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // A controlled wares table: the shipped cfg_shop rows carry 赤壁 / 孟获 items whose grants
      // are not ported, so replace the live list with two plain items for a stable compare.
      await s.query('delete from cfg_shop');
      await s.query(
        `insert into cfg_shop (id, gid, name, description, price, pack, commend, onsale,
            starttime, endtime, totalCount, position)
          values (900001, 85, '测试金条', '测试', 100, 1, 2, 1, 0, 2000000000, 2000000000, 1),
            (900002, 86, '测试金砖', '测试', 50, 1, 0, 1, 0, 2000000000, 2000000000, 2)`,
      );
      await s.command(session, 'getShopInfo');
      // The 元宝/礼金 lists carry `order by position, id`; the two 五铢钱 copper lists
      // (copperList + copperThings) have none, so MyISAM and InnoDB return them in different
      // orders — compare them as sets.
      s.unordered(4, 4);
      s.unordered(4, 5);
      // Config lookups for a shop hero (cfg_hero id 1) and gear (cfg_armor id 1), and misses.
      await s.command(session, 'getGoodsHeroAttr', 1);
      await s.command(session, 'getGoodsHeroAttr', 99999999);
      await s.command(session, 'getGoodsArmorAttr', 1);
      await s.command(session, 'getGoodsArmorAttr', 99999999);
      await s.command(session, 'showDlg', 85);
      await s.command(session, 'showDlg', 99999999);
    },
  },
  {
    name: 'shop buys goods for 元宝 and 礼金',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('delete from cfg_shop');
      // 900001 both-pay normal item (pack 2), 900002 元宝-only recommended, 900003 特价 (no 礼金).
      await s.query(
        `insert into cfg_shop (id, gid, name, description, price, pack, commend, onsale,
            starttime, endtime, totalCount, position, rebate)
          values (900001, 85, '测试金条', '测试', 100, 2, 2, 1, 0, 2000000000, 2000000000, 1, 0),
            (900002, 86, '测试金砖', '测试', 50, 1, 1, 1, 0, 2000000000, 2000000000, 2, 0),
            (900003, 87, '测试辎重', '测试', 10, 1, 0, 1, 0, 2000000000, 2000000000, 3, 1)`,
      );
      await s.query('delete from sys_goods where uid = ? and gid in (85, 86, 87)', [uid]);
      // The login hands out one of two daily boxes (50186 / 50187) at random; drop them so
      // loadUserGoods compares the purchased goods, not the random pick.
      await s.query('delete from sys_goods where uid = ? and gid in (50186, 50187)', [uid]);
      const [user] = await s.query<{ money: number; gift: number }>(
        'select money, gift from sys_user where uid = ?',
        [uid],
      );
      await s.query('update sys_user set money = 1000, gift = 500 where uid = ?', [uid]);
      // The shipped DB has running 商城活动 (累计充值) whose gift count depends on the exact
      // log_shop timestamps; in difftest both servers log within the same second, so the
      // cumulative boundary is ambiguous. Park the events so the compare is the purchase itself.
      const actRows = await s.query<{ actid: string; endtime: string }>(
        `select actid, endtime from cfg_act where type in (5001, 5002, 5101, 5201, 5010)
          and starttime <= unix_timestamp() and endtime >= unix_timestamp()`,
      );
      await s.query(
        `update cfg_act set endtime = 0 where type in (5001, 5002, 5101, 5201, 5010)
          and starttime <= unix_timestamp() and endtime >= unix_timestamp()`,
      );
      try {
        // Validation: bad pay type, bad amount, unknown / unsold item.
        await s.command(session, 'buyGoods', 900001, 1, 2);
        await s.command(session, 'buyGoods', 900001, 0, 0);
        await s.command(session, 'buyGoods', 99999999, 1, 0);
        // 元宝 purchase of a pack of two, then a 礼金 purchase.
        await s.command(session, 'buyGoods', 900001, 2, 0);
        await s.command(session, 'buyGoods', 900002, 1, 1);
        // 礼金 for a 元宝-only recommended item: balance already matches, but it is allowed.
        await s.command(session, 'buyGoods', 900002, 1, 0);
        // 特价 cannot be bought with 礼金.
        await s.command(session, 'buyGoods', 900003, 1, 1);
        await s.command(session, 'buyGoods', 900003, 1, 0);
        // Not enough 元宝 / 礼金.
        await s.query('update sys_user set money = 5, gift = 5 where uid = ?', [uid]);
        await s.command(session, 'buyGoods', 900001, 1, 0);
        await s.command(session, 'buyGoods', 900002, 1, 1);
        await s.command(session, 'loadUserGoods');
      } finally {
        await s.query('update sys_user set money = ?, gift = ? where uid = ?', [
          user?.money,
          user?.gift,
          uid,
        ]);
        for (const act of actRows) {
          await s.query('update cfg_act set endtime = ? where actid = ?', [act.endtime, act.actid]);
        }
      }
    },
  },
  {
    name: 'shop enforces the per-player buy limit',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('delete from cfg_shop');
      await s.query('delete from log_shop where uid = ?', [uid]);
      await s.query('delete from log_shop_buy_cnt where uid = ?', [uid]);
      // Capped at two per player.
      await s.query(
        `insert into cfg_shop (id, gid, name, description, price, pack, commend, onsale,
            starttime, endtime, totalCount, position, userbuycnt)
          values (900010, 85, '限购金条', '测试', 10, 1, 0, 1, 0, 2000000000, 2000000000, 1, 2)`,
      );
      await s.query('delete from sys_goods where uid = ? and gid = 85', [uid]);
      const [user] = await s.query<{ money: number }>('select money from sys_user where uid = ?', [
        uid,
      ]);
      await s.query('update sys_user set money = 1000 where uid = ?', [uid]);
      try {
        await s.command(session, 'buyGoods', 900010, 1, 0);
        await s.command(session, 'buyGoods', 900010, 1, 0);
        // The third purchase is over the per-player cap.
        await s.command(session, 'buyGoods', 900010, 1, 0);
      } finally {
        await s.query('update sys_user set money = ? where uid = ?', [user?.money, uid]);
        await s.query('delete from log_shop where uid = ?', [uid]);
        await s.query('delete from log_shop_buy_cnt where uid = ?', [uid]);
      }
    },
  },
  {
    name: 'shop buy-and-use delivers the item to use',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('delete from cfg_shop');
      await s.query(
        `insert into cfg_shop (id, gid, name, description, price, pack, commend, onsale,
            starttime, endtime, totalCount, position)
          values (900020, 85, '即用金条', '测试', 100, 1, 2, 1, 0, 2000000000, 2000000000, 1)`,
      );
      await s.query('delete from sys_goods where uid = ? and gid = 85', [uid]);
      const [user] = await s.query<{ money: number; gift: number }>(
        'select money, gift from sys_user where uid = ?',
        [uid],
      );
      await s.query('update sys_user set money = 1000, gift = 500 where uid = ?', [uid]);
      try {
        await s.command(session, 'buyGoodsBeforeUse', 900020, 1, 2);
        await s.command(session, 'buyGoodsBeforeUse', 900020, 0, 0);
        await s.command(session, 'buyGoodsBeforeUse', 99999999, 1, 0);
        await s.command(session, 'buyGoodsBeforeUse', 900020, 1, 0);
        await s.command(session, 'buyGoodsBeforeUse', 900020, 1, 1);
        await s.query('update sys_user set money = 5, gift = 5 where uid = ?', [uid]);
        await s.command(session, 'buyGoodsBeforeUse', 900020, 1, 0);
        // doLogin hands out one of two daily boxes (50186 / 50187) at random; drop them so
        // loadUserGoods compares the bought 金条, not the random pick (mirrors the other shop cases).
        await s.query('delete from sys_goods where uid = ? and gid in (50186, 50187)', [uid]);
        await s.command(session, 'loadUserGoods');
      } finally {
        await s.query('update sys_user set money = ?, gift = ? where uid = ?', [
          user?.money,
          user?.gift,
          uid,
        ]);
      }
    },
  },
  {
    name: 'shop redeems a 礼券 code',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('delete from sys_ticket where id in (900030, 900031, 900032)');
      await s.query('delete from sys_ticket_content where id = 900030');
      // Content parsed by parseAndAddReward: one reward, type 0 goods, gid 85, count 3.
      await s.query(
        `insert into sys_ticket_content (id, name, content) values (900030, '测试礼券', '1,0,85,3')`,
      );
      await s.query(
        `insert into sys_ticket (id, code, contentid, binduid, uid) values
          (900030, 'ABCDEFGHIJ', 900030, 0, 0),
          (900031, 'USEDCODE12', 900030, 0, 999999),
          (900032, 'BINDCODE34', 900030, 123456, 0)`,
      );
      await s.query('delete from sys_goods where uid = ? and gid = 85', [uid]);
      // The login hands out one of two daily boxes (50186 / 50187) at random; drop them so
      // loadUserGoods compares the redeemed goods, not the random pick.
      await s.query('delete from sys_goods where uid = ? and gid in (50186, 50187)', [uid]);
      try {
        // Empty, malformed, unknown, used, bound, then a valid redemption.
        await s.command(session, 'exchangeLiquan', '');
        await s.command(session, 'exchangeLiquan', 'short');
        await s.command(session, 'exchangeLiquan', 'ZZZZZZZZZZ');
        await s.command(session, 'exchangeLiquan', 'USEDCODE12');
        await s.command(session, 'exchangeLiquan', 'BINDCODE34');
        await s.command(session, 'exchangeLiquan', 'ABCDEFGHIJ');
        // Redeeming it again now fails as used.
        await s.command(session, 'exchangeLiquan', 'ABCDEFGHIJ');
        await s.command(session, 'loadUserGoods');
      } finally {
        await s.query('delete from sys_ticket where id in (900030, 900031, 900032)');
        await s.query('delete from sys_ticket_content where id = 900030');
      }
    },
  },
  {
    name: 'blacksmith strengthens a piece, each outcome forced through its config',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const ARMOR = 900001;
      // A purple (type 5) piece has no colour cap, so only 打造技巧 (tid 21) bounds it.
      const reset = async (level: number) => {
        await s.query(
          `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, strong_level,
             strong_value, embed_pearls, embed_holes, strong_times, combine_level)
           values (?, ?, 53047, 2550, 255, 0, ?, 0, '', '', 0, 7)
           on duplicate key update strong_level = ?, strong_value = 0, strong_times = 0,
             best_quality = null`,
          [ARMOR, uid, level, level],
        );
      };
      const giveAids = async () => {
        for (const [gid, n] of [
          [203, 9],
          [204, 9],
          [205, 9],
          [11170, 9],
        ]) {
          await s.query(
            'insert into sys_goods (uid, gid, count) values (?, ?, ?) on duplicate key update count = ?',
            [uid, gid, n, n],
          );
        }
      };
      await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      await s.query(
        'insert into sys_city_technic (cid, tid, level) values (?, 21, 15) on duplicate key update level = 15',
        [cid],
      );
      await giveAids();
      // 强化成功时有极品洗练随机，关掉它(xilian_rate=0)让结果确定。
      await s.query('update cfg_strong_probability set xilian_rate = 0');
      try {
        // forced success
        await s.query('update cfg_strong_probability set suc_value = 100 where level = 1');
        await reset(0);
        await s.command(session, 'doStrong', cid, 203, 1, 204, 0, ARMOR);

        // forced failure -> 归零 (zero_value 100)
        await s.query(
          'update cfg_strong_probability set suc_value = 0, zero_value = 100, degrade_value = 0, intact_value = 0 where level = 5',
        );
        await reset(4);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 0, ARMOR);

        // forced failure -> 降级 (degrade_value 100)
        await s.query(
          'update cfg_strong_probability set suc_value = 0, zero_value = 0, degrade_value = 100, intact_value = 0 where level = 5',
        );
        await reset(4);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 0, ARMOR);

        // forced failure -> 无损失 (intact_value 100)
        await s.query(
          'update cfg_strong_probability set suc_value = 0, zero_value = 0, degrade_value = 0, intact_value = 100 where level = 5',
        );
        await reset(4);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 0, ARMOR);

        // 乾坤宝珠 bought: never drops on failure
        await reset(4);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 1, ARMOR);

        // error branches: wrong item, missing piece, maxed, strong pearl missing
        await s.command(session, 'doStrong', cid, 999, 0, 204, 0, ARMOR);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 0, 999999);
        await reset(15);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 0, ARMOR);
        await reset(2);
        await s.query('update sys_goods set count = 0 where uid = ? and gid = 205', [uid]);
        await s.command(session, 'doStrong', cid, 203, 0, 204, 0, ARMOR);
      } finally {
        await s.query(
          'update cfg_strong_probability set suc_value = elt(level, 70,70,60,45,45,30,20,15,10,5,10,10,5,3,1), zero_value = 0, degrade_value = elt(level, 0,0,0,50,50,50,100,100,100,100,100,100,100,100,100), intact_value = elt(level, 100,100,100,50,50,50,0,0,0,0,0,0,0,0,0), xilian_rate = elt(level, 1,2,3,4,5,6,7,8,9,100,100,100,100,100,100)',
        );
        await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      }
    },
  },
  {
    name: 'blacksmith embeds pearls, opens holes and reports errors',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const ARMOR = 900002;
      await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      // strong_level 9 so a mid pearl passes embedLimit; holes: open, locked(初), no-hole, open, open.
      await s.query(
        `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, strong_level,
           strong_value, embed_pearls, embed_holes, combine_level)
         values (?, ?, 53047, 2550, 255, 0, 9, 21, '0,0,0,0,0', '0,1,3,0,0', 7)`,
        [ARMOR, uid],
      );
      for (const [gid, n] of [
        [305, 5],
        [206, 5],
        [201, 10],
      ]) {
        await s.query(
          'insert into sys_goods (uid, gid, count) values (?, ?, ?) on duplicate key update count = ?',
          [uid, gid, n, n],
        );
      }
      try {
        await s.command(session, 'onLoadDaKong', 1);
        await s.command(session, 'loadEmbedPearl', 0);
        await s.command(session, 'loadEmbedPearlByArmor', '0,0,0,0,0');
        // embed a 6级统率 pearl (305) in hole 0
        await s.command(session, 'doEmbed', ARMOR, 0, 305);
        // open the locked hole 1 with a 初级打孔器 (206)
        await s.command(session, 'openHole', ARMOR, 206, 1);
        // clear the pearl in hole 0 with 化石粉 (201), keeping the pearl (useType 1, 8 needed)
        await s.command(session, 'openHole', ARMOR, 201, 0, 1, 8);
        // errors: missing piece, taken hole, missing pearl
        await s.command(session, 'doEmbed', 999999, 0, 305);
        await s.query("update sys_user_armor set embed_pearls = '305,0,0,0,0' where sid = ?", [
          ARMOR,
        ]);
        await s.command(session, 'doEmbed', ARMOR, 0, 305);
        await s.query('update sys_goods set count = 0 where uid = ? and gid = 305', [uid]);
        await s.query("update sys_user_armor set embed_pearls = '0,0,0,0,0' where sid = ?", [
          ARMOR,
        ]);
        await s.command(session, 'doEmbed', ARMOR, 0, 305);
      } finally {
        await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      }
    },
  },
  {
    name: 'blacksmith activates holes and synthesizes materials',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const ARMOR = 900003;
      await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      await s.query(
        `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, embed_holes, embed_pearls)
         values (?, ?, 53047, 2550, 255, 0, '', '')`,
        [ARMOR, uid],
      );
      await s.query('update mem_city_resource set gold = 100000000 where cid = ?', [cid]);
      // Make the piece's hole rule deterministic (no 打孔 probability roll).
      const type = Number(
        (await s.query<{ type: string }>('select type from cfg_armor where id = 53047'))[0]?.type ??
          7,
      );
      await s.query('update cfg_armor_hole_rule set rule = ? where type = ?', [
        '-1,-1,-1,N/A,N/A',
        type,
      ]);
      try {
        await s.command(session, 'initHoles', cid, ARMOR);
        await s.command(session, 'initHoles', cid, ARMOR); // already active
      } finally {
        await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
        await s.query('update cfg_armor_hole_rule set rule = ? where type = ?', [
          '49,10,-1,-1,-2',
          type,
        ]);
      }

      // 合成: 强化宝珠 (205) is deterministic (100%); give exactly the recipe (209,210,211 ×1).
      for (const gid of [209, 210, 211]) {
        await s.query(
          'insert into sys_goods (uid, gid, count) values (?, ?, 3) on duplicate key update count = 3',
          [uid, gid],
        );
      }
      await s.query('delete from sys_goods where uid = ? and gid = 205', [uid]);
      await s.command(session, 'loadStuff', 205);
      await s.command(session, 'synthStuff', cid, 205, 2, 0, 0);
      // errors: non-positive count, a level-1 pearl, missing materials
      await s.command(session, 'synthStuff', cid, 205, 0, 0, 0);
      await s.command(session, 'synthStuff', cid, 300, 1, 0, 0);
      await s.query('delete from sys_goods where uid = ? and gid in (209,210,211)', [uid]);
      await s.command(session, 'synthStuff', cid, 205, 1, 0, 0);
    },
  },
  {
    name: 'blacksmith merges skill books, both outcomes forced',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // cfg_book has no ORDER BY in loadSkillBook_OpenTab: MyISAM vs InnoDB row order.
      const skillTab = () => s.unordered(4, 0);
      // 运筹帷幄 (skill 4) three level-2 books -> one level-3.
      const seed = async () => {
        await s.query('delete from sys_user_book where uid = ? and bid = 4', [uid]);
        for (const id of [900201, 900202, 900203]) {
          await s.query(
            'insert into sys_user_book (id, bid, uid, hid, level) values (?, 4, ?, 0, 2)',
            [id, uid],
          );
        }
      };
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 10667, 9) on duplicate key update count = 9',
        [uid],
      );
      try {
        await s.command(session, 'loadSkillBook_OpenTab');
        skillTab();
        // forced success
        await s.query('update cfg_book_rate set rate = 100 where level = 3');
        await seed();
        await s.command(session, 'mergeBook', 4, 2, 0);
        s.unordered(4, 2, 0); // the merge reply carries the same tab list at result[2][0]
        // forced failure, no protect: materials lost. Not rate 0: both sides treat an empty
        // rate as 10%, so a 0 still succeeds one time in ten (legacy rand() is unseeded).
        await s.query('update cfg_book_rate set rate = -1 where level = 3');
        await seed();
        await s.command(session, 'mergeBook', 4, 2, 0);
        s.unordered(4, 2, 0);
        // forced failure, with protect: materials kept, 保护符 spent
        await seed();
        await s.command(session, 'mergeBook', 4, 2, 1);
        s.unordered(4, 2, 0);
        // error: level out of range
        await s.command(session, 'mergeBook', 4, 10, 0);
      } finally {
        await s.query(
          'update cfg_book_rate set rate = elt(level, 100,95,85,70,60,35,25,15,7,3) where level between 1 and 10',
        );
        await s.query('delete from sys_user_book where uid = ? and bid = 4', [uid]);
      }
    },
  },
  {
    name: 'hero consumables restore force, energy and experience',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const use = (type: number, gid: number, hid: number) =>
        s.command(session, 'useTypeGoods', type, gid, cid, hid);
      const LORD = 80213;
      const HERO = 900101;
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );
      // A free, undamaged NPC hero with room to spend 体力/精力/经验.
      await s.query(
        `insert into sys_city_hero (hid, uid, name, npcid, sex, face, cid, state, level, exp,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (?, ?, '丙丁', 0, 1, 10, ?, 0, 30, 100, 20, 40, 60, 60, 60, 0)`,
        [HERO, uid, cid],
      );
      await s.query(
        `insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
        values (?, 10, 120, 10, 120)`,
        [HERO],
      );

      // 体力药 (type 2): not owned, then a 30% (gid 75) and a full (gid 77) restore.
      await use(2, 75, HERO);
      await give(75, 1);
      await give(77, 1);
      await use(2, 75, HERO);
      await use(2, 77, HERO);
      // Refuses a 重伤 hero.
      await s.query('update sys_city_hero set hero_health = 1 where hid = ?', [HERO]);
      await use(2, 77, HERO);
      await s.query('update sys_city_hero set hero_health = 0 where hid = ?', [HERO]);

      // 精力药 (type 3): 60% (gid 80) then full (gid 81).
      await give(80, 1);
      await give(81, 1);
      await use(3, 80, HERO);
      await use(3, 81, HERO);

      // 护命金丹 (type 49, gid 151): full force even for a 重伤 hero.
      await s.query('update mem_hero_blood set `force` = 0 where hid = ?', [HERO]);
      await s.query('update sys_city_hero set hero_health = 1 where hid = ?', [HERO]);
      await use(49, 151, HERO);
      await give(151, 1);
      await use(49, 151, HERO);

      // 经验书 (type 11): up to ten copies at once; a lord hero and a capped hero are refused.
      await give(113, 3);
      await use(11, 113, HERO);
      await use(11, 114, HERO); // not owned
      await give(114, 12); // capped at ten used
      await use(11, 114, HERO);
      await give(115, 1);
      await use(11, 115, LORD); // 君主将不能使用
      await s.query('update sys_city_hero set level = 120 where hid = ?', [HERO]);
      await use(11, 115, HERO); // level cap
      await s.query('update sys_city_hero set level = 30 where hid = ?', [HERO]);
    },
  },
  {
    name: 'captives are summoned or freed, defectors accepted or turned away',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hero = (func: string, ...args: unknown[]) => s.command(session, func, cid, ...args);
      const CAPTIVE = 900201;
      const DEFECTOR = 900202;
      const NPC = 900203;
      // A low-level captive (needs no jewels), a defector, and a famous captive with a biography.
      await s.query(
        `insert into sys_city_hero (hid, uid, name, npcid, sex, face, cid, state, level, exp,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (?, ?, '俘甲', 0, 1, 10, ?, 5, 8, 0, 20, 40, 60, 60, 20, 0),
          (?, ?, '投乙', 0, 1, 10, ?, 6, 8, 0, 20, 40, 60, 60, 20, 0),
          (?, ?, '名丙', 36, 1, 10, ?, 5, 10, 0, 20, 40, 60, 60, 20, 0)`,
        [CAPTIVE, uid, cid, DEFECTOR, uid, cid, NPC, uid, cid],
      );
      for (const hid of [CAPTIVE, NPC]) {
        await s.query(
          'insert into sys_hero_captive (hid, uid, captivetime) values (?, ?, unix_timestamp())',
          [hid, uid],
        );
      }
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);
      await s.query('update sys_user set nobility = 19 where uid = ?', [uid]);

      // 说明: a famous hero has one, an ordinary hero does not.
      await hero('getNpcIntroduce', NPC);
      await hero('getNpcIntroduce', CAPTIVE);

      // 招降 a captive: the need prompt, then recruit (loyalty 50, state 0).
      await hero('trySummonHero', CAPTIVE);
      await hero('sureSummonHero', CAPTIVE);
      await hero('sureSummonHero', CAPTIVE); // already recruited

      // 释放 a captive back to the wilds (random tile, so compare the deletes only).
      await hero('releaseHero', DEFECTOR); // not a captive
      await hero('releaseHero', CAPTIVE); // already free now
      await s.query('update sys_city_hero set state = 5 where hid = ?', [NPC]);
      await hero('releaseHero', NPC);

      // 接纳 a defector (loyalty 80) and 回绝 another.
      await hero('tryAcceptHero', DEFECTOR);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, npcid, sex, face, cid, state, level, exp,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
        values (900204, ?, '投丁', 0, 1, 10, ?, 6, 8, 0, 20, 40, 60, 60, 20, 0)`,
        [uid, cid],
      );
      await hero('sureAcceptHero', DEFECTOR);
      await hero('rejectHero', 900204);
      await hero('rejectHero', CAPTIVE); // not a defector

      // releaseHero / rejectHero throw the hero onto a random empty tile (throwHeroToField's
      // `order by rand()`); pin the landing cid so the freed rows compare on state/uid, not luck.
      await s.query('update sys_city_hero set cid = 999000 where hid in (?, ?)', [NPC, 900204]);
    },
  },
  {
    name: 'office appoints city chiefs and rejects a busy replacement',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const lord = 80213;
      const hid = 900201;
      await s.query('delete from sys_troops where hid in (?, ?)', [lord, hid]);
      await s.query(
        'update sys_city set chiefhid = 0, generalid = 0, counsellorid = 0 where cid = ?',
        [cid],
      );
      await s.query('update sys_city_hero set state = 0 where uid = ? and cid = ?', [
        session.uid,
        cid,
      ]);
      await s.query('delete from sys_city_hero where hid = ?', [hid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, cid, name, sex, face, state, level,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, ?, '新任城守', 0, 0, 0, 20, 50, 60, 60, 60, 0, 0)`,
        [hid, session.uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      const office = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 11, 34, func, ...args);
      await office('setCityChief', [hid, 1], [lord, 7], [hid, 8]);
      await s.query(
        `insert into sys_troops (id, uid, cid, hid, targetcid, task, state, starttime, pathtime,
          endtime, soldiers, resource) values (900202, ?, ?, ?, ?, 1, 4, unix_timestamp(), 600,
          unix_timestamp() + 600, '1,1,20', '0')`,
        [session.uid, cid, hid, cid],
      );
      await office('setCityChief', [0, 1]);
      await s.query('delete from sys_troops where id = 900202');
      await office('setCityChief', [0, 1]);
      await s.query('delete from sys_city_hero where hid = ?', [hid]);
    },
  },
  {
    name: 'office recalls an exiled hero with position and gold checks',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900202;
      await s.query('delete from mem_hero_exile where hid = ?', [hid]);
      await s.query('delete from sys_city_hero where hid = ?', [hid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, cid, name, sex, face, state, level,
          command_base, affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, 895, 0, '流亡旧部', 0, 0, 0, 20, 50, 60, 60, 60, 0, 0)`,
        [hid],
      );
      await s.query('insert into mem_hero_exile (hid, uid, loyalty) values (?, ?, 50)', [hid, uid]);
      await s.command(session, 'getExileHeros');
      await s.dialog(session, cid, 11, 34, 'tryCallbackHero', cid, hid);
      await s.dialog(session, cid, 11, 34, 'sureCallbackHero', cid, hid);
      await s.query('delete from sys_city_hero where hid = ?', [hid]);
    },
  },
  {
    // 将领历练 (HeroFunc.php + HeroExpr.php). The Office dialog (Define.ID_BUILDING_OFFICE = 11)
    // lists expr-eligible heroes, starts/cancels/speeds an expr; the settlement frees the hero.
    name: 'hero expr: list, start, cancel and speed',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const [u] = await s.query<{ lastcid: string }>('select lastcid from sys_user where uid = ?', [
        uid,
      ]);
      const cid = Number(u?.lastcid ?? 0);
      const OFFICE = 11; // Define.ID_BUILDING_OFFICE
      const dlg = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, OFFICE, 0, func, ...args);

      // A spare idle hero (900101) and plenty of city gold / 元宝 to afford the expr.
      await s.query(
        `insert into sys_city_hero (hid, uid, cid, name, state, level, loyalty, herotype,
            affairs_base, bravery_base, wisdom_base, command_base)
          values (900101, ?, ?, '历练甲', 0, 5, 80, 0, 30, 40, 50, 20)`,
        [uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (900101, 100, 100, 100, 100)',
        [],
      );
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);
      await s.query('update sys_user set money = 1000000 where uid = ?', [uid]);
      // 通关文书 (143) and 急召令 (144) for fasterHeroExpr.
      await s.query('insert into sys_goods (uid, gid, count) values (?, 143, 5), (?, 144, 5)', [
        uid,
        uid,
      ]);

      // Lists the expr types and the city's heroes.
      await dlg('getExprHeros');
      s.mask(7, 0, '*'); // [now, heros, types] — now is the clock
      s.unordered(7, 1); // hero list has no ORDER BY
      s.unordered(7, 2);

      // Error branches of beginExprHero.
      await dlg('beginExprHero', 900101, cid, 1, 0, 0); // hours < 1 -> waigua.invalid
      await dlg('beginExprHero', 900101, cid, 1, 999, 0); // outside the type band
      await dlg('beginExprHero', 80213, cid, 1, 2, 0); // the 君主将 cannot expr
      await s.query('update mem_city_resource set gold = 0 where cid = ?', [cid]);
      await dlg('beginExprHero', 900101, cid, 1, 2, 0); // not enough city gold
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);

      // Success: pays and queues the expr, hero -> state 10.
      await dlg('beginExprHero', 900101, cid, 1, 2, 10);
      s.mask(7, '*', 'starttime');
      s.mask(7, '*', 'endtime');

      // Speed it up with 通关文书 (state 0), then cancel and end it with 急召令.
      await dlg('fasterHeroExpr', 900101);
      await dlg('cancelHeroExpr', 900101);
      await dlg('fasterHeroExpr', 900101);

      // The settlement adds a random exp bonus (10 * mt_rand()%band); pin it so the hero row
      // compares on its deterministic fields (state freed, expr row cleared) rather than the roll.
      await s.query('update sys_city_hero set exp = 0 where hid = 900101', []);
    },
  },
  {
    // HeroExpr.php::ordinaryHeroExpr via the settlement loop: a cancelled expr (state 1) whose
    // time is up refunds the carried 元宝, adds a small exp bonus, deletes the row and frees the
    // hero. Random fields are not diffed; the deterministic side effects are asserted directly.
    name: 'hero expr settlement finishes a cancelled expr',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const [u] = await s.query<{ lastcid: string }>('select lastcid from sys_user where uid = ?', [
        uid,
      ]);
      const cid = Number(u?.lastcid ?? 0);
      await s.query(
        `insert into sys_city_hero (hid, uid, cid, name, state, level, loyalty, herotype,
            affairs_base, bravery_base, wisdom_base, command_base, exp)
          values (900102, ?, ?, '历练乙', 10, 5, 80, 0, 30, 40, 50, 20, 1000)`,
        [uid, cid],
      );
      await s.query(
        `insert into sys_hero_expr (uid, cid, hid, type, starttime, endtime, hours, carrymoney,
            accTimes, state)
          values (?, ?, 900102, 1, unix_timestamp() - 7200, unix_timestamp() - 1, 1, 50, 0, 1)`,
        [uid, cid],
      );
      await s.tick('HandleHeroHexprs');
      const [hero] = await s.query<{ state: string }>(
        'select state from sys_city_hero where hid = 900102',
        [],
      );
      if (Number(hero?.state) !== 0) throw new Error('expr hero was not freed');
      const left = await s.query('select id from sys_hero_expr where hid = 900102', []);
      if (left.length !== 0) throw new Error('expr row was not cleared');
      // The bonus is 10 * mt_rand()%band; pin the exp so the freed hero row compares on its
      // deterministic fields (state, carried-gold refund) rather than the random roll.
      await s.query('update sys_city_hero set exp = 1000 where hid = 900102', []);
    },
  },
  {
    name: 'goods with their own dialogs: 旌旗, 名帖/君主改名, 盟主令, 武器架, 打孔器/化石粉',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const give = (gid: number, count: number) =>
        s.query(
          `insert into sys_goods (uid, gid, count) values (?, ?, ?)
            on duplicate key update count = values(count)`,
          [uid, gid, count],
        );

      // --- 旌旗 (changeUserFlagchar, gid 39) ---
      await s.query('delete from sys_goods where uid = ? and gid = 39', [uid]);
      await s.command(session, 'changeUserFlagchar', '龙'); // no 旌旗 owned
      await give(39, 2);
      await s.command(session, 'changeUserFlagchar', ''); // empty
      await s.command(session, 'changeUserFlagchar', '旗号'); // more than one char
      await s.command(session, 'changeUserFlagchar', '龙'); // ok

      // --- 名帖 / 君主改名 (changeUserName, gid 84) ---
      await s.query('delete from sys_goods where uid = ? and gid = 84', [uid]);
      await s.command(session, 'changeUserName', '  '); // whitespace -> illegal
      await s.command(session, 'changeUserName', 'A.CN'); // punctuation -> rules
      await s.command(session, 'changeUserName', '一二三四五六七八九'); // too long
      await s.command(session, 'changeUserName', '新君主'); // no 名帖 owned
      await give(84, 1);
      await s.command(session, 'changeUserName', '新君主'); // ok (renames lord hero too)
      await give(84, 1);
      await s.command(session, 'changeUserName', EXISTING_PLAYER); // name taken by self

      // --- 盟主令 (useGoods, gid 15) ---
      await s.query('delete from sys_goods where uid = ? and gid = 15', [uid]);
      await s.query('update sys_user set union_id = 0 where uid = ?', [uid]);
      await give(15, 2);
      await s.command(session, 'useGoods', 15); // not in a union
      const UNION = 990001;
      await s.query('delete from sys_union where id = ?', [UNION]);
      await s.query(
        `insert into sys_union (id, name, creator, leader, announcement, intro, chieforder)
         values (?, '盟', ?, ?, '', '', 0)`,
        [UNION, uid, uid],
      );
      await s.query('update sys_user set union_id = ? where uid = ?', [UNION, uid]);
      await s.command(session, 'useGoods', 15); // ok -> chieforder = 1
      await s.command(session, 'useGoods', 15); // already used
      await s.query('update sys_user set union_id = 0 where uid = ?', [uid]);
      await s.query('delete from sys_union where id = ?', [UNION]);

      // --- 武器架 (useGoods gid 145/146, and useTypeGoods type 30) ---
      await s.query('delete from sys_goods where uid = ? and gid in (145, 146)', [uid]);
      await s.query('update sys_user set armor_column = 100 where uid = ?', [uid]);
      await s.command(session, 'useGoods', 145); // none owned
      await give(145, 1);
      await s.command(session, 'useGoods', 145); // +5 -> 105
      await give(146, 1);
      await s.command(session, 'useTypeGoods', 30, 146, cid); // +50 -> 155
      await s.query('update sys_user set armor_column = 500 where uid = ?', [uid]);
      await give(145, 1);
      await s.command(session, 'useGoods', 145); // already full
      await s.query('update sys_user set armor_column = 100 where uid = ?', [uid]);

      // --- 打孔器 / 化石粉 via useTypeGoods (routes to the smithy's openHole) ---
      const ARMOR = 900050;
      await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      await s.query(
        `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, strong_level,
           strong_value, embed_pearls, embed_holes, combine_level)
         values (?, ?, 53047, 2550, 255, 0, 9, 21, '305,0,0,0,0', '3,1,3,0,0', 7)`,
        [ARMOR, uid],
      );
      for (const [gid, n] of [
        [206, 5],
        [201, 10],
      ]) {
        await give(gid as number, n as number);
      }
      try {
        // type 24 (打孔器 206): open the locked hole 1 -> `[sid, gid, position, useType, count]`
        await s.command(session, 'useTypeGoods', 24, 206, cid, ARMOR, 1, 0, 0);
        // type 26 (化石粉 201): clear the pearl in hole 0, keeping it (useType 1, 8 needed)
        await s.command(session, 'useTypeGoods', 26, 201, cid, ARMOR, 0, 1, 8);
        // error: missing piece
        await s.command(session, 'useTypeGoods', 24, 206, cid, 999999, 1, 0, 0);
      } finally {
        await s.query('delete from sys_user_armor where sid = ?', [ARMOR]);
      }

      // --- 武魂 (type > 110000) and other world/battle items stay 此功能尚未开放 ---
      // 成长卷 (type 145) is ported (useAddUserHeroExpBook): the lord hero is at the level cap,
      // so both servers answer 将领等级达到上限.
      await s.command(session, 'useTypeGoods', 145, 10957, cid);
    },
  },
  {
    name: 'hotel 结交 befriends a famous hero and handles its error branches',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hotel = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 10, 42, func, ...args);

      // A famous NPC hero of a known level, and a rumour pointing at it.
      await s.query('delete from sys_lionize where uid = ?', [uid]);
      await s.query('delete from sys_city_hero where hid = 900500', []);
      await s.query(
        `insert into sys_city_hero (hid, uid, npcid, name, sex, face, cid, state, level, exp,
            affairs_base, bravery_base, wisdom_base, loyalty, herotype)
          values (900500, 900001, 500, '名将甲', 1, 1001, 1, 0, 20, 4500, 50, 60, 55, 70, 100)`,
        [],
      );
      await s.query('delete from sys_city_rumor where cid = ? and id = 900700', [cid]);
      await s.query(
        `insert into sys_city_rumor (id, cid, name, type, typeid, price)
          values (900700, ?, '名将甲', 0, 500, 100)`,
        [cid],
      );

      // tryLionizeHero resolves the fee (level * 500).
      await hotel('tryLionizeHero', 900700);

      // Too low a nobility first; then raise it and befriend.
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);
      await hotel('LionizeHero', 500);
      await s.query('update sys_user set nobility = 5 where uid = ?', [uid]);
      await s.query('delete from sys_lionize where uid = ?', [uid]);
      // Not enough gold.
      await s.query('update mem_city_resource set gold = 100 where cid = ?', [cid]);
      await hotel('LionizeHero', 500);
      // Succeeds (throws the success message).
      await s.query('update mem_city_resource set gold = 1000000 where cid = ?', [cid]);
      await hotel('LionizeHero', 500);
      // Already befriended.
      await hotel('LionizeHero', 500);
      // 断交 drops it.
      await hotel('onCancelFriend', 500);

      await s.query('delete from sys_lionize where uid = ?', [uid]);
      await s.query('delete from sys_city_hero where hid = 900500', []);
      await s.query('delete from sys_city_rumor where cid = ? and id = 900700', [cid]);
    },
  },
  {
    name: 'hotel 市井传闻 lists rumours, asks for detail and records a task',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hotel = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 10, 42, func, ...args);

      // Hold the refresh clock far ahead so the shipped rumour list is not regenerated (random).
      // A FIXED timestamp (not unix_timestamp()+N) keeps both sides identical — a relative value
      // is written a second apart on the two servers and, being outside the "now" window, is not
      // aliased, so it would flake by 1s.
      await s.query('update mem_city_schedule set last_reset_rumor = 4000000000 where cid = ?', [
        cid,
      ]);
      // A famous NPC hero standing in a known city, and a rumour for it. npcid 569 has no hero
      // in the shipped save, so the original's `sql_fetch_one(... where npcid=569)` sees exactly
      // one row (a colliding shipped npcid would make it throw "2 were returned" instead).
      await s.query('delete from sys_city_hero where hid = 900501', []);
      await s.query(
        `insert into sys_city_hero (hid, uid, npcid, name, sex, face, cid, state, level, exp,
            affairs_base, bravery_base, wisdom_base, loyalty, herotype)
          values (900501, 900001, 569, '名将乙', 1, 1001, ?, 0, 15, 2500, 40, 45, 42, 70, 100)`,
        [cid],
      );
      await s.query('delete from sys_city_rumor where cid = ? and id = 900701', [cid]);
      await s.query(
        `insert into sys_city_rumor (id, cid, name, type, typeid, price)
          values (900701, ?, '名将乙', 0, 569, 30)`,
        [cid],
      );

      await hotel('getRumorList');
      await hotel('getRumor', 900701);
      // Not enough 元宝 for the detail, then pay for it.
      await s.query('update sys_user set money = 0 where uid = ?', [uid]);
      await hotel('askDetail', 900701, 0);
      await s.query('update sys_user set money = 100000 where uid = ?', [uid]);
      await hotel('askDetail', 900701, 0);
      // Record it as a 捉将 task pair.
      await s.query('delete from sys_user_task where uid = ? and tid in (20569, 30569)', [uid]);
      await hotel('recordTask', 900701);
      // Already recorded.
      await hotel('recordTask', 900701);

      await s.query('delete from sys_user_task where uid = ? and tid in (20569, 30569)', [uid]);
      await s.query('delete from sys_things where uid = ? and tid = 20569', [uid]);
      await s.query('delete from sys_report where uid = ? and title = 19', [uid]);
      await s.query('delete from sys_city_hero where hid = 900501', []);
      await s.query('delete from sys_city_rumor where cid = ? and id = 900701', [cid]);
    },
  },
  {
    name: 'hotel 鉴定宝藏 consumes a map or refuses without one',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hotel = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 10, 42, func, ...args);

      // No 鉴宝图 (thing 118): refuses with the buy popup.
      await s.query('delete from sys_things where uid = ? and tid = 118', [uid]);
      await hotel('treasureIdentify', 0);
      // With a map, it picks a wild field and files a report. mt_rand is fixed in difftest, so
      // both servers pick the same field; the report time is masked.
      await s.query('insert into sys_things (uid, tid, count) values (?, 118, 1)', [uid]);
      await hotel('treasureIdentify', 0);

      await s.query('delete from mem_treasure_map where uid = ?', [uid]);
      await s.query('delete from sys_report where uid = ? and title = 31', [uid]);
      await s.query('delete from sys_things where uid = ? and tid = 118', [uid]);
    },
  },
  {
    name: 'shop buyGoodsUsingCopper buys for 积分 and 五铢钱',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const copper = (func: string, ...args: unknown[]) => s.command(session, func, ...args);

      // A copper-shop offer of a known goods id; keep it unlimited so no box caps trip.
      const COPPER_GID = 10525;
      await s.query('delete from cfg_goods_copper where gid = ? and type = 0', [COPPER_GID]);
      await s.query(
        `insert into cfg_goods_copper (gid, type, price, onsale, commend, rate)
          values (?, 0, 5, 1, 1, 100)`,
        [COPPER_GID],
      );
      await s.query('delete from sys_goods_copper', []);
      await s.query('insert into sys_goods_copper (gid, type) values (?, 0)', [COPPER_GID]);
      // Give the player 积分 (888888) and 五铢钱 (10960).
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 888888, 1000) on duplicate key update count = 1000',
        [uid],
      );
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 10960, 1000) on duplicate key update count = 1000',
        [uid],
      );

      // Invalid amount, then a 积分 buy, then a 五铢钱 buy.
      await copper('buyGoodsUsingCopper', COPPER_GID, 0, 0, 0);
      await copper('buyGoodsUsingCopper', COPPER_GID, 0, 2, 0);
      await copper('buyGoodsUsingCopper', COPPER_GID, 0, 1, 1);
      // Not enough 积分.
      await s.query('update sys_goods set count = 1 where uid = ? and gid = 888888', [uid]);
      await copper('buyGoodsUsingCopper', COPPER_GID, 0, 5, 0);

      await s.query('delete from cfg_goods_copper where gid = ? and type = 0', [COPPER_GID]);
      await s.query('delete from sys_goods_copper', []);
      await s.query('delete from sys_goods where uid = ? and gid in (888888, 10960, ?)', [
        uid,
        COPPER_GID,
      ]);
      await s.query('delete from log_goods where uid = ? and gid in (888888, 10960, ?)', [
        uid,
        COPPER_GID,
      ]);
    },
  },
  {
    name: 'store saves the resource split',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      // Make sure the city has a sys_city_res_add row the update can land on.
      await s.query(
        'insert into sys_city_res_add (cid) values (?) on duplicate key update cid = cid',
        [cid],
      );
      // modifyStoreRate always ends by throwing a message; its effect is the saved row.
      await s.dialog(session, cid, 17, 0, 'modifyStoreRate', 40, 20, 10, 0);
      await s.query(
        'select food_store, wood_store, rock_store, iron_store, resource_changing from sys_city_res_add where cid = ?',
        [cid],
      );
      // Error branches: a negative rate, and a sum over 100.
      await s.dialog(session, cid, 17, 0, 'modifyStoreRate', -1, 0, 0, 0);
      await s.dialog(session, cid, 17, 0, 'modifyStoreRate', 60, 30, 20, 10);
      // Another lord's city is refused before the command runs.
      await s.dialog(session, FOREIGN_CITY, 17, 0, 'modifyStoreRate', 10, 10, 10, 10);
    },
  },
  {
    name: 'store packs resources into goods',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      // Give the city resources and the player 铜钱 to pay the pack fee.
      await s.query('update mem_city_resource set food = 100000, wood = 100000 where cid = ?', [
        cid,
      ]);
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 152, 100000) on duplicate key update count = 100000',
        [session.uid],
      );
      // Pack 100 units of food1 (gid 91) and wood2 (gid 88), 50 铜钱 each.
      await s.dialog(
        session,
        cid,
        17,
        0,
        'payToPack',
        ['food1', 100, 100, 50],
        ['wood2', 100, 100, 50],
      );
      await s.query(
        'select gid, count from sys_goods where uid = ? and gid in (91, 88, 152) order by gid',
        [session.uid],
      );
      await s.query('select food, wood from mem_city_resource where cid = ?', [cid]);
      // Error: an unknown resource type. The original hits a malformed `select  from …` (an
      // undefined $typeToCol key) and returns the DB layer's "PearDB returned an error. "; the
      // new server validates the type and answers 没有这样的资源类型. Both reject (leading 0), so
      // mask only the degenerate error text.
      await s.dialog(session, cid, 17, 0, 'payToPack', ['bogus1', 1, 1, 1]);
      s.mask(1);
      // Error: not enough resource.
      await s.query('update mem_city_resource set food = 0 where cid = ?', [cid]);
      await s.dialog(session, cid, 17, 0, 'payToPack', ['food1', 100, 100, 50]);
      // Error: not enough 铜钱.
      await s.query('update mem_city_resource set food = 100000 where cid = ?', [cid]);
      await s.query('update sys_goods set count = 0 where uid = ? and gid = 152', [session.uid]);
      await s.dialog(session, cid, 17, 0, 'payToPack', ['food1', 100, 100, 50]);
    },
  },
  {
    name: 'barn loads goods and zuoji armor',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // loadBarnGoods for each 洗练 index, and an out-of-range index.
      await s.command(session, 'loadBarnGoods', 0);
      await s.command(session, 'loadBarnGoods', 2);
      await s.command(session, 'loadBarnGoods', 3);
      // loadZuojiArmor filters the player's goods by 坐骑装备 type.
      await s.command(session, 'loadZuojiArmor', 1, 0);
    },
  },
  {
    name: 'barn unlades a zuoji pearl',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // A zuoji with gid 502 embedded in hole 0 (isFitPos: 502 belongs in pos 0).
      await s.query(
        `insert into sys_user_armor (sid, uid, armorid, embed_holes, embed_pearls)
         values (900501, ?, 1, '0,0,0,0,0', '502,0,0,0,0')
         on duplicate key update embed_pearls = '502,0,0,0,0'`,
        [session.uid],
      );
      await s.command(session, 'doUnlade', 900501, 502, 0);
      await s.query('select embed_pearls from sys_user_armor where sid = 900501', []);
      await s.query('select count from sys_goods where uid = ? and gid = 502', [session.uid]);
      // Error branches: bad position, wrong gid for the position, and a missing armor.
      await s.command(session, 'doUnlade', 900501, 502, 9);
      await s.command(session, 'doUnlade', 900501, 503, 1);
      await s.command(session, 'doUnlade', 900999, 502, 0);
      await s.query('delete from sys_user_armor where sid = 900501', []);
    },
  },
  {
    name: 'hero buffer lists active treasure buffs',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // 君主将 hid 80213. A world buff (buftype 1 -> name by gid 26) and a 赤壁 buff
      // (buftype 160040, named directly); both end in the future. An expired buff and a
      // buftype 5 (excluded) must not appear.
      await s.query(
        `insert into mem_hero_buffer (hid, buftype, endtime)
         values (80213, 1, unix_timestamp() + 3600),
                (80213, 160040, unix_timestamp() + 7200),
                (80213, 2, unix_timestamp() - 3600),
                (80213, 5, unix_timestamp() + 3600)
         on duplicate key update endtime = values(endtime)`,
        [],
      );
      await s.command(session, 'getHeroBuffer', 0, 80213);
      // endtime is a future unix timestamp relative to each case start.
      s.offset(4, '*', 'endtime');
      await s.query(
        'delete from mem_hero_buffer where hid = 80213 and buftype in (1, 160040, 2, 5)',
        [],
      );
    },
  },
  // --- world (stage5/world-server) ---------------------------------------------------------
  {
    name: 'getMapCity lists the famous cities',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getMapCity');
      // WorldFunc.php::getMapCity has no ORDER BY, so the row order is storage-engine dependent
      // (legacy MyISAM physical order vs the new InnoDB clustered PK); compare as a set.
      s.unordered(4);
    },
  },
  {
    name: 'getBlockData for block 0 with the union marks',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getBlockData', [0, 1]);
    },
  },
  {
    name: 'getWorldFieldInfo reads one tile',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'getWorldFieldInfo', cid2wid(cid));
    },
  },
  {
    name: "getWorldCityInfo flags the player's own city",
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'getWorldCityInfo', 1, cid);
    },
  },
  {
    name: 'getGovernInfo for the home city',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'getGovernInfo', cid);
    },
  },
  {
    name: 'getUserFields lists held wild fields',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getUserFields');
    },
  },
  {
    name: 'getActionField with no activity field live',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getActionField', 1);
    },
  },
  {
    name: 'checkCanInvade on the home city (plain -> allowed)',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'checkCanInvade', cid);
    },
  },
  {
    name: 'favourites: add, list, comment, delete round trip',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      // add throws the success message; both sides return the same thrown text.
      await s.command(session, 'addFavourites', cid);
      await s.command(session, 'getFavouritesList');
      const [row] = await s.query<{ id: string }>(
        'select id from sys_favourites where uid = ? and cid = ? order by id desc limit 1',
        [session.uid, cid],
      );
      const favId = Number(row?.id ?? 0);
      s.alias(favId, '<favid>');
      await s.command(session, 'setFavouritesComments', favId, '前线城池');
      await s.command(session, 'deleteFavourites', favId);
    },
  },
  {
    name: 'addFavourites rejects a duplicate',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'addFavourites', cid);
      await s.command(session, 'addFavourites', cid);
    },
  },
  {
    name: 'markCity requires a union',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // changle has no union in the shipped save -> No_Union (after the famous-city check).
      await s.command(session, 'markCity', 215265);
    },
  },
  {
    // UnionFunc.php::getOtherCityByName — the WorldPanel 搜索 jump list. The error branches are
    // deterministic; the hit searches for changle's own 城池 name, which matches exactly one row.
    name: 'getOtherCityByName searches cities by name',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getOtherCityByName', ''); // enter_target_name
      await s.command(session, 'getOtherCityByName', '九个字的城池名字啊'); // union_name_tooLong
      await s.command(session, 'getOtherCityByName', '绝无此城名'); // target_union_not_exist
      // The home city's name (长乐宫) matches itself; row order has a LIMIT 6 but no ORDER BY, so
      // compare the hit list as a set.
      await s.command(session, 'getOtherCityByName', '长乐宫');
      s.unordered(6);
    },
  },
  {
    // UnionFunc.php::getOtherUnionAreaByName -> getOtherUnionArea. The shipped save has no 联盟, so
    // the error branches run as-is; the success path seeds a 联盟 with changle as its only member
    // holding one 郡 (type 2) city, then rolls it all back. getProvinceCityOwner enumerates the 18
    // 州城 (identical on both snapshots) and getUnionArea returns the seeded 郡's province_jun.
    name: 'getOtherUnionAreaByName resolves a union influence view',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.command(session, 'getOtherUnionAreaByName', ''); // enter_target_name
      await s.command(session, 'getOtherUnionAreaByName', '九个字的联盟名字啊'); // union_name_tooLong
      await s.command(session, 'getOtherUnionAreaByName', '查无此盟'); // target_union_not_exist

      // Seed a union whose single member (changle) holds one 郡 city, so getUnionArea has a row.
      await s.query('delete from sys_union where id = 90001');
      await s.query(
        "insert into sys_union (id, name, leader, creator, member) values (90001, '差分联盟', ?, ?, 1)",
        [uid, uid],
      );
      await s.query('update sys_user set union_id = 90001 where uid = ?', [uid]);
      const [jun] = await s.query<{ cid: string; uid: string }>(
        'select cid, uid from sys_city where type = 2 order by cid limit 1',
      );
      const junCid = Number(jun?.cid ?? 0);
      const junUid = Number(jun?.uid ?? 0);
      await s.query('update sys_city set uid = ? where cid = ?', [uid, junCid]);

      await s.command(session, 'getOtherUnionAreaByName', '差分联盟');
      // getProvinceCityOwner has no ORDER BY within a province; compare as a set.
      s.unordered(6, 1);

      await s.query('update sys_city set uid = ? where cid = ?', [junUid, junCid]);
      await s.query('update sys_user set union_id = 0 where uid = ?', [uid]);
      await s.query('delete from sys_union where id = 90001');
    },
  },
  {
    // 校场 (GroundFunc.php). The Ground sits at inner (0, 4) in the shipped save; its dialog is
    // addressed by bid 8 and y * 10 + x = 40. 募兵 / 战术 / 招降 / 治疗 all end by throwing a
    // message, so the compare is the leading-0 reply plus the DB effects; the 'get*' lists return
    // data. StartTroop / troop-scheme / 演习 settlement are the next wave and are not exercised.
    name: 'ground conscripts, sets tactics',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const ground = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 8, 40, func, ...args);

      // 募兵: a normal 州城 (type 3) with a province special soldier, state 1 (ready). The grant
      // count is rand(600,1800); the sid would be rand(45,50) only when the province's
      // cfg_soldier_special_city.rsid is 1 (it is 0 here, so the sid is fixed and no sid draw
      // happens). With a scripted RNG armed, both servers draw the same value and scale it the
      // same way (600 + draw mod 1201), so the grant count — and the success message that embeds
      // it — compare EXACTLY. Draw 1000 -> count 1600.
      s.rng([1000]);
      await s.query('update sys_city set type = 3, conscript = 1, is_special = 0 where cid = ?', [
        cid,
      ]);
      await ground('conscript');
      // 成功招募到<兵种>1600 — the scripted RNG pins the count, so compare it exactly.
      // Already drafted today.
      await s.query('update sys_city set conscript = unix_timestamp() where cid = ?', [cid]);
      await ground('conscript');
      // Not a 县/郡/州 the user owns.
      await ground('conscript');
      await s.dialog(session, FOREIGN_CITY, 8, 40, 'conscript');
      s.stopRng();

      // 出征战术: read then set (empty lists, patrol action 2). getAttackTactics returns [row]/[].
      await s.query('delete from sys_user_tactics where uid = ?', [uid]);
      await ground('getAttackTactics');
      await ground('setAttackTactics', 0, 0, 0, 2);
      await ground('getAttackTactics');

      // 防守战术: getResistTactics completes task 540; setResistTactics saves the row.
      await s.query('delete from sys_city_tactics where cid = ?', [cid]);
      await s.query('delete from sys_user_goal where uid = ? and gid = 540', [uid]);
      await ground('getResistTactics');
      await ground('setResistTactics', 0, 0, 0, 0, 1);
      await ground('getResistTactics');
      // Over the 12-type melee cap (13 joining 反掠夺 groups).
      const tooMany: unknown[] = [13];
      for (let i = 0; i < 13; i++) tooMany.push(10 + i, 1, 0, 0);
      tooMany.push(0, 0, 0, 1);
      await ground('setResistTactics', ...tooMany);

      await s.query('update sys_city set type = 5 where cid = ?', [cid]);
      await s.query('delete from sys_user_tactics where uid = ?', [uid]);
      await s.query('delete from sys_city_tactics where cid = ?', [cid]);
    },
  },
  {
    // 伤兵 / 俘虏 / 逃兵 handling: 治疗 / 招降 / 劝说 (gold) and 遣散 / 释放. All throw a message;
    // the compare is the leading-0 reply plus the soldier / resource / people effects.
    name: 'ground cures wounded, accepts captives and persuades lamsters',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const ground = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 8, 40, func, ...args);
      await s.query('update mem_city_resource set gold = 100000000 where cid = ?', [cid]);

      // Seed curable 伤兵 (sid 1), 俘虏 (sid 5) and 逃兵 (sid 2).
      await s.query('delete from mem_city_wounded where cid = ?', [cid]);
      await s.query('delete from mem_city_captive where cid = ?', [cid]);
      await s.query('delete from mem_city_lamster where cid = ?', [cid]);
      await s.query(
        'insert into mem_city_wounded (cid, sid, count) values (?, 1, 200), (?, 2, 50)',
        [cid, cid],
      );
      await s.query('insert into mem_city_captive (cid, sid, count) values (?, 5, 120)', [cid]);
      await s.query('insert into mem_city_lamster (cid, sid, count) values (?, 2, 80)', [cid]);

      // Lists with their gold need.
      await ground('getWoundedSoldier');
      s.unordered(4, 0); // soldier list has no ORDER BY
      await ground('getCaptiveSoldier');
      await ground('getLamster');

      // Cure one wounded type, then the rest; accept one captive type, then the rest; persuade.
      await ground('cureWoundedSoldierDetail', 1, 50);
      await ground('cureWoundedSoldier');
      await ground('acceptCaptiveSoldierDetail', 5, 20);
      await ground('acceptCaptiveSoldier');
      await ground('sayToLamsterDetail', 2, 30);
      await ground('sayToLamster');

      // Empty now: each reports nothing to do.
      await ground('cureWoundedSoldier');
      await ground('acceptCaptiveSoldier');
      await ground('sayToLamster');

      // Not enough gold refuses.
      await s.query('insert into mem_city_wounded (cid, sid, count) values (?, 1, 200)', [cid]);
      await s.query('update mem_city_resource set gold = 0 where cid = ?', [cid]);
      await ground('cureWoundedSoldier');
      await s.query('update mem_city_resource set gold = 100000000 where cid = ?', [cid]);

      await s.query('delete from mem_city_wounded where cid = ?', [cid]);
      await s.query('delete from mem_city_captive where cid = ?', [cid]);
      await s.query('delete from mem_city_lamster where cid = ?', [cid]);
    },
  },
  {
    // 遣散 伤兵 / 逃兵 (back to city people) and 释放 俘虏, all at once and by type.
    name: 'ground dismisses wounded, lamsters and captives',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const ground = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 8, 40, func, ...args);

      await s.query('delete from mem_city_wounded where cid = ?', [cid]);
      await s.query('delete from mem_city_lamster where cid = ?', [cid]);
      await s.query('delete from mem_city_captive where cid = ?', [cid]);
      await s.query('insert into mem_city_wounded (cid, sid, count) values (?, 1, 100)', [cid]);
      await s.query('insert into mem_city_lamster (cid, sid, count) values (?, 2, 60)', [cid]);
      await s.query('insert into mem_city_captive (cid, sid, count) values (?, 5, 40)', [cid]);

      // Dismiss more than present is refused.
      await ground('dismissWoundedSoldierDetail', 1, 1000);
      // Dismiss one type, then the rest.
      await ground('dismissWoundedSoldierDetail', 1, 30);
      await ground('dismissWoundedSoldier');
      await ground('dismissLamsterDetail', 2, 20);
      await ground('dismissLamster');
      await ground('dismissCaptiveSoldierDetail', 5, 10);
      await ground('dismissCaptiveSoldier');

      await s.query('delete from mem_city_wounded where cid = ?', [cid]);
      await s.query('delete from mem_city_lamster where cid = ?', [cid]);
      await s.query('delete from mem_city_captive where cid = ?', [cid]);
    },
  },
  {
    // Queue an opposed sand-table battle, settle it, then consume its result exactly as the client
    // does. Legacy's scalar-target quirk makes this a 40-round draw with empty loss strings.
    name: 'ground maneuver settles opposed armies and consumes the result',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const ground = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 8, 40, func, ...args);
      await ground('getManeuverResult', 999999);
      const started = (await ground('startManeuver', '2,3,100,1,10', '2,3,5,1,20')) as unknown[];
      const mid = Number(started[0]);
      if (!mid) throw new Error('startManeuver did not return an id');
      await ground('getManeuverResult', mid);
      s.rng([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
      await s.tick('HandleBattle');
      s.stopRng();
      await ground('getManeuverResult', mid);
      await ground('getManeuverResult', mid);
    },
  },
  {
    name: 'mail: getMail falls back to the inbox and clears the alarm',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // No unread mail of any kind: getMail returns the (empty) inbox with flag 0 and the alarm
      // row is forced to 0.
      await s.query('delete from sys_mail_box where uid = ? or fromuid = ?', [
        session.uid,
        session.uid,
      ]);
      await s.query('delete from sys_mail_sys_box where uid = ?', [session.uid]);
      await s.query(
        'insert into sys_alarm (uid, mail) values (?, 1) on duplicate key update mail = 1',
        [session.uid],
      );
      await s.command(session, 'getMail');
      await s.command(session, 'getInboxMail', 0);
      await s.command(session, 'getOutboxMail', 0);
      await s.command(session, 'getSysMail', 0);
    },
  },
  {
    name: 'mail: inbox, 系统信 and reading a letter',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('delete from sys_mail_box where uid = ? or fromuid = ?', [
        session.uid,
        session.uid,
      ]);
      await s.query('delete from sys_mail_sys_box where uid = ?', [session.uid]);
      // A personal letter in the inbox with a known content row, and a 系统信.
      await s.query(
        'insert into sys_mail_content (mid, content, posttime) values (900001, ?, 1500000000)',
        ['difftest inbox body'],
      );
      await s.query(
        `insert into sys_mail_box
          (mid, uid, name, fromuid, fromname, contentid, title, \`read\`, recvstate, sendstate, posttime, type)
         values (900001, ?, ?, 999, '差分发件人', 900001, '差分标题', 0, 0, 0, 1500000000, 1)`,
        [session.uid, EXISTING_PLAYER],
      );
      await s.query(
        'insert into sys_mail_sys_content (mid, content, posttime) values (900002, ?, 1500000100)',
        ['<b>difftest sys body</b>'],
      );
      await s.query(
        `insert into sys_mail_sys_box (mid, uid, contentid, title, \`read\`, posttime)
         values (900002, ?, 900002, '差分系统信', 0, 1500000100)`,
        [session.uid],
      );
      // getMail now opens on the inbox (flag 0) because it has an unread letter.
      await s.command(session, 'getMail');
      await s.command(session, 'getSysMail', 0);
      await s.command(session, 'readInboxMail', 900001);
      await s.command(session, 'readSysMail', 900002);
      // A missing letter reports mail_lost.
      await s.command(session, 'readInboxMail', 123456789);
      // Clean up the seeded rows and content.
      await s.query('delete from sys_mail_box where mid = 900001');
      await s.query('delete from sys_mail_content where mid = 900001');
      await s.query('delete from sys_mail_sys_box where mid = 900002');
      await s.query('delete from sys_mail_sys_content where mid = 900002');
    },
  },
  {
    name: 'mail: send a personal letter and the error paths',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('delete from sys_mail_box where uid = ? or fromuid = ?', [
        session.uid,
        session.uid,
      ]);
      // Missing addressee, then a real one. posttime of a new letter follows the clock.
      await s.command(session, 'sendPersonMail', EXISTING_PLAYER, '查无此人name', '标题', '正文');
      const [other] = await s.query<{ name: string }>(
        'select name from sys_user where uid > 1000 and uid <> ? limit 1',
        [session.uid],
      );
      await s.command(
        session,
        'sendPersonMail',
        EXISTING_PLAYER,
        other?.name ?? EXISTING_PLAYER,
        '差分标题',
        '差分正文',
      );
      // The sent letter shows in the outbox; its posttime is now.
      await s.command(session, 'getOutboxMail', 0);
      s.offset(4, 0, 'posttime');
      // 联盟群发 is not ported yet.
      await s.command(session, 'sendUnionMail', EXISTING_PLAYER, 0, '群发', '内容');
      await s.query('delete from sys_mail_box where fromuid = ?', [session.uid]);
    },
  },
  {
    // 军队面板 reads (TroopFunc.php) and 鸿胪寺 driving-permission toggles. All deterministic:
    // the lists annotate the player's own rows, the toggles write sys_allow_union_troop.
    name: 'troop panel lists and union-troop permissions',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // A clean slate, then one marching troop (state 0, task 0 transport) and one stationed
      // (state 4, task 1 dispatch) on this player.
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_allow_union_troop where uid = ?', [uid]);
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 0, 0, unix_timestamp(), 600, unix_timestamp() + 600, '1,1,100', '0', 0, 0)`,
        [uid, cid, cid + 1],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 1, 4, unix_timestamp(), 600, unix_timestamp(), '1,1,50', '0', 0, 0)`,
        [uid, cid, cid + 1],
      );
      // getArmyTroops clears the troops alarm and lists state<4 rows; targetcity depends on the
      // tile type, which may be a wild field or a city — unordered guards row order.
      // getArmyTroops / getEnemyTroops / getStayTroops each take a 合法标志 as their first arg (the
      // client sends serverTime()); an empty one marks the caller a 外挂 and writes
      // log_waigua_online. The real client always sends it, so pass a non-empty sign — otherwise
      // the sides diverge on an anti-cheat log the normal flow never writes. (getUnionTroops has no
      // such check.)
      await s.command(session, 'getArmyTroops', 1);
      s.unordered(0);
      // The marching troop's starttime/endtime are unix_timestamp() and unix_timestamp()+600 at
      // insert time; the two sides run a second or two apart, so compare them as offsets.
      s.offset(4, '*', 'starttime');
      s.offset(4, '*', 'endtime');
      await s.command(session, 'getStayTroops', 1);
      s.unordered(1);
      await s.command(session, 'getUnionTroops');
      await s.command(session, 'getEnemyTroops', 1);

      // 鸿胪寺 toggles (dialog on 鸿胪寺 bid 12; the address is not validated by these handlers).
      await s.dialog(session, cid, 12, 0, 'allowUnionTroop', 1);
      await s.dialog(session, cid, 12, 0, 'allowAntiPlunder', 1);
      await s.dialog(session, cid, 12, 0, 'allowAntiInvade', 1);
      await s.dialog(session, cid, 12, 0, 'allowUnionTroop', 0);

      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_allow_union_troop where uid = ?', [uid]);
    },
  },
  {
    // callBackTroop / kickTroop per-state behaviour (TroopFunc.php). All deterministic time deltas
    // are offset-compared via the sys_troops table rule.
    name: 'troop recall and kick',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      // An advancing troop (state 0) and a stationed one (state 4) to recall.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, noback)
         values (?, ?, 0, ?, 2, 0, unix_timestamp() - 100, 600, unix_timestamp() + 500, '1,3,10', '0', 0)`,
        [uid, cid, cid + 2000],
      );
      const advId = Number(
        (
          await s.query<{ id: string }>('select max(id) as id from sys_troops where uid = ?', [uid])
        )[0]?.id,
      );
      await s.command(session, 'callBackTroop', advId);
      // Recall a stationed troop with a hero.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
         values (?, ?, 0, ?, 1, 4, unix_timestamp(), 600, unix_timestamp(), '1,1,20', '0')`,
        [uid, cid, cid + 1],
      );
      const stayId = Number(
        (
          await s.query<{ id: string }>('select max(id) as id from sys_troops where uid = ?', [uid])
        )[0]?.id,
      );
      await s.command(session, 'callBackTroop', stayId);
      // An unknown troop and a battling one (state 3) are refused.
      await s.command(session, 'callBackTroop', 99999999);
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
         values (?, ?, 0, ?, 3, 3, unix_timestamp(), 600, unix_timestamp(), '1,1,20', '0')`,
        [uid, cid, cid + 1],
      );
      const battleId = Number(
        (
          await s.query<{ id: string }>('select max(id) as id from sys_troops where uid = ?', [uid])
        )[0]?.id,
      );
      await s.command(session, 'callBackTroop', battleId);
      await s.query('delete from sys_troops where uid = ?', [uid]);
    },
  },
  {
    // 出征方案 (getTroopScheme / setTroopScheme) — pure read/write of sys_user_troopScheme.
    name: 'troop scheme save and load',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const ground = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 8, 40, func, ...args);
      await s.query('delete from sys_user_troopScheme where uid = ?', [uid]);
      await ground('getTroopScheme', 1); // empty
      await ground('setTroopScheme', 1, '2,1,100,3,50'); // insert
      await ground('getTroopScheme', 1);
      await ground('setTroopScheme', 1, '3,1,100,3,50,7,20'); // update
      await ground('getTroopScheme', 1);
      await ground('setTroopScheme', 9, 'x'); // out of range → 数据异常
      await ground('getTroopScheme', 0); // out of range → 数据异常
      await s.query('delete from sys_user_troopScheme where uid = ?', [uid]);
    },
  },
  {
    // ExternService.getTroopMaxTime — always 0 now (the 2011 promo window is closed on both sides).
    name: 'getTroopMaxTime is 0 outside the promo window',
    run: (s) => s.service('ExternService', 'getTroopMaxTime', [120, 340]),
  },
  {
    // ExternService.getEnemyTroopSet / saveEnemyTroopSet — the 敌军过滤 panel reads and writes
    // sys_enemy_troop_filter and marks goal 539. saveEnemyTroopSet needs 烽火台 >= 5. The home
    // city (209355) ships with a level-15 烽火台, so the save path is exercised directly; a
    // temporary drop to level 4 drives the reject branch, then the level is restored.
    name: 'enemy troop filter reads, saves and gates on 烽火台 level',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_enemy_troop_filter where cid = ?', [cid]);
      await s.query('delete from sys_user_goal where uid = ? and gid = 539', [uid]);

      // Empty to start.
      await s.service('ExternService', 'getEnemyTroopSet', [cid]);
      // Save two action thresholds; marks goal 539.
      await s.service('ExternService', 'saveEnemyTroopSet', [
        cid,
        [
          { action: 2, count: 100 },
          { action: 3, count: 50 },
        ],
      ]);
      // Read them back (PRIMARY KEY (cid, action) orders rows deterministically).
      await s.service('ExternService', 'getEnemyTroopSet', [cid]);
      // Update one threshold in place (on duplicate key).
      await s.service('ExternService', 'saveEnemyTroopSet', [cid, [{ action: 2, count: 250 }]]);
      await s.service('ExternService', 'getEnemyTroopSet', [cid]);

      // 烽火台 below level 5 rejects with enemyfilter.firelevelhow.
      const [bale] = await s.query<{ level: string }>(
        'select level from sys_building where cid = ? and bid = 19 limit 1',
        [cid],
      );
      await s.query('update sys_building set level = 4 where cid = ? and bid = 19', [cid]);
      await s.service('ExternService', 'saveEnemyTroopSet', [cid, [{ action: 2, count: 10 }]]);
      // The amfphp fault carries a faultDetail = "<php path> on line N"; the new server has no PHP
      // source location and sends an empty one. Mask it — only faultCode/faultString are the
      // contract. (Both sides now emit the field, so masking is symmetric.)
      s.mask('faultDetail');
      await s.query('update sys_building set level = ? where cid = ? and bid = 19', [
        Number(bale?.level ?? 15),
        cid,
      ]);

      await s.query('delete from sys_enemy_troop_filter where cid = ?', [cid]);
      await s.query('delete from sys_user_goal where uid = ? and gid = 539', [uid]);
    },
  },
  {
    // HandleTroop tick (cfg_js.php, TickOrder.Troop): the non-battle settlements. A transport
    // arrival (task 0) deposits resources and turns home; a return (state 1) restores soldiers
    // and deletes the row. The battle arrivals (task 2/3/4/9) are left in place by both sides
    // (new: not ported; legacy: no backend settles the queued battle in this harness).
    name: 'troop tick settles transport arrival and return',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      // Transport to the player's OWN adjacent tile that is a city they own, so the arrival path
      // is the self-city deposit, not a battle. Use the same city as origin and target+0 is
      // disallowed, so send to the city itself via a self-field is avoided; instead settle a
      // transport that is already due and whose target is this very city (self union, type 0).
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 0, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,100', '0,10,0,0,0', 0, 0)`,
        [uid, cid, cid],
      );
      // A return-home troop (state 1) that is due: soldiers go back to the city, row deleted.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 0, 1, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,40', '0', 0, 0)`,
        [uid, cid, cid + 1],
      );
      // A battle arrival (task 4) that is NOT due yet: endtime in the future, so neither side's
      // HandleTroop (both select `endtime <= now and state in (0,1)`) picks it up — it is left in
      // place exactly. A *due* battle arrival would send the legacy tick into battleAdd()/the
      // battle engine (unported here; battleArrivalNotPorted on the new side), which is the battle
      // wave's job, not this one.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 4, 0, unix_timestamp(), 600, unix_timestamp() + 600, '1,3,10', '0', 0, 0)`,
        [uid, cid, cid + 3000],
      );
      await s.tick('HandleTroop');
      await s.query('delete from sys_troops where uid = ?', [uid]);
    },
    // The legacy tick harness boots a full request (global.php), whose SetCityBaseProduce
    // recomputes every resource cap from the bootstrap city's building levels — re-deriving the
    // caps (6_010_000 etc.) that the shipped save stores slightly stale (6_000_000). The new
    // server's /api/debug/tick runs only HandleTroop, not that bootstrap, so the caps keep their
    // stored values. The recompute is request-setup noise unrelated to HandleTroop, so ignore the
    // *_max columns for this case (the resource amounts, add rates and everything else compare).
    tables: {
      mem_city_resource: {
        ignore: ['gold_max', 'food_max', 'wood_max', 'rock_max', 'iron_max'],
      },
    },
  },
  {
    // HandleTroop tick, task-2 (侦察 / scout) arrival — the EMPTY FIELD. A scout due at a wild tile
    // with no garrison and no stationed troop finds nothing: `$patrol=0`, the fight early-outs to a
    // HandleTroop tick, task-2 (侦察 / scout) arrival — an EMPTY player-owned wild field. A scout
    // due at a field the scouting player's OWN union/self holds (ownercid a player city, so
    // field.uid > 1000) skips `checkSodier` (the NPC garrison top-up, which is random); with no
    // stationed troop there is no patrol, the fight early-outs to a win, and `case 0:` falls through
    // to the intel block. A wild field has no sys_city / mem_city_resource / buildings etc., so
    // every intel tier is empty and nothing is appended — the report is the title, "对方未发觉" and
    // the 返回 line. The scout turns home (state 1). The single sys_report row and the troop state
    // must byte-match; `time` is offset-compared.
    name: 'troop tick settles a scout of an empty field',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid = ?', [uid]);
      // Pre-raise the 战报 alarm so the report's idempotent raiseAlarm is a no-op delta on BOTH
      // sides (the login leaves one side's flag set, so starting at 1 keeps them symmetric).
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1) on duplicate key update report = 1',
        [uid],
      );
      // A free wild tile (ownercid 0, type > 1), handed to the scouting player's city so the field
      // owner resolves to a real player (uid > 1000) and checkSodier is skipped. The snapshot
      // rollback restores it.
      const [tile] = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 and state = 0 order by wid limit 1',
      );
      const fieldWid = Number(tile?.wid ?? 0);
      const targetCid = wid2cid(fieldWid);
      await s.query('update mem_world set ownercid = ? where wid = ?', [cid, fieldWid]);
      await s.query(
        `insert into sys_city_technic (cid, tid, level) values (?, 7, 5)
          on duplicate key update level = 5`,
        [cid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,3,100', '0', 0, 0)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleTroop');
      await s.query('update mem_world set ownercid = 0 where wid = ?', [fieldWid]);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid = ?', [uid]);
    },
    tables: SCOUT_RESOURCE_IGNORE,
  },
  {
    // HandleTroop tick, task-2 (侦察) arrival — a PLAYER-OWNED CITY at a LOW scout level. Scouting a
    // real player's city (uid > 1000) skips `checkSodier` (the NPC garrison top-up, which is random)
    // and, with no 斥候-type defender, fights no patrol — so the whole settlement is deterministic.
    // At 侦察技巧 level 1 only the 资源状况 tier unlocks (and gold is withheld until level > 2), so
    // the report carries a single resource table. The scout files its own report AND an alarm
    // (title 12) for the city's owner. Both sys_report rows and the troop's turn-home compare.
    name: 'troop tick settles a scout of a player city (low intel)',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [victim] = await s.query<{ uid: string; cid: string }>(
        'select uid, lastcid as cid from sys_user where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const targetCid = Number(victim?.cid ?? 0);
      const victimUid = Number(victim?.uid ?? 0);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid in (?, ?)', [uid, victimUid]);
      // Pre-raise both 战报 alarms so the reports' idempotent raiseAlarm is a no-op delta on BOTH
      // sides (the login leaves one side's flag set; starting at 1 keeps them symmetric).
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1), (?, 1) on duplicate key update report = 1',
        [uid, victimUid],
      );
      await s.query(
        `insert into sys_city_technic (cid, tid, level) values (?, 7, 1)
          on duplicate key update level = 1`,
        [cid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,3,100', '0', 0, 0)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleTroop');
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid in (?, ?)', [uid, victimUid]);
    },
    tables: SCOUT_RESOURCE_IGNORE,
  },
  {
    // HandleTroop tick, task-2 (侦察) arrival — a PLAYER-OWNED CITY at the TOP scout level, so every
    // intel tier that has data unlocks: 资源状况 (with gold now, level > 2), 建筑状况, 城防状况,
    // 军队状况 (exact counts at level >= 7), 盟军状况 (if allied troops are stationed), 将领状况,
    // 科技状况, and — because the target is a real player (uid > 1000) — 玩家动态. The 玩家动态 row
    // reads sys_online.lastupdate and an in/离线 flag off the clock; the online row is absent in the
    // shipped save, so both sides read 0 and report 离线 with the same from_unixtime(0) — stable.
    name: 'troop tick settles a scout of a player city (full intel)',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [victim] = await s.query<{ uid: string; cid: string }>(
        'select uid, lastcid as cid from sys_user where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const victimUid = Number(victim?.uid ?? 0);
      const targetCid = Number(victim?.cid ?? 0);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid in (?, ?)', [uid, victimUid]);
      // No sys_online row for the target → both sides read lastupdate 0 → 离线 with from_unixtime(0).
      await s.query('delete from sys_online where uid = ?', [victimUid]);
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1), (?, 1) on duplicate key update report = 1',
        [uid, victimUid],
      );
      await s.query(
        `insert into sys_city_technic (cid, tid, level) values (?, 7, 10)
          on duplicate key update level = 10`,
        [cid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,3,100', '0', 0, 0)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleTroop');
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid in (?, ?)', [uid, victimUid]);
    },
    tables: SCOUT_RESOURCE_IGNORE,
  },
  {
    // Legacy upManeuver reads getTarget's integer sid as an array, so even a superior force draws
    // after 40 rounds. Verify the full reports, halved intel, goal, alarms and intact patrols.
    name: 'troop tick scout draws a city patrol with a larger force',
    tables: SCOUT_RESOURCE_IGNORE,
    run: (s) => seedScoutPatrol(s, 30000, 5),
  },
  {
    // The same scalar-target quirk leaves a lone scout alive: it returns with halved intelligence.
    name: 'troop tick scout draws a city patrol with a smaller force',
    tables: SCOUT_RESOURCE_IGNORE,
    run: (s) => seedScoutPatrol(s, 1, 30000),
  },
  {
    // Zero attack/defence also stays a 40-round draw rather than producing NaN casualties.
    name: 'troop tick scout draws a city patrol with zero combat stats',
    tables: SCOUT_RESOURCE_IGNORE,
    run: (s) => seedScoutPatrol(s, 100, 100, true),
  },
  {
    // HandleBattle tick (cfg_js.php, TickOrder.Battle): the 演习 (upManeuver) instant simulator.
    // A 演习 row is queued by GroundFunc.php::startManeuver as `mem_maneuver(state=0, …)`; the
    // 易语言 backend ran `upManeuver($id, 0)` to settle it — no PHP cron does, so the difftest
    // harness's legacy `tick('HandleBattle')` calls upManeuver over every pending maneuver (see
    // tools/src/lib/difftest/side.ts), mirroring the new BattleTick.handleBattle.
    //
    // The harness restores the production attackadd/resistadd/wallhp columns omitted by the dump.
    // Opposed engagements are covered by the patrol cases above; this case pins the early-out.
    //
    // The unopposed case (empty defender) early-outs to end 0 BEFORE any attackadd write: legacy
    // returns without persisting, so the row stays state=0, and the new side's upManeuver likewise
    // early-outs with `fought=false` and settleManeuver writes nothing (buildAdd never persists).
    // Both sides leave the row untouched — the comparable, truthful outcome.
    name: '演习 (HandleBattle) leaves an unopposed maneuver unsettled on both sides',
    run: async (s) => {
      await s.query('delete from mem_maneuver');
      // Attacker: 100 scouts (sid 3). Defender: none. upManeuver early-outs (end 0) and, because
      // the real-battle block (with its attackadd write) is skipped, persists NOTHING.
      await s.query(
        `insert into mem_maneuver (id, state, attacksoldiers, resistsoldiers) values
          (900100, 0, '1,3,100', '0')`,
      );
      await s.tick('HandleBattle');
      const [row] = await s.query<{ state: string; result: string; round: string }>(
        'select state, result, round from mem_maneuver where id = 900100',
      );
      // Both sides leave it at state 0 (unsettled) — no table delta on either side.
      if (Number(row?.state) !== 0) {
        throw new Error('演习 early-out should leave the row unsettled (state 0)');
      }
      await s.query('delete from mem_maneuver where id = 900100');
    },
  },
  {
    // ReportFunc.php readers. Seed two reports (one unread 军情 battle report, one read 内政
    // report) and exercise the unread list, a typed tab, a soft delete and the battle detail.
    // The battle engine normally writes these rows; here we insert PHP-shaped fixtures and only
    // READ them, so the cases are deterministic without the engine running.
    name: 'report list, unread filter, soft delete and detail',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('delete from sys_report where uid = ?', [uid]);
      await s.query('delete from sys_battle_report where battleid = ?', [990001]);
      // An unread 军情 (type 0) battle report and a read 内政 (type 1) report.
      await s.query(
        `insert into sys_report
          (uid, origincid, origincity, happencid, happencity, title, type, time, \`read\`, battleid, from_battlenet, content)
         values (?, 100200, '甲城', 100201, '乙城', 2, 0, unix_timestamp(), 0, 990001, 0, '<b>占领</b>')`,
        [uid],
      );
      await s.query(
        `insert into sys_report
          (uid, origincid, origincity, happencid, happencity, title, type, time, \`read\`, battleid, from_battlenet, content)
         values (?, 0, '', 100200, '甲城', 16, 1, unix_timestamp(), 1, 0, 0, '天灾人祸')`,
        [uid],
      );
      // Two battle rounds for the battle report above.
      await s.query(
        `insert into sys_battle_report (battleid, round, report) values (990001, 1, '<p>r1</p>')`,
      );
      await s.query(
        `insert into sys_battle_report (battleid, round, report) values (990001, 2, '<p>r2</p>')`,
      );
      // The report list `time` is unix_timestamp() at insert; the two sides run a second or two
      // apart, so compare it as an offset. Row 0 of each reply carries the report rows.
      await s.command(session, 'getUnreadReport', -1, 0); // unread list (clears sys_alarm.report)
      await s.command(session, 'getReport', 0, 0); // 军情 tab
      await s.command(session, 'getReport', 1, 0); // 内政 tab (the read report)
      await s.command(session, 'getReportDetail', 990001); // battle rounds
      await s.command(session, 'getReportDetail', 0); // non-battle report -> []
      // Soft-delete the first report; delReport re-reads the 军情 tab.
      const [firstId] = await s.query<{ id: string }>(
        'select id from sys_report where uid = ? and type = 0 order by id desc limit 1',
        [uid],
      );
      await s.command(session, 'delReport', [Number(firstId?.id ?? 0)], 0, 0);
      await s.query('delete from sys_report where uid = ?', [uid]);
      await s.query('delete from sys_battle_report where battleid = ?', [990001]);
    },
  },
  {
    // TroopFunc.php battle readers (BattleDialog). Seed a running city battle and read the data /
    // report / set a tactic. mem_battle* / sys_battle* are the engine's tables; we insert a minimal
    // PHP-shaped fixture and read it the way TroopFunc did. setSoldierTactics writes only the
    // player's own mem_battle_tactics row.
    name: 'battle data, report and setting a soldier tactic',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const bid = 990002;
      await s.query('delete from sys_battle where id = ?', [bid]);
      await s.query('delete from mem_battle where id = ?', [bid]);
      await s.query('delete from sys_battle_report where battleid = ?', [bid]);
      await s.query('delete from mem_battle_tactics where battleid = ?', [bid]);
      // A running (state 0) city battle: this player attacks, wall already down (wallhp 0).
      await s.query(
        `insert into sys_battle (id, type, attackuid, resistuid, state, result)
         values (?, 0, ?, 1002, 0, 0)`,
        [bid, uid],
      );
      await s.query(
        `insert into mem_battle (id, type, attackcid, resistcid, attackhid, resisthid, wallhp)
         values (?, 0, ?, ?, 0, 0, 0)`,
        [bid, cid, cid + 1],
      );
      await s.query(
        `insert into sys_battle_report (battleid, round, report) values (?, 1, '<p>fight</p>')`,
        [bid],
      );
      await s.command(session, 'getBattleData', bid);
      await s.command(session, 'getBattleReport', bid, 0);
      // The player attacks, so may set their own (attack) side's tactic. sid 60 (>=51) maps to a
      // soldier type; wallhp 0 means the row is replace-inserted with action2/target2 mirrored.
      await s.command(session, 'setSoldierTactics', bid, true, 1, 2, 60);
      await s.query('delete from sys_battle where id = ?', [bid]);
      await s.query('delete from mem_battle where id = ?', [bid]);
      await s.query('delete from sys_battle_report where battleid = ?', [bid]);
      await s.query('delete from mem_battle_tactics where battleid = ?', [bid]);
    },
  },
  {
    // HeroFunc.php::getKingReward (Report/KingRewardPanel): the daily 五铢钱 payout. Reset the
    // claim time so the reward is grantable, claim it, then claim again (refused same day). The
    // granted amount depends on the king hero level, which the shipped save fixes.
    name: 'king reward claims once per day',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // Make the reward claimable: clear today's getrewardtime.
      await s.query(
        `insert into sys_user_level (uid, level, time, getrewardtime) values (?, 0, 0, 0)
         on duplicate key update getrewardtime = 0`,
        [uid],
      );
      await s.command(session, 'getKingReward'); // grants (or 当前没有您的君主将 on a save without one)
      await s.command(session, 'getKingReward'); // 您已经领取过奖励 (if the first granted)
    },
  },
  // --- battle (stage5/battle-multi) ---------------------------------------------------------
  // These exercise the ported multi-round battle (cfg_js.php HandleTroop task 3/4/9 arrival →
  // OLdBattleCron.php HandleBattle/updateBattle/return_new_place/getBattleResult). They are
  // AUTHORED but not yet wired into the difftest runner's expected set — the engine's deep stat
  // build (take_atactics/getAdd) and the mem_battle* schema columns the 易语言 production server
  // carried are a follow-up wave's concern. Each pins the RNG with s.rng([...]) / s.seed(n) so a
  // later run matches the single rand() the engine draws per round (the random target pick) and the
  // mt_rand() rolls in getBattleResult (wounded/capture). The legacy side settles via the
  // tick('HandleTroop') + tick('HandleBattle') harness in tools/src/lib/difftest/side.ts.
  {
    // 掠夺 (task 3) against an EMPTY wild field: cfg_js.php HandleTroop arrival early-outs
    // (野地空无一人) with no battle, turns the troop home, completes the field task. Deterministic —
    // no rand() is drawn on the empty-field path — so a tight compare of the troop row + report.
    name: 'battle: 掠夺 an empty wild field turns the troop home',
    tables: BATTLE_OWNER_RECOMPUTE_IGNORE,
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      // A free wild field adjacent in province, no stationed troop.
      const [field] = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 and state = 0 order by wid limit 1',
      );
      const fieldWid = Number(field?.wid ?? 0);
      const targetcid = wid2cid(fieldWid);
      // No STATE-4 defender stands here, so the arrival early-outs (野地空无一人). But legacy
      // HandleTroop auto-spawns a random NPC garrison via `checkSodier` when the field's resolved
      // owner is uid<1000 (an mt_rand/wall-clock generator this architecture moved to the
      // world-refresh tick) — which would make the "empty" field a battle nondeterministically.
      // A player (uid 1002) marker troop in state 2 (invisible to HandleTroop's state-in-(0,1) pick
      // and to the state-4 defender lookup) makes `check_field_owner` resolve uid>=1000, so
      // checkSodier is skipped on both sides and the field is genuinely empty. uid 1002 > 1000 also
      // means both sides send the field-owner "空无一人" report, which the arrival ports.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (1002, ?, 0, ?, 5, 2, unix_timestamp(), 0, 0, '0', '0', 0, 0)`,
        [targetcid, targetcid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 3, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,100', '0', 0, 0)`,
        [uid, cid, targetcid],
      );
      await s.tick('HandleTroop');
      await s.tick('HandleBattle');
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, targetcid]);
    },
  },
  {
    // 占领 (task 4) an empty wild field: HandleTroop takes it over (mem_world.ownercid = cid),
    // troop → state 4, field resource adds recomputed, field tasks completed. Deterministic.
    name: 'battle: 占领 an empty wild field claims it',
    tables: BATTLE_OWNER_RECOMPUTE_IGNORE,
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      const [field] = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 and state = 0 order by wid limit 1',
      );
      const targetcid = wid2cid(Number(field?.wid ?? 0));
      // Player (uid 1002) marker troop in state 2 suppresses legacy's checkSodier NPC auto-spawn
      // (see the 掠夺-empty case); the field has no state-4 defender, so 占领 claims it. The early-out
      // deletes any troop at the field cid, so the marker is cleaned up by the branch itself.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (1002, ?, 0, ?, 5, 2, unix_timestamp(), 0, 0, '0', '0', 0, 0)`,
        [targetcid, targetcid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 4, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,100', '0', 0, 0)`,
        [uid, cid, targetcid],
      );
      await s.tick('HandleTroop');
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, targetcid]);
      await s.query('update mem_world set ownercid = 0 where wid = ?', [Number(field?.wid ?? 0)]);
    },
  },
  {
    // 攻击 (task 9) a stationed defender on a wild field: HandleTroop builds both sides and
    // inserts mem_battle; HandleBattle then advances rounds until getBattleResult settles. The
    // round target pick draws rand() — pin a short sequence so both servers resolve identically.
    name: 'battle: 攻击 a defended wild field runs to settlement',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      const [field] = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 and state = 0 order by wid limit 1',
      );
      const targetcid = wid2cid(Number(field?.wid ?? 0));
      // Attacker marching in; a small defender already stationed (state 4). The defender is a
      // PLAYER troop (uid 1002), not an NPC: legacy HandleTroop runs `checkSodier` to auto-spawn a
      // random NPC garrison on a wild field whose resolved owner is uid<1000 — an mt_rand/wall-clock
      // generator this architecture deliberately moved to the world-refresh tick. A player-stationed
      // defender makes `check_field_owner` resolve uid>=1000, so checkSodier is skipped on both sides
      // and the case tests the battle itself deterministically (ownercid stays 0, so no inwar gating).
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 9, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,2000', '0', 0, 0)`,
        [uid, cid, targetcid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (1002, ?, 0, ?, 5, 4, unix_timestamp(), 0, 0, '1,3,10', '0', 0, 0)`,
        [targetcid, targetcid],
      );
      // Pin the per-round target pick and the getBattleResult wounded/capture rolls.
      s.rng([1, 2, 1, 0, 0, 3, 1]);
      await s.tick('HandleTroop');
      // Several HandleBattle ticks drive the rounds to a verdict.
      for (let i = 0; i < 45; i++) await s.tick('HandleBattle');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, targetcid]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
      await s.query('update mem_world set state = 0 where wid = ?', [Number(field?.wid ?? 0)]);
    },
  },
  {
    // 掠夺 (task 3) a defended CITY (type 2): the won battle steals resources and turns home.
    // The target is a REAL player city (uid 1002, a city tile → battleType 2), so legacy's
    // checkSodier NPC auto-spawn is skipped (owner uid>=1000) and the defender garrison is exactly
    // what the case seeds — the resource-theft branch + report compare deterministically. task 3
    // against a non-allied player is allowed regardless of protection state (check_inwar only
    // gates transport/派遣), so no protection fixup is needed.
    name: 'battle: 掠夺 a defended city',
    tables: BATTLE_OWNER_RECOMPUTE_IGNORE,
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const TARGET_CITY = 188128; // player 1002's city
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, TARGET_CITY]);
      // A tiny, fixed garrison; clear any stationed defence hero so defcityadd resolves hero 0.
      await s.query('delete from sys_city_soldier where cid = ?', [TARGET_CITY]);
      await s.query('insert into sys_city_soldier (cid, sid, count) values (?, 3, 5)', [
        TARGET_CITY,
      ]);
      await s.query('update sys_city_hero set state = 0 where cid = ? and state in (1,7)', [
        TARGET_CITY,
      ]);
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 3, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,3000', '0', 0, 0)`,
        [uid, cid, TARGET_CITY],
      );
      s.rng([1, 1, 2, 0, 0]);
      await s.tick('HandleTroop');
      for (let i = 0; i < 45; i++) await s.tick('HandleBattle');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, TARGET_CITY]);
      await s.query('delete from sys_city_soldier where cid = ?', [TARGET_CITY]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
    },
  },
  {
    // The round engine's wall phase: a type-1 city battle with the wall standing. Drives one
    // mem_battle round directly (seeded) and compares the mem_battle delta (wallhp/positions).
    name: 'battle: city attack wall phase advances one round',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const bid = 991001;
      await s.query('delete from mem_battle where id = ?', [bid]);
      await s.query('delete from sys_battle where id = ?', [bid]);
      await s.query('delete from mem_battle_tactics where battleid = ?', [bid]);
      await s.query(
        `insert into sys_battle (id, type, attackuid, resistuid, attacktroop, state, result, cid, resistdefence)
         values (?, 1, ?, 1002, 0, 0, 0, ?, '')`,
        [bid, uid, FOREIGN_CITY],
      );
      // A type-1 (攻城) battle, wall up, attacker at the gate, due now.
      await s.query(
        `insert into mem_battle
          (id, type, nexttime, round, attackcid, attackhid, attacksoldiers, attackpos, attackadd,
           resistcid, resisthid, resistsoldiers, resistpos, resistadd, resistdefence, wallhp,
           walllevel, fieldrange, state, level)
         values (?, 1, unix_timestamp() - 1, 1, ?, 0, '1,1,1000', '1,1,200',
           '1,1,50,50,30,100,100,50,30,100,0', ?, 0, '0', '0', '', '1,1,1,10', 1000000, 1, 1000, 4, 0)`,
        [bid, cid, FOREIGN_CITY],
      );
      s.rng([1]);
      await s.tick('HandleBattle');
      s.stopRng();
      await s.query('delete from mem_battle where id = ?', [bid]);
      await s.query('delete from sys_battle where id = ?', [bid]);
      await s.query('delete from mem_battle_tactics where battleid = ?', [bid]);
      await s.query('delete from sys_battle_report where battleid = ?', [bid]);
    },
  },
  {
    // checkSodier (UtilsExtend.php) — the on-demand NPC garrison respawn. A 攻击 (task 9) against an
    // UNOWNED wild field whose resolved owner is uid<1000 (no stationed troop → field.uid 0): legacy
    // HandleTroop runs `checkSodier($field)` on arrival, which draws `mt_rand(0,5)` (NPC pick) and
    // createmapSoldier's per-type `rand()` to spawn a fresh NPC troop, then the battle meets it. The
    // scripted RNG pins every draw so both servers spawn the IDENTICAL garrison and fight the same
    // battle (report text included). The field is level 3 (cfg_field_npcvalue 5000) to keep the
    // spawned force — and the battle — small.
    name: 'battle: 攻击 an unowned NPC field respawns a garrison and fights',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      // A free, low-level wild field (level 3), no stationed troop → check_field_owner resolves
      // uid 0 (<1000) and checkSodier spawns the NPC garrison.
      const FIELD_WID = 14;
      const targetcid = wid2cid(FIELD_WID);
      await s.query('delete from sys_troops where cid = ?', [targetcid]);
      await s.query('delete from mem_world_schedule where wid = ?', [FIELD_WID]);
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 9, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,2000', '0', 0, 0)`,
        [uid, cid, targetcid],
      );
      // RNG: [0] → mt_rand(0,5)=0 (NPC-type default '13,14,15,16,17'); the next five raw rand()
      // feed createmapSoldier's `rand() % (100-totalRnd)`; the remainder drive the battle rounds'
      // target pick and getBattleResult wounded/capture rolls. Same sequence on both sides.
      s.rng([0, 40, 30, 20, 10, 50, 1, 2, 1, 0, 0, 3, 1]);
      await s.tick('HandleTroop');
      for (let i = 0; i < 45; i++) await s.tick('HandleBattle');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, targetcid]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
      await s.query('delete from mem_world_schedule where wid = ?', [FIELD_WID]);
      await s.query('update mem_world set state = 0 where wid = ?', [FIELD_WID]);
    },
  },
  {
    // The check_inwar arrival gate (UtilsExtend.php:459-487): a scout (task 2) whose target field
    // is held by the SCOUTING PLAYER'S OWN CITY (mem_world.ownercid == the troop's origin cid). The
    // original refuses the arrival at the send-side rule's mirror image — 侦察 of a self/allied
    // target is only_towards_enemy — so the troop turns home (state 1) and the report carries
    // 「只能侦察非同盟的城池或野地。」 instead of the 对方未发觉 settlement. Found by the 24h
    // settlement comparison. The report and the returning troop are left in place so the net delta
    // (unlike the settles-an-empty-field case, which deletes them and therefore cannot see the
    // difference) actually compares the outcome; later cases delete this player's rows on entry.
    name: 'troop tick refuses a scout of an own field (only_towards_enemy)',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid = ?', [uid]);
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1) on duplicate key update report = 1',
        [uid],
      );
      const [tile] = await s.query<{ wid: string }>(
        'select wid from mem_world where ownercid = 0 and type > 1 and state = 0 order by wid limit 1',
      );
      const fieldWid = Number(tile?.wid ?? 0);
      const targetCid = wid2cid(fieldWid);
      // The field belongs to the scouting player's own city → check_inwar sets targetIsUnion.
      await s.query('update mem_world set ownercid = ? where wid = ?', [cid, fieldWid]);
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,3,100', '0', 0, 0)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleTroop');
      await s.query('update mem_world set ownercid = 0 where wid = ?', [fieldWid]);
    },
    tables: SCOUT_RESOURCE_IGNORE,
  },
  {
    // checkSodier via the SCOUT path (cfg_js.php line 129: `if($field['uid']<1000) checkSodier`).
    // A 侦察 (task 2) of an UNOWNED NPC wild field (uid<1000): HandleTroop respawns the NPC garrison
    // on arrival, then the scout's 军队状况 intel tier reports the respawned troop. The scripted RNG
    // pins the NPC pick + createmapSoldier draws so both servers spawn the same garrison and the
    // report (fuzzy count_desc for a wild field, te_level bumped to 6) is byte-identical. No patrol
    // (the spawned default-type garrison carries no 斥候/sid-3), so the scout is deterministic.
    name: 'troop tick settles a scout of an NPC field (garrison respawn)',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_troops where uid = ?', [uid]);
      await s.query('delete from sys_report where uid = ?', [uid]);
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1) on duplicate key update report = 1',
        [uid],
      );
      const FIELD_WID = 14; // free, low-level (3) wild field; no owner → checkSodier respawns.
      const targetCid = wid2cid(FIELD_WID);
      await s.query('delete from sys_troops where cid = ?', [targetCid]);
      await s.query('delete from mem_world_schedule where wid = ?', [FIELD_WID]);
      await s.query(
        `insert into sys_city_technic (cid, tid, level) values (?, 7, 5)
          on duplicate key update level = 5`,
        [cid],
      );
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,3,100', '0', 0, 0)`,
        [uid, cid, targetCid],
      );
      // [0] → NPC-type default; next five raw rand() → createmapSoldier counts. Same on both sides.
      s.rng([0, 40, 30, 20, 10, 50]);
      await s.tick('HandleTroop');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, targetCid]);
      await s.query('delete from sys_report where uid = ?', [uid]);
      await s.query('delete from mem_world_schedule where wid = ?', [FIELD_WID]);
      await s.query('update mem_world set state = 0 where wid = ?', [FIELD_WID]);
    },
    tables: SCOUT_RESOURCE_IGNORE,
  },
  {
    // 占领 (task 4) ARRIVAL at an NPC CITY (type==0 tile, uid<1000, level>0). This is Part-2c: on
    // arrival cfg_js.php:404 runs checkSodier, which for an NPC city with a positive level runs
    // createCityDefence (the city's did-1/2 defences top up) AND respawns the NPC garrison, then
    // defcityadd/battleAdd build the wall battle (mem_battle). Target 黄巾 city 11037 (province 10,
    // level 2) whose chief hero sits in state 1, so checkSodier's choseHero resolves deterministically
    // (no `order by rand()`). The actual multi-round wall grind cannot run in the harness (each round
    // gates on nexttime = now+25), so this validates the arrival writes — defences, garrison, battle
    // setup — which is where checkSodier's NPC-city branch lives; the SETTLEMENT (占城/抓将) is covered
    // by the next case. Seeded RNG pins the garrison respawn identically on both sides.
    name: 'battle: 占领 arrival at an NPC city respawns defences and garrison, sets up the wall battle',
    tables: NPC_CITY_CAPTURE_IGNORE,
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const TARGET = 11037; // 黄巾 NPC city, level 2, province 10, chief hero 77430 in state 1.
      const TARGET_WID = 10317;
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, TARGET]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
      await s.query('delete from mem_world_schedule where wid = ?', [TARGET_WID]);
      // A siege army marching in (task 4). field.type==0 (city) so there is NO overwhelming-force
      // early win — HandleTroop runs checkSodier (createCityDefence + garrison) then builds the
      // mem_battle via defcityadd/battleAdd.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 4, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '2,1,30000,12,6000', '0', 0, 0)`,
        [uid, cid, TARGET],
      );
      // [0] → checkSodier NPC pick; the five raw draws feed createmapSoldier. Same on both sides.
      s.rng([0, 40, 30, 20, 10, 50]);
      await s.tick('HandleTroop');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, TARGET]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
      await s.query('delete from mem_world_schedule where wid = ?', [TARGET_WID]);
    },
  },
  {
    // A type-1 (攻城) NPC-city battle advancing one settled round symmetrically on BOTH engines.
    // HandleTroop builds the mem_battle (checkSodier garrison + defcityadd/battleAdd), then the wall
    // is breached (wallhp 0) and the round made due so one HandleBattle step runs it. This is the
    // first case to drive the legacy mem_battle engine (OLdBattleCron::HandleBattle, now invoked by
    // the harness — see side.ts) against the ported OldBattleService on a city battle, so the round
    // report / troop / defence / soldier mutations compare. The full takeover + 抓将 mutations
    // (sys_city.uid, sys_hero_captive, building teardown) run inside getBattleResult once a side is
    // wiped out — a 2M-hp wall garrison cannot be ground down in the harness's 25s-per-round budget,
    // so that terminal settlement is asserted directly in battle-result.spec.ts. Seeded RNG pins the
    // garrison respawn + round draws identically on both sides.
    name: 'battle: a type-1 NPC-city battle advances a settled round on both engines',
    tables: NPC_CITY_CAPTURE_IGNORE,
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const TARGET = 11037;
      const TARGET_WID = 10317;
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, TARGET]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
      await s.query('delete from mem_world_schedule where wid = ?', [TARGET_WID]);
      // force the defender chief hero catchable: loyalty 0.
      await s.query('update sys_city_hero set loyalty = 0 where hid = 77430');
      // grind the city morale to 0 so check_morale lets the takeover succeed (占领, not 掠夺) — the
      // legacy gate is `morale - min(3,morale) == 0`, i.e. morale must already be low. This column
      // is scoped out of the comparison (NPC_CITY_CAPTURE_IGNORE), so setting it is invisible to
      // the diff but flips the branch to the full city-capture + hero-capture path.
      await s.query('update mem_city_resource set morale = 0 where cid = ?', [TARGET]);
      // a siege army; field.type==0 (city) so no overwhelming early win — HandleTroop builds the
      // real mem_battle via defcityadd/battleAdd.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 4, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '2,1,30000,12,6000', '0', 0, 0)`,
        [uid, cid, TARGET],
      );
      // [0] → checkSodier NPC pick; raw draws → createmapSoldier; rest → the settling round's
      // target pick + getBattleResult wounded/capture/catchHero rolls.
      s.rng([0, 40, 30, 20, 10, 50, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1]);
      await s.tick('HandleTroop');
      // force the battle to its final round: breach the wall and make it due now, keeping the real
      // respawned garrison and its defcityadd tactics so the settling round's combat report is built
      // identically on both sides. One HandleBattle round advances the battle symmetrically on both
      // engines (the legacy mem_battle engine now runs in the harness — see side.ts). The full
      // takeover/抓将 mutations are asserted deterministically in getBattleResult's unit tests
      // (battle-result.spec.ts), which drive the end-0 type-1 path directly.
      await s.query(
        `update mem_battle set wallhp = 0, nexttime = unix_timestamp() - 1 where attackcid = ?`,
        [cid],
      );
      await s.tick('HandleBattle');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or cid = ?', [uid, TARGET]);
      await s.query('delete from mem_battle where attackcid = ?', [cid]);
      await s.query('delete from mem_world_schedule where wid = ?', [TARGET_WID]);
    },
  },
  {
    // 野地建城 (createCityFromLand, WorldFunc.php:254) error branches: 非平地 / 平地不附属 /
    // 交战中 / 旧城资源不足 / 爵位城数上限. Every throw sits before the first write, so each
    // failed command leaves the database untouched and the error text is the whole comparison.
    name: 'world: createCityFromLand error branches',
    tables: {
      mem_city_resource: { offsets: ['lastupdate'] },
      log_user_action: { offsets: ['time'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // 非平地: any wild-field tile (type > 1) fails the first check regardless of ownership.
      const [hill] = await s.query<{ wid: string }>(
        'select wid from mem_world where type > 1 and state = 0 order by wid limit 1',
      );
      await s.command(session, 'createCityFromLand', Number(hill?.wid ?? 0));
      // 平地不附属: an unowned flatland (ownercid 0 vs the player's lastcid).
      const [flat] = await s.query<{ wid: string }>(
        'select wid from mem_world where type = 1 and ownercid = 0 and state = 0 order by wid limit 1',
      );
      const wid = Number(flat?.wid ?? 0);
      await s.command(session, 'createCityFromLand', wid);
      // 交战中: own the flatland but leave it at war (state 1).
      await s.query('update mem_world set ownercid = ?, state = 1 where wid = ?', [cid, wid]);
      await s.command(session, 'createCityFromLand', wid);
      // 资源不足: peaceful owned flatland, but the founding city drops below 10000 iron.
      await s.query('update mem_world set state = 0 where wid = ?', [wid]);
      await s.query('update mem_city_resource set iron = 5000 where cid = ?', [cid]);
      await s.command(session, 'createCityFromLand', wid);
      await s.query('update mem_city_resource set iron = 1000000 where cid = ?', [cid]);
      // 爵位上限: changle is nobility 0 (city_count 1) and already holds one city.
      await s.command(session, 'createCityFromLand', wid);
    },
  },
  {
    // 野地建城 success: a held peaceful flatland with two stationed (state 4) troops becomes a new
    // city — the old city pays 10000 of each resource, the troops' resource/soldier CSVs merge in
    // (same-sid rows accumulate), the first troop's hero (the lord hero 80213) becomes 城守, both
    // troops and their tactics rows are deleted, goal 169 completes and the new city gains 5000 of
    // each resource. No RNG anywhere. The new city's rows stamp wall-clock times (lastupdate /
    // log_user_action.time), which the per-case offsets rules normalize.
    name: 'world: createCityFromLand founds a new city',
    tables: {
      mem_city_resource: { offsets: ['lastupdate'] },
      log_user_action: { offsets: ['time'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // nobility 0 caps the player at 1 city and changle already holds one — raise to 爵位 1
      // (city_count 2) for this case; the snapshot rollback puts it back.
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      const [flat] = await s.query<{ wid: string }>(
        'select wid from mem_world where type = 1 and ownercid = 0 and state = 0 order by wid limit 1',
      );
      const wid = Number(flat?.wid ?? 0);
      const target = wid2cid(wid);
      await s.query('update mem_world set ownercid = ? where wid = ?', [cid, wid]);
      // Two stationed troops: the lord hero leads the first (becomes 城守), the second carries no
      // hero. soldiers CSV is "种数,sid,数量,…"; resource CSV is "gold,food,wood,rock,iron".
      await s.query(
        `insert into sys_troops
          (id, uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values
          (900001, ?, ?, 80213, ?, 5, 4, unix_timestamp() - 600, 0, 0, '2,1,300,3,500', '1200,3400,5600,7800,9100', 0, 0),
          (900002, ?, ?, 0, ?, 5, 4, unix_timestamp() - 600, 0, 0, '1,2,50', '100,200,300,400,500', 0, 0)`,
        [uid, cid, target, uid, cid, target],
      );
      await s.query(
        `insert into sys_troop_tactics (troopid, plunder, invade, patrol, field)
         values (900001, '', '', '', '')`,
      );
      await s.command(session, 'createCityFromLand', wid);
    },
  },
  {
    // 政令 (governOthers, WorldFunc.php:547) error branches: 城池不属于自己 / 普通城 / 盟友 /
    // 封禁中 / 越出郡·州的范围 / 目标当日已被政令 / 当日次数上限. changle's 209355 (官府 15 级,
    // province 4 / jun 8) is promoted to a 名城 for the case; player 1002's 188128 (province 10 /
    // jun 5, type 5 counts as a 普通城) is the target throughout.
    name: 'world: governOthers error branches',
    tables: {
      mem_city_schedule: {
        ignore: ['next_good_event', 'next_bad_event'],
        offsets: ['last_anming', 'last_reset_recruit', 'last_govern_time', 'last_be_govern_time'],
      },
      sys_user_state: { offsets: ['forbistart', 'forbiend', 'vacstart', 'vacend'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // 城池不属于自己: the ordering "city" 188128 belongs to 1002.
      await s.command(session, 'governOthers', 0, 188128, 1002, 188128, '平原');
      // 普通城: 209355 ships as type 5, which counts as 0.
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
      // promote 209355 to a 郡城 (type 2); its 官府 is already level 15.
      await s.query('update sys_city set type = 2 where cid = 209355');
      // 盟友: both players in union 7.
      await s.query('update sys_user set union_id = 7 where uid in (1001, 1002)');
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
      await s.query('update sys_user set union_id = 0 where uid in (1001, 1002)');
      // 封禁中的目标 (the original reuses the 免战 text for this, kept as-is).
      await s.query(
        `insert into sys_user_state (uid, forbiend, vacend, reason)
         values (1002, unix_timestamp() + 3600, 0, '')`,
      );
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
      await s.query('delete from sys_user_state where uid = 1002');
      // 越出郡 (type-2 city, target in another commandery), then 越出州 as a 州城 (type 3).
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
      await s.query('update sys_city set type = 3 where cid = 209355');
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
      // 都城 (type 4) has no range gate — the daily gates apply instead.
      await s.query('update sys_city set type = 4 where cid = 209355');
      // 目标当日已被政令.
      await s.query(
        'update mem_city_schedule set last_be_govern_time = unix_timestamp() where cid = 188128',
      );
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
      await s.query('update mem_city_schedule set last_be_govern_time = 0 where cid = 188128');
      // 当日次数上限: officepos 0 caps a type-4 city at 0 政令 per day.
      await s.query(
        'update mem_city_schedule set govern_count = 5, last_govern_time = unix_timestamp() where cid = 209355',
      );
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
    },
  },
  {
    // 政令 征税 (type 0) success: a type-4 名城 (no range gate; officepos 13 → 10/day) takes a
    // tenth of the target's gold, the target is notified by report, both mem_city_schedule rows
    // stamp and the success message is thrown. 209355's schedule row ships zeroed, so the first
    // 政令 of the day opens a fresh count.
    name: 'world: governOthers 征税 takes a tenth of the gold',
    tables: {
      mem_city_schedule: {
        ignore: ['next_good_event', 'next_bad_event'],
        offsets: ['last_anming', 'last_reset_recruit', 'last_govern_time', 'last_be_govern_time'],
      },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('update sys_city set type = 4 where cid = 209355');
      await s.query('update sys_user set officepos = 13 where uid = 1001');
      await s.command(session, 'governOthers', 0, 188128, 1002, 209355, '南皮');
    },
  },
  {
    // 政令 抽丁/征粮/收编/裁军 (types 1-4) on the same day against the same target: the target's
    // last_be_govern_time is cleared between orders so each passes the once-per-day gate, and the
    // own govern_count climbs 1..4 under the type-4 / officepos-13 cap of 10. 收编 reads the
    // largest fromcity soldier row (seeded sid 1 with 1000), 裁军 the largest row of any kind
    // (sid 1 again, shaved to 980 by 收编).
    name: 'world: governOthers 抽丁/征粮/收编/裁军',
    tables: {
      mem_city_schedule: {
        ignore: ['next_good_event', 'next_bad_event'],
        offsets: ['last_anming', 'last_reset_recruit', 'last_govern_time', 'last_be_govern_time'],
      },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('update sys_city set type = 4 where cid = 209355');
      await s.query('update sys_user set officepos = 13 where uid = 1001');
      // 抽丁: 150 people → a fifth (30).
      await s.command(session, 'governOthers', 1, 188128, 1002, 209355, '南皮');
      await s.query('update mem_city_schedule set last_be_govern_time = 0 where cid = 188128');
      // 征粮: 9100 food → a tenth (910).
      await s.command(session, 'governOthers', 2, 188128, 1002, 209355, '南皮');
      await s.query('update mem_city_schedule set last_be_govern_time = 0 where cid = 188128');
      await s.query('delete from sys_city_soldier where cid = 188128');
      await s.query('insert into sys_city_soldier (cid, sid, count) values (188128, 1, 1000)');
      // 收编: 1000 of the fromcity row → a fiftieth (20), half (10) to the governor.
      await s.command(session, 'governOthers', 3, 188128, 1002, 209355, '南皮');
      await s.query('update mem_city_schedule set last_be_govern_time = 0 where cid = 188128');
      // 裁军: the same row now at 980 → a twentieth (49), nothing to the governor.
      await s.command(session, 'governOthers', 4, 188128, 1002, 209355, '南皮');
    },
  },
  {
    // 合城 (mergeCity, CityMergeFunc.php:14) error branches: 分城不是普通城 / 分城不归属 /
    // 分城有兵 / 官府不足（「召回开往分城的军队」这条 update 写在官府校验之前，原版在报错
    // 前已提交——种子军队最终 state=1 出现在两边增量里）/ 官府已满 15 级（该文案在 lang.php
    // 里缺失，原版抛空消息）。主城 209355 是 type 5（跳过名城契约校验），爵位门槛只在官府
    // 10-14 级检查；分城是在野地 wid 15 (cid 1005) 上种出来的 uid 1001 普通城。
    name: 'world: mergeCity error branches',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      // 分城不是普通城: 188128 ships as type 5.
      await s.command(session, 'mergeCity', 209355, 188128);
      // 分城不归属: NPC city 11037 (uid 894, type 0, at peace).
      await s.command(session, 'mergeCity', 209355, 11037);
      // seed the sub city on free flatland wid 15 (cid 1005, province 10): 官府 1 + 民房 2 +
      // 农田 1, a little of each resource.
      await s.query('update mem_world set type = 0, ownercid = 1005 where wid = 15');
      await s.query(
        `insert into sys_city (cid, uid, name, type, state, province)
         values (1005, 1001, '合城测试', 0, 0, 10)`,
      );
      await s.query(
        `insert into sys_building (cid, xy, bid, level)
         values (1005, 120, 6, 1), (1005, 121, 5, 2), (1005, 131, 1, 1)`,
      );
      await s.query(
        `insert into mem_city_resource (cid, people, food, wood, rock, iron, gold, lastupdate)
         values (1005, 100, 2000, 3000, 4000, 5000, 6000, 0)`,
      );
      // 分城有兵 (sid <= 12).
      await s.query('insert into sys_city_soldier (cid, sid, count) values (1005, 1, 10)');
      await s.command(session, 'mergeCity', 209355, 1005);
      await s.query('delete from sys_city_soldier where cid = 1005');
      // 官府不足: level 9 (nobility 4 — no gate below 10); a troop marching at the sub city is
      // recalled (state → 1) BEFORE the level check throws. The row stays in the delta with
      // state 1 on both sides, proving the pre-check write committed as in the original.
      await s.query('update sys_building set level = 9 where cid = 209355 and bid = 6');
      await s.query('update sys_user set nobility = 4 where uid = 1001');
      await s.query(
        `insert into sys_troops
          (id, uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (900011, 1002, 188128, 0, 1005, 5, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '0', '0', 0, 0)`,
      );
      await s.command(session, 'mergeCity', 209355, 1005);
      // 官府已满 (the shipped level 15): the government_max_level text is missing from
      // lang.php, so the original throws an empty message.
      await s.query('update sys_building set level = 15 where cid = 209355 and bid = 6');
      await s.command(session, 'mergeCity', 209355, 1005);
    },
  },
  {
    // 合城 success: the seeded sub city merges into 209355 (官府 10 → 11, nobility 4). The sub's
    // building investment becomes the upgrade budget — everything in the main city is level 15
    // except the 民房 at xy 100 dropped to 3, which is the only building below the new 官府 cap,
    // so the upgrade loop exercises a real level-up and the budget remainder returns to the main
    // city's resources. The type-5 main city skips the 名城契约 check, but reduceMingchengqiyue
    // still runs unconditionally: addGoods(-1) seeds sys_goods (1001, 160052, 0) + a log_qiyue
    // row. The merge report (title 53) diffs the before/after building tables.
    name: 'world: mergeCity merges a sub city into the main city',
    tables: {
      log_qiyue: { offsets: ['time'] },
      log_merge_city: { offsets: ['time'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('update sys_building set level = 10 where cid = 209355 and bid = 6');
      await s.query('update sys_building set level = 3 where cid = 209355 and xy = 100');
      await s.query('update sys_user set nobility = 4 where uid = 1001');
      await s.query('update mem_world set type = 0, ownercid = 1005 where wid = 15');
      await s.query(
        `insert into sys_city (cid, uid, name, type, state, province)
         values (1005, 1001, '合城测试', 0, 0, 10)`,
      );
      await s.query(
        `insert into sys_building (cid, xy, bid, level)
         values (1005, 120, 6, 1), (1005, 121, 5, 2), (1005, 131, 1, 1)`,
      );
      await s.query(
        `insert into mem_city_resource (cid, people, food, wood, rock, iron, gold, lastupdate)
         values (1005, 100, 2000, 3000, 4000, 5000, 6000, 0)`,
      );
      await s.command(session, 'mergeCity', 209355, 1005);
    },
  },
  {
    // 占城 + 抓将 (getBattleResult end-0, case 1): an overwhelming occupier takes a seeded player
    // city of uid 1002 (wid 35 — block offset 35, inside the group_concat budget). The
    // 5-strong garrison dies in the one forced round; the takeover gates pass (morale 0, the
    // attacker raised to nobility 1 = two cities, ordinary type), the defender chief hero
    // (loyalty 0) is caught via chose_hero → catchHero, and the city changes hands with its
    // schedule cooldowns reset and the occupier's soldiers moved in. The economy / tech
    // re-derive (check_city_resource / check_Technic) runs on the legacy side only and its
    // tables are scoped out, as is the settled report (its hero-card / defender-report sections
    // are not ported). 官府 4 guarantees the below-10 teardown on both sides despite the
    // rand()*4 shave; the random levels stay masked while the surviving building rows are exact.
    name: 'battle: 占城 and 抓将 settle a player-city capture',
    tables: {
      mem_city_resource: { skip: () => true },
      sys_city_res_add: { skip: () => true },
      sys_city_technic: { skip: () => true },
      sys_user_goal: { skip: () => true },
      mem_world_schedule: { skip: () => true },
      sys_building: { ignore: ['level'] },
      sys_hero_captive: { offsets: ['captivetime'] },
    },
    run: (s) => seedPlayerCityCapture(s, 0, 4, false),
  },
  {
    // 唯一普通城被占：troopsBack + moveGetCid + movecitys moves the defender to wid 499499.
    // All other province-1 flatlands are unavailable, so both order-by-rand queries have one target.
    name: 'battle: player last city relocates after capture',
    tables: {
      mem_city_resource: { skip: (row) => Number(row.cid) !== 499499 },
      sys_city_res_add: { skip: () => true },
      sys_city_technic: { skip: () => true },
      sys_user_goal: { skip: () => true },
      mem_world_schedule: { skip: () => true },
      mem_world: { skip: (row) => ![35, 499499].includes(Number(row.wid)) },
      sys_hero_captive: { offsets: ['captivetime'] },
      log_move_city: { offsets: ['time'] },
    },
    run: (s) => seedPlayerCityCapture(s, 0, 4, false, true),
  },
  {
    // 郡城前置不足：同郡有 8 座县城而攻击方没有，check_city_type must reject the takeover.
    // The failed capture falls back to resource robbery: compare the city's deduction and the
    // returning troop's carry payload directly, including gold. Only time and report scopes remain.
    name: 'battle: county capture rejects missing prerequisite cities',
    tables: {
      sys_city_res_add: { skip: () => true },
      sys_city_technic: { skip: () => true },
      sys_user_goal: { skip: () => true },
      mem_world_schedule: { skip: () => true },
      sys_hero_captive: { offsets: ['captivetime'] },
      sys_troops: { offsets: ['starttime', 'endtime'] },
    },
    run: (s) => seedPlayerCityCapture(s, 2, 10, false),
  },
  {
    // Four attacker-owned county towns also satisfy the current 11-town baseline's one-third gate.
    name: 'battle: county capture passes prerequisite cities',
    tables: {
      mem_city_resource: { skip: () => true },
      sys_city_res_add: { skip: () => true },
      sys_city_technic: { skip: () => true },
      sys_user_goal: { skip: () => true },
      mem_world_schedule: { skip: () => true },
      sys_building: { ignore: ['level'] },
      sys_hero_captive: { offsets: ['captivetime'] },
    },
    run: (s) => seedPlayerCityCapture(s, 2, 4, true),
  },
  {
    // 好友/仇人 read side (FriendFunc.php): getUserRelation compares empty on both sides (the
    // shipped game cannot add relations — the original carried the writes over the external chat
    // server, absent from the 单机包; the remaster's command-channel writes have no legacy
    // baseline and are covered by unit tests). addFriendsTaskFinish is whitelisted and lands
    // task 313's goals identically. addUserRelation/removeRelation on the legacy answer
    // `$funcName + 你异常了!!!` (whitelist), so the write-side commands are not difftested.
    name: 'friend: getUserRelation and the task finish',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getUserRelation');
      await s.command(session, 'addFriendsTaskFinish', '张三');
    },
  },
  {
    // 联盟 (UnionFunc.php wave 3a): createUnion founds 联盟[新盟] for 10000 gold (鸿胪寺 15
    // ships on 209355), registering the leader, the donate row, the level-1 union buildings,
    // the mem_union_buf change row and the 创建联盟 event; applyJoin then rejects (already in a
    // union) and getUnionApplyInvite reports the membership header. The union id is aliased.
    name: 'union: createUnion founds a union, applyJoin and the honglu view',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const ret = (await s.command(session, 'createUnion', '新盟')) as unknown[];
      const unionid = Number(ret?.[0] ?? 0);
      s.alias(unionid, '<unionid>');
      // re-founding hits the cooldown log row (same-day) and the name is taken
      await s.command(session, 'createUnion', '新盟');
      await s.command(session, 'createUnion', '另一个');
      // applyJoin while already in a union
      await s.command(session, 'applyJoin', unionid);
      // the honglu view
      await s.command(session, 'getUnionApplyInvite');
      // a second player applies to the new union
      const other = await s.login('judingwan');
      await s.command(other, 'applyJoin', unionid);
      await s.command(other, 'getUnionApplyInvite');
      // wave 3b: the leader's detail header and the member list
      await s.command(session, 'loadUnionInfo');
      await s.command(session, 'loadUnionMemberList');
      // the leader invites the applicant by name; the applicant accepts and joins
      await s.command(session, 'inviteUser', '飓鼎玩网单');
      await s.command(other, 'acceptInvite', unionid);
      await s.command(other, 'getUnionEvent', 0);
      await s.command(session, 'loadUnionMemberList');
      // the leader transfers leadership to the joined member (kicking needs a scheduled cron)
      await s.command(session, 'changeLeader', '飓鼎玩网单');
      await s.command(session, 'loadUnionInfo');
      await s.command(other, 'getUnionEvent', 0);
    },
  },
  {
    name: 'market: automatic transport scheduling commands',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [target] = await s.query<{ cid: string }>(
        'select lastcid as cid from sys_user where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const targetCid = Number(target?.cid ?? 0);
      await s.query('delete from mem_city_autotrans where uid = ?', [uid]);
      await s.query('delete from mem_user_buffer where uid = ? and buftype = 17', [uid]);
      await s.query('delete from sys_goods where uid = ? and gid = 120', [uid]);
      await s.query('update sys_building set level = 15 where cid = ? and bid = 13', [cid]);

      await s.dialog(session, cid, 13, 0, 'hasAutoTrans');
      const [now] = await s.query<{ now: string }>('select unix_timestamp() as now');
      const start = (Number(now?.now ?? 0) + 600) * 1000;
      await s.dialog(session, cid, 13, 0, 'addAutoTrans', cid, targetCid, 0, 100, 0, start - 10000);
      await s.dialog(session, cid, 13, 0, 'addAutoTrans', cid, targetCid, 0, 100, 0, start);
      await s.dialog(session, cid, 13, 0, 'addAutoTrans', cid, targetCid, 0, 1500001, 0, start);
      await s.dialog(session, cid, 13, 0, 'addAutoTrans', cid, targetCid, 0, 100, 0, start);

      await s.query('update sys_city set uid = ? where cid = ?', [uid, targetCid]);
      await s.dialog(session, cid, 13, 0, 'addAutoTrans', cid, targetCid, 0, 100, 0, start);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 120, 2)', [uid]);
      await s.dialog(session, cid, 13, 0, 'addAutoTrans', cid, targetCid, 0, 100, 0, start);
      s.offset(6, '*', 'start_time');
      await s.dialog(session, cid, 13, 0, 'hasAutoTrans');
      await s.dialog(session, cid, 13, 0, 'getAutoTrans');
      s.offset(6, '*', 'start_time');

      await s.query(
        `insert into mem_city_autotrans
        (uid, fromcid, tocid, state, trans_type, start_time, distance, cost_time, res_type, count, end_time)
        select ?, ?, ?, 0, 0, unix_timestamp() + 600, 0, 0, 0, 100, unix_timestamp() + 600
        from sys_city limit 9`,
        [uid, cid, targetCid],
      );
      await s.dialog(session, cid, 13, 0, 'hasAutoTrans');
      const [scheduled] = await s.query<{ id: string }>(
        'select id from mem_city_autotrans where uid = ? order by id limit 1',
        [uid],
      );
      await s.dialog(session, cid, 13, 0, 'removeAutoTrans', Number(scheduled?.id ?? 0));
      await s.dialog(session, cid, 13, 0, 'getAutoTrans');
      s.offset(6, '*', 'start_time');
    },
  },
  {
    name: 'market: automatic transport settles a single delivery',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [target] = await s.query<{ uid: string; cid: string }>(
        'select uid, lastcid as cid from sys_user where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const targetUid = Number(target?.uid ?? 0);
      const targetCid = Number(target?.cid ?? 0);
      await s.query('delete from mem_city_autotrans where uid = ?', [uid]);
      await s.query('delete from sys_city_trade where cid = ? and buycid = ?', [cid, targetCid]);
      await s.query('delete from sys_report where uid in (?, ?)', [uid, targetUid]);
      await s.query('delete from sys_user_goal where uid in (?, ?) and gid in (25, 26)', [
        uid,
        targetUid,
      ]);
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1), (?, 1) on duplicate key update report = 1',
        [uid, targetUid],
      );
      await s.query('update mem_city_resource set food = 1000, wood = 1000 where cid = ?', [cid]);
      await s.query('update mem_city_resource set food = 50, rock = 60 where cid = ?', [targetCid]);
      await s.query(
        `insert into mem_city_autotrans
          (uid, fromcid, tocid, state, trans_type, start_time, distance, cost_time, res_type, count, end_time)
         values (?, ?, ?, 0, 0, unix_timestamp() - 120, 0, 0, 2, 100, unix_timestamp() - 1)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleAutoTrans');
      const [market] = await s.query<{ xy: string }>(
        'select xy from sys_building where cid = ? and bid = 13',
        [cid],
      );
      const xy = Number(market?.xy ?? 0);
      const inner = Math.floor(xy / 100);
      const cell = xy % 100;
      await s.dialog(
        session,
        cid,
        13,
        (cell % 10) * 10 + Math.floor(cell / 10),
        'getBuildingInfo',
        inner,
        Math.floor(cell / 10),
        cell % 10,
        13,
      );
      s.offset(6, 2, '*', 'endtime');
      await s.tick('HandleTrade');
    },
    tables: {
      mem_city_resource: {
        ignore: ['gold_max', 'food_max', 'wood_max', 'rock_max', 'iron_max'],
      },
    },
  },
  {
    name: 'market: daily automatic transport advances after delivery',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [target] = await s.query<{ uid: string; cid: string }>(
        'select uid, lastcid as cid from sys_user where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const targetUid = Number(target?.uid ?? 0);
      const targetCid = Number(target?.cid ?? 0);
      await s.query('delete from mem_city_autotrans where uid = ?', [uid]);
      await s.query('delete from sys_city_trade where cid = ? and buycid = ?', [cid, targetCid]);
      await s.query('delete from sys_report where uid in (?, ?)', [uid, targetUid]);
      await s.query('delete from sys_user_goal where uid in (?, ?) and gid in (25, 26)', [
        uid,
        targetUid,
      ]);
      await s.query('update mem_city_resource set food = 1000 where cid = ?', [cid]);
      await s.query('update mem_city_resource set gold = 60 where cid = ?', [targetCid]);
      await s.query(
        `insert into mem_city_autotrans
          (uid, fromcid, tocid, state, trans_type, start_time, distance, cost_time, res_type, count, end_time)
         values (?, ?, ?, 0, 1, unix_timestamp() - 120, 0, 0, 4, 100, unix_timestamp() - 1)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleAutoTrans');
      await s.tick('HandleTrade');
    },
    tables: {
      mem_city_resource: {
        ignore: ['gold_max', 'food_max', 'wood_max', 'rock_max', 'iron_max'],
      },
    },
  },
  {
    name: 'market: automatic transport stops on insufficient food',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const [target] = await s.query<{ cid: string }>(
        'select lastcid as cid from sys_user where uid > 1000 and uid <> ? order by uid limit 1',
        [uid],
      );
      const targetCid = Number(target?.cid ?? 0);
      await s.query('delete from mem_city_autotrans where uid = ?', [uid]);
      await s.query('delete from sys_city_trade where cid = ? and buycid = ?', [cid, targetCid]);
      await s.query('update mem_city_resource set food = 99, iron = 1000 where cid = ?', [cid]);
      await s.query(
        `insert into mem_city_autotrans
          (uid, fromcid, tocid, state, trans_type, start_time, distance, cost_time, res_type, count, end_time)
         values (?, ?, ?, 0, 0, unix_timestamp() - 120, 0, 0, 3, 100, unix_timestamp() - 1)`,
        [uid, cid, targetCid],
      );
      await s.tick('HandleAutoTrans');
      await s.tick('HandleTrade');
    },
    tables: {
      mem_city_resource: {
        ignore: ['gold_max', 'food_max', 'wood_max', 'rock_max', 'iron_max'],
      },
    },
  },
  {
    name: 'market: merchant buys resources with money',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('update mem_city_resource set gold = 10000, food = 1000 where cid = ?', [cid]);
      await s.query('update sys_user set money = 100, gift = 100 where uid = ?', [uid]);
      for (const table of [
        'log_money',
        'log_gift',
        'log_merchant',
        'log_user_action',
        'log_action_count',
      ]) {
        await s.query(`delete from ${table} where uid = ?`, [uid]);
      }
      await s.query('delete from log_day_money where money <> 0');
      await s.query('delete from sys_user_goal where uid = ? and gid = 24', [uid]);
      await s.dialog(session, cid, 13, 0, 'buyFromMerchant', 0, 0, 0, 0, 1, 2);
      await s.dialog(session, cid, 13, 0, 'buyFromMerchant', 0, 0, 0, 0, 1, 0);
      await s.dialog(session, cid, 13, 0, 'buyFromMerchant', 1000000, 0, 0, 0, 1, 0);
      await s.dialog(session, cid, 13, 0, 'buyFromMerchant', 100, 0, 0, 0, 1, 0);
    },
  },
  {
    name: 'market: merchant buys resources with gift',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('update mem_city_resource set gold = 10000, wood = 1000 where cid = ?', [cid]);
      await s.query('update sys_user set money = 100, gift = 100 where uid = ?', [uid]);
      for (const table of [
        'log_money',
        'log_gift',
        'log_merchant',
        'log_user_action',
        'log_action_count',
      ]) {
        await s.query(`delete from ${table} where uid = ?`, [uid]);
      }
      await s.query('delete from log_day_money where money <> 0');
      await s.query('delete from sys_user_goal where uid = ? and gid = 24', [uid]);
      await s.dialog(session, cid, 13, 0, 'buyFromMerchant', 0, 10, 0, 0, 2, 1);
    },
  },
  {
    name: 'market: merchant sells resources with money',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query(
        'update mem_city_resource set gold = 100, food = 1000, wood = 1000, rock = 1000, iron = 1000 where cid = ?',
        [cid],
      );
      await s.query('update sys_user set money = 100, gift = 100 where uid = ?', [uid]);
      for (const table of [
        'log_money',
        'log_gift',
        'log_merchant',
        'log_user_action',
        'log_action_count',
      ]) {
        await s.query(`delete from ${table} where uid = ?`, [uid]);
      }
      await s.query('delete from log_day_money where money <> 0');
      await s.query('delete from sys_user_goal where uid = ? and gid = 23', [uid]);
      await s.dialog(session, cid, 13, 0, 'sellToMerchant', 10000, 0, 0, 0, 1, 0);
      await s.dialog(session, cid, 13, 0, 'sellToMerchant', 100, 0, 0, 0, 1, 0);
      await s.dialog(session, cid, 13, 0, 'sellToMerchant', 0, 0, 0, 0, 1, 1);
    },
  },
  {
    name: 'market: merchant sells resources with gift',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query(
        'update mem_city_resource set gold = 100, food = 1000, wood = 1000, rock = 1000, iron = 1000 where cid = ?',
        [cid],
      );
      await s.query('update sys_user set money = 100, gift = 100 where uid = ?', [uid]);
      for (const table of [
        'log_money',
        'log_gift',
        'log_merchant',
        'log_user_action',
        'log_action_count',
      ]) {
        await s.query(`delete from ${table} where uid = ?`, [uid]);
      }
      await s.query('delete from log_day_money where money <> 0');
      await s.query('delete from sys_user_goal where uid = ? and gid = 23', [uid]);
      await s.dialog(session, cid, 13, 0, 'sellToMerchant', 0, 0, 10, 20, 2, 1);
    },
  },
  {
    name: 'market: player sale list, cancel and accelerate',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const other = await s.login('judingwan');
      const otherCid = await lastCity(s, other.uid);
      await s.query('delete from sys_city_trade');
      await s.query('delete from mem_city_trade');
      await s.query('delete from sys_goods where uid = ? and gid = 11', [uid]);
      await s.query(
        'update mem_city_resource set food = 1000, wood = 1000, gold = 100 where cid = ?',
        [cid],
      );
      await s.query('update sys_building set level = 15 where cid in (?, ?) and bid = 13', [
        cid,
        otherCid,
      ]);
      await s.dialog(session, cid, 13, 0, 'getUserSellData');
      await s.dialog(session, cid, 13, 0, 'sellToUser', 0, 0, 0, 0, 0);
      await s.dialog(session, cid, 13, 0, 'sellToUser', 0, 100, 100, 200, 0);
      await s.dialog(session, cid, 13, 0, 'sellToUser', 0, 100, 10, 200, 0);
      await s.dialog(session, cid, 13, 0, 'sellToUser', 1, 50, 5, 200, 0);
      const [seller] = await s.query<{ name: string }>('select name from sys_user where uid = ?', [
        uid,
      ]);
      await s.dialog(other, otherCid, 13, 0, 'getUserBuyList', 0, 0, 0, '');
      await s.dialog(other, otherCid, 13, 0, 'getUserBuyList', 0, 1, 0, seller?.name ?? '');
      const [accelerated] = await s.query<{ id: string }>(
        'select id from sys_city_trade where cid = ? and restype = 0 limit 1',
        [cid],
      );
      const tradeId = Number(accelerated?.id ?? 0);
      await s.dialog(session, cid, 13, 0, 'accelerateSell', tradeId);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 11, 1)', [uid]);
      await s.query(
        'update sys_city_trade set state = 1, buycid = ?, endtime = unix_timestamp() + 3600 where id = ?',
        [otherCid, tradeId],
      );
      await s.query(
        'replace into mem_city_trade (id, endtime) values (?, unix_timestamp() + 3600)',
        [tradeId],
      );
      await s.dialog(session, cid, 13, 0, 'accelerateSell', tradeId);
      s.offset(6, 2, '*', 'endtime');
      const [cancelled] = await s.query<{ id: string }>(
        'select id from sys_city_trade where cid = ? and restype = 1 limit 1',
        [cid],
      );
      await s.dialog(session, cid, 13, 0, 'cancelSell', Number(cancelled?.id ?? 0));
      s.offset(6, 2, '*', 'endtime');
      await s.query(
        'insert into sys_city_trade (cid, state, restype, count, price, gold) values (?, 2, 4, 10, 0, 0)',
        [cid],
      );
      const [auto] = await s.query<{ id: string }>(
        'select id from sys_city_trade where cid = ? and state = 2 limit 1',
        [cid],
      );
      await s.dialog(session, cid, 13, 0, 'cancelAutoTrans', Number(auto?.id ?? 0));
      s.offset(6, 2, '*', 'endtime');
    },
  },
  {
    name: 'market: player trade rejects distance and union errors',
    run: async (s) => {
      const seller = await s.login(EXISTING_PLAYER);
      const sellerCid = await lastCity(s, seller.uid);
      const buyer = await s.login('judingwan');
      const buyerCid = await lastCity(s, buyer.uid);
      await s.query('delete from sys_city_trade');
      await s.query('update sys_user set union_id = 0 where uid = ?', [buyer.uid]);
      await s.query('update mem_city_resource set gold = 100 where cid = ?', [buyerCid]);
      await s.query('update sys_building set level = 15 where cid = ? and bid = 13', [buyerCid]);
      await s.dialog(buyer, buyerCid, 13, 0, 'buyFromUser', 900999);
      await s.query(
        'insert into sys_city_trade (cid, state, restype, count, price, gold, distance, unionid) values (?, 0, 0, 100, 0.1, 10, 0, 0)',
        [sellerCid],
      );
      const [far] = await s.query<{ id: string }>('select id from sys_city_trade limit 1');
      await s.dialog(buyer, buyerCid, 13, 0, 'buyFromUser', Number(far?.id ?? 0));
      await s.query('update sys_city_trade set distance = 1000000000, unionid = 900 where id = ?', [
        far?.id,
      ]);
      await s.dialog(buyer, buyerCid, 13, 0, 'buyFromUser', Number(far?.id ?? 0));
      await s.query('update sys_city_trade set cid = ?, unionid = 0 where id = ?', [
        buyerCid,
        far?.id,
      ]);
      await s.dialog(buyer, buyerCid, 13, 0, 'buyFromUser', Number(far?.id ?? 0));
    },
  },
  {
    name: 'market: player purchase settles delivery to both cities',
    run: async (s) => {
      const seller = await s.login(EXISTING_PLAYER);
      const sellerCid = await lastCity(s, seller.uid);
      const buyer = await s.login('judingwan');
      const buyerCid = await lastCity(s, buyer.uid);
      await s.query('delete from sys_city_trade');
      await s.query('delete from mem_city_trade');
      await s.query('delete from sys_report where uid in (?, ?)', [seller.uid, buyer.uid]);
      await s.query('delete from sys_user_goal where uid in (?, ?) and gid in (25, 26)', [
        seller.uid,
        buyer.uid,
      ]);
      await s.query('delete from log_user_action where uid = ?', [buyer.uid]);
      await s.query('delete from log_action_count where uid = ?', [buyer.uid]);
      await s.query(
        'insert into sys_alarm (uid, report) values (?, 1), (?, 1) on duplicate key update report = 1',
        [seller.uid, buyer.uid],
      );
      await s.query('update mem_city_resource set food = 1000, gold = 50 where cid = ?', [
        sellerCid,
      ]);
      await s.query('update mem_city_resource set food = 50, gold = 100 where cid = ?', [buyerCid]);
      await s.query('update sys_building set level = 15 where cid = ? and bid = 13', [buyerCid]);
      await s.query(
        'insert into sys_city_trade (cid, state, restype, count, price, gold, distance, unionid, limittime) values (?, 0, 0, 100, 0.1, 10, 1000000000, 0, 720000)',
        [sellerCid],
      );
      const [trade] = await s.query<{ id: string }>('select id from sys_city_trade limit 1');
      const tradeId = Number(trade?.id ?? 0);
      await s.dialog(buyer, buyerCid, 13, 0, 'buyFromUser', tradeId);
      s.offset(6, 2, '*', 'endtime');
      await s.dialog(buyer, buyerCid, 13, 0, 'buyFromUser', tradeId);
      await s.query('update sys_city_trade set endtime = unix_timestamp() - 1 where id = ?', [
        tradeId,
      ]);
      await s.query('update mem_city_trade set endtime = unix_timestamp() - 1 where id = ?', [
        tradeId,
      ]);
      await s.tick('HandleTrade');
    },
    tables: {
      mem_city_resource: {
        ignore: ['gold_max', 'food_max', 'wood_max', 'rock_max', 'iron_max'],
      },
    },
  },
  {
    name: 'union: applications, offices, invitations and leaving',
    run: async (s) => {
      const leader = await s.login(EXISTING_PLAYER);
      const leaderCid = await lastCity(s, leader.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [leaderCid]);
      const created = (await s.command(leader, 'createUnion', '成员盟')) as unknown[];
      const unionid = Number(created[0]);
      s.alias(unionid, '<unionid>');
      const other = await s.login('judingwan');
      const otherName = String(
        (await s.query<{ name: string }>('select name from sys_user where uid = ?', [other.uid]))[0]
          ?.name ?? '',
      );
      await s.command(other, 'applyJoin', unionid);
      await s.command(leader, 'getApplyList', 0);
      await s.command(leader, 'acceptApply', 0, other.uid);
      await s.command(leader, 'loadUnionMemberList');

      await s.query('update sys_user set union_pos = 1 where uid = ?', [leader.uid]);
      await s.command(leader, 'setUnionProvicy', other.uid, 2);
      await s.command(other, 'demissionUnion');
      await s.query(
        'insert into sys_user_donate (uid, unionid, donate) values (?, ?, 500) on duplicate key update donate = 500',
        [other.uid, unionid],
      );
      await s.command(other, 'upgradePosition', unionid);

      await s.query('update sys_user set union_pos = 4 where uid = ?', [leader.uid]);
      await s.command(leader, 'kickMember', otherName);
      await s.command(leader, 'getKickLeavingTime');
      s.mask(4, '*', 'lefttime');
      await s.command(leader, 'cancelKickMember', other.uid);
      await s.command(leader, 'getKickLeavingTime');
      await s.command(other, 'leaveUnion');
      await s.command(leader, 'leaveUnion');

      await s.command(leader, 'inviteUser', otherName);
      await s.command(leader, 'getInviteList');
      await s.command(other, 'rejectInvite', unionid);
      await s.command(leader, 'inviteUser', otherName);
      await s.command(leader, 'cancelInvite', other.uid);
      await s.command(other, 'applyJoin', unionid);
      await s.command(other, 'cancelApply');
    },
  },
  {
    name: 'union: profile, external detail and military reports',
    run: async (s) => {
      const leader = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, leader.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [cid]);
      const created = (await s.command(leader, 'createUnion', '简介盟')) as unknown[];
      const unionid = Number(created[0]);
      s.alias(unionid, '<unionid>');
      await s.command(leader, 'getUnionIntro');
      await s.command(leader, 'modifyIntro', '新简介盟', '联盟简介', '联盟公告', 1);
      await s.command(leader, 'getUnionIntro');
      await s.command(leader, 'modifyIntro', '', '联盟简介', '联盟公告', 1);
      await s.command(leader, 'loadUnionDetail', unionid);
      await s.command(leader, 'loadUnionDetail', 900999);
      await s.command(leader, 'getUnionReport', 0);
      await s.query(
        'insert into sys_union_report (unionid, type, enemy, time, description, origincid, origincity, happencid, happencity) values (?, 1, 0, unix_timestamp(), "军情详情", 1, "起源", 2, "目标")',
        [unionid],
      );
      await s.command(leader, 'getUnionReport', 0);
      const [report] = await s.query<{ id: string }>(
        'select id from sys_union_report where unionid = ?',
        [unionid],
      );
      await s.command(leader, 'getUnionReportDetail', Number(report?.id ?? 0));
    },
  },
  {
    name: 'union: diplomacy accept, reject and removal',
    run: async (s) => {
      const first = await s.login(EXISTING_PLAYER);
      const firstCid = await lastCity(s, first.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [firstCid]);
      const firstUnion = Number(
        ((await s.command(first, 'createUnion', '外交甲')) as unknown[])[0],
      );
      s.alias(firstUnion, '<unionid1>');
      const second = await s.login('judingwan');
      const secondCid = await lastCity(s, second.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [secondCid]);
      const secondUnion = Number(
        ((await s.command(second, 'createUnion', '外交乙')) as unknown[])[0],
      );
      s.alias(secondUnion, '<unionid2>');

      await s.command(first, 'addUnionRelationByName', 0, '外交乙');
      await s.command(second, 'getRequestList');
      await s.command(second, 'pendingFriendly', 1, firstUnion);
      await s.command(first, 'getUnionRelation', 0);
      await s.command(first, 'removeUnionRelation', 0, secondUnion);
      await s.command(first, 'getUnionRelation', 1);

      await s.command(first, 'addUnionRelationByName', 0, '外交乙');
      await s.command(second, 'pendingFriendly', 0, firstUnion);
      await s.command(first, 'addUnionRelationByName', 2, '外交乙');
      await s.command(first, 'getUnionRelation', 2);
      await s.command(first, 'removeUnionRelation', 2, secondUnion);
      await s.command(first, 'getUnionRelation', 1);
    },
  },
  {
    name: 'union: city initialization, influence areas and store',
    run: async (s) => {
      const first = await s.login(EXISTING_PLAYER);
      const firstCid = await lastCity(s, first.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [firstCid]);
      const firstUnion = Number(
        ((await s.command(first, 'createUnion', '势力甲')) as unknown[])[0],
      );
      s.alias(firstUnion, '<unionid1>');
      await s.command(first, 'loadUnionRewardData');
      await s.query(
        'insert into rank_union (uid, name, leader, member, famouscity, prestige) values (?, "势力甲", "长乐", 1, 0, 0)',
        [firstUnion],
      );
      await s.query(
        'insert into sys_union_reward (`rank`, unionid, uid, pos, time) values (1, ?, ?, 5, 0)',
        [firstUnion, first.uid],
      );
      await s.command(first, 'getUnionReward', firstUnion);
      s.offset(6, 0, 1, 'getrewardtime');
      await s.command(first, 'getUnionReward', firstUnion);
      await s.command(first, 'loadUnionRewardData');
      s.offset(6, 1, 'getrewardtime');
      await s.command(first, 'loadUnionChiefCityInfo');
      await s.command(first, 'donateGoodsInitData');
      await s.command(first, 'updatePositionInitData');
      await s.command(first, 'getUnionStoreInfo');
      await s.command(first, 'getSelfUnionArea');
      await s.command(first, 'getFriendlyUnionArea');
      await s.command(first, 'getHostileUnionArea');
      await s.command(first, 'getOtherUnionArea', firstUnion);

      await s.query(
        'insert into sys_city (cid, uid, name, type) values (900001, ?, "测试郡城", 2)',
        [first.uid],
      );
      const second = await s.login('judingwan');
      const secondCid = await lastCity(s, second.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [secondCid]);
      await s.query('insert into sys_building (cid, xy, bid, level) values (?, 110, 12, 2)', [
        secondCid,
      ]);
      const secondUnion = Number(
        ((await s.command(second, 'createUnion', '势力乙')) as unknown[])[0],
      );
      s.alias(secondUnion, '<unionid2>');
      await s.command(first, 'addUnionRelationByName', 0, '势力乙');
      await s.command(second, 'pendingFriendly', 1, firstUnion);
      await s.command(first, 'getFriendlyUnionArea');
      await s.query('update sys_union_relation set type = 2, time = 1');
      await s.command(first, 'getHostileUnionArea');
      await s.command(first, 'getSelfUnionInfo');
      await s.command(first, 'getSelfUnionInfo2');
      await s.command(first, 'markCity', 900001);
      await s.command(first, 'getOtherUnionArea', firstUnion);
    },
  },
  {
    name: 'rank pages regular leaderboards and empty tables',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('delete from rank_user_level');
      for (let rank = 1; rank <= 12; rank++) {
        await s.query('insert into rank_user_level (`rank`, uid, name) values (?, ?, ?)', [
          rank,
          session.uid,
          rank === 12 ? '长乐' : `君主${rank}`,
        ]);
      }
      await s.query('delete from rank_rich');
      await s.query(
        'insert into rank_rich (uid, name, total, month, day) values (?, "长乐", 100, 80, 20)',
        [session.uid],
      );
      await s.query('delete from rank_rich_day');
      await s.command(session, 'getPageRank', 0, 'KingRankTotal');
      await s.command(session, 'getPageRank', 1, 'KingRankTotal');
      await s.command(session, 'getRankRank', 12, 'KingRankTotal');
      await s.command(session, 'getPageRank', 2, 'KingRankTotal');
      for (const type of [
        'user',
        'union',
        'hero_level',
        'hero_affairs',
        'hero_bravery',
        'hero_wisdom',
        'hero_command',
        'military',
        'military_attack',
        'military_defence',
        'rich',
        'rich_month',
        'battle_total',
        'battle_week',
        'battle_day',
      ]) {
        await s.command(session, 'getPageRank', 0, type);
      }
      await s.command(session, 'getPageRank', 0, 'rich_day');
    },
  },
  {
    name: 'rank searches names and finds own rank with task completion',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getNameRank', '长乐', 'user');
      s.unordered(4);
      await s.command(session, 'getNameRank', '不存在', 'user');
      await s.command(session, 'getMyRank', '长乐', 'user');
      await s.command(session, 'getMyRank', '长乐', 'military');
      await s.command(session, 'getMyRank', '长乐', 'military_attack');
      await s.command(session, 'getMyRank', '长乐', 'military_defence');
      await s.command(session, 'getMyRank', '不存在', 'user');
    },
  },
  {
    name: 'rank rewards pays an ended activity once',
    tables: {
      cfg_activity_rank: { offsets: ['starttime', 'endtime', 'reward_endtime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getRankReward', 'activity');
      await s.query(
        `insert into cfg_activity_rank (actid, starttime, endtime, reward_endtime, title, \`desc\`)
         values (900001, unix_timestamp() - 259200, unix_timestamp() - 86400,
           unix_timestamp() + 86400, '积分,声望,荣誉', '测试活动')`,
      );
      await s.query(
        "insert into cfg_activity_rank_reward (actid, minrank, maxrank, reward) values (900001, 1, 1, '2,0,1,5,0,0,25')",
      );
      await s.query(
        `insert into rank_activity (\`rank\`, uid, name, sort3, sort4, sort5)
         values (1, ?, '长乐', '100', '200', '300')`,
        [session.uid],
      );
      await s.query(
        `insert into log_activity_rank (actid, \`rank\`, uid, name, sort3, sort4, sort5, reward, time)
         values (900001, 1, ?, '长乐', '100', '200', '300', 0, 0)`,
        [session.uid],
      );
      await s.command(session, 'getRankConfig', 'activity');
      activityConfigTimes(s);
      await s.command(session, 'getRankConfig', 'activity_today');
      activityConfigTimes(s);
      await s.command(session, 'getRankReward', 'activity');
      await s.command(session, 'getRankConfig', 'activity');
      activityConfigTimes(s);
      await s.command(session, 'getRankReward', 'activity');
      await s.command(session, 'getRankReward', 'invalid');
    },
  },
  {
    name: 'rank rewards pays yesterday once',
    tables: {
      cfg_activity_rank: { offsets: ['starttime', 'endtime', 'reward_endtime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query(
        `insert into cfg_activity_rank (actid, starttime, endtime, reward_endtime, title, \`desc\`)
         values (900002, unix_timestamp() - 259200, unix_timestamp() - 86400,
           unix_timestamp() + 86400, '杀敌,声望,荣誉', '昨日活动')`,
      );
      await s.query(
        "insert into cfg_activity_rank_reward_day (actid, day, minrank, maxrank, reward) values (900002, 3, 1, 1, '1,0,1,5')",
      );
      await s.query(
        `insert into rank_activity_yesterday (\`rank\`, uid, name, sort3, sort4, sort5)
         values (1, ?, '长乐', '100', '200', '300')`,
        [session.uid],
      );
      await s.query(
        `insert into log_activity_rank_day (actid, day, \`rank\`, uid, name, sort3, sort4, sort5, reward, time)
         values (900002, 3, 1, ?, '长乐', '100', '200', '300', 0, 0)`,
        [session.uid],
      );
      await s.command(session, 'getRankConfig', 'activity_yesterday');
      activityConfigTimes(s);
      await s.command(session, 'getRankReward', 'activity_yesterday');
      await s.command(session, 'getRankConfig', 'activity_yesterday');
      activityConfigTimes(s);
      await s.command(session, 'getRankReward', 'activity_yesterday');
    },
  },
  {
    name: 'rank rewards checks king eligibility and window',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.query('delete from log_user_level where uid = ?', [session.uid]);
      await s.query(
        'insert into log_user_level (uid, `rank`, name, reward, time) values (?, 1, "长乐", 0, 0)',
        [session.uid],
      );
      await s.command(session, 'getRankConfig', 'KingRankTotal');
      await s.command(session, 'getRankReward', 'KingRankTotal');
      await s.command(session, 'getRankConfig', 'KingRankTotal');
      await s.command(session, 'getRankReward', 'KingRankTotal');
      await s.query('update log_user_level set `rank` = 101, reward = 0 where uid = ?', [
        session.uid,
      ]);
      await s.command(session, 'getRankReward', 'KingRankTotal');
      await s.query('update mem_state set value = unix_timestamp() where state = 6');
      await s.command(session, 'getRankConfig', 'KingRankTotal');
      await s.command(session, 'getRankReward', 'KingRankTotal');
    },
  },
  {
    // 幕僚统计 (StatFunc.php): the five read-only tabs (0 城池/1 资源/2 产量/3 将领/4 军队/
    // 5 城防) compare verbatim — no writes anywhere.
    name: 'stat: getStats reads the five tabs',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      await s.command(session, 'getStats', 0);
      await s.command(session, 'getStats', 1);
      await s.command(session, 'getStats', 2);
      await s.command(session, 'getStats', 3);
      await s.command(session, 'getStats', 4);
      await s.command(session, 'getStats', 5);
    },
  },
  {
    // 计谋只读命令 (TrickFunc.php getTrickList + BufferFunc.php getTrickBuffer): the 锦囊 sum
    // drives getTrickList's second slot; the buffer panel returns [now, live mem_city_buffer rows].
    name: 'trick: trick list and city buffer panel',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.command(session, 'getTrickList');
      await s.query('update sys_goods set count = 5 where uid = ? and gid = 13', [uid]);
      await s.command(session, 'getTrickList');
      // A foreign city is rejected.
      await s.command(session, 'getTrickBuffer', FOREIGN_CITY);
      // No live buffers yet.
      await s.command(session, 'getTrickBuffer', cid);
      // Live rows of the trick buffer types (an expired row stays out).
      await s.query(
        `insert into mem_city_buffer (cid, buftype, bufparam, endtime) values
          (?, 1, 6, unix_timestamp() + 600), (?, 8, 0, unix_timestamp() + 1200),
          (?, 27, 0, unix_timestamp() + 1800), (?, 2, 7, unix_timestamp() - 600)`,
        [cid, cid, cid, cid],
      );
      await s.command(session, 'getTrickBuffer', cid);
      s.mask(4, 1, '*', 'endtime'); // inserted per side, a second apart
    },
  },
  {
    // useTrick 的全部前置校验 (TrickFunc.php:692-818): every branch throws before any write, so
    // the comparison is the [0, message] replies only — no RNG, no jinnang or energy changes.
    name: 'trick: useTrick validation errors',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      // No jinnang yet: the raw not_enough_goods13#N string (client buy dialog).
      await s.command(session, 'useTrick', hid, 6, 1, FOREIGN_CITY);
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      // Unknown trick and a usetype mismatch.
      await s.command(session, 'useTrick', hid, 999, 0, 0);
      await s.command(session, 'useTrick', hid, 1, 1, FOREIGN_CITY);
      // Unknown hero.
      await s.command(session, 'useTrick', 99999, 1, 0, 0);
      // A hero away from the city cannot cast own-city tricks (tricktype 2 is exempt).
      await s.query('update sys_city_hero set state = 2 where hid = ?', [hid]);
      await s.command(session, 'useTrick', hid, 1, 0, 0);
      await s.command(session, 'useTrick', hid, 10, 2, 900401);
      await s.query('update sys_city_hero set state = 0 where hid = ?', [hid]);
      // Enemy-city prechecks.
      await s.command(session, 'useTrick', hid, 6, 1, cid);
      await s.query('update sys_user set union_id = 77 where uid in (1001, 1002)');
      await s.command(session, 'useTrick', hid, 6, 1, FOREIGN_CITY);
      await s.query('update sys_user set union_id = 0 where uid in (1001, 1002)');
      await s.query(
        'insert into sys_user_state (uid, vacend, reason) values (1002, unix_timestamp() + 600, "")',
      );
      await s.command(session, 'useTrick', hid, 6, 1, FOREIGN_CITY);
      await s.query(
        'update sys_user_state set vacend = 0, forbiend = unix_timestamp() + 600 where uid = 1002',
      );
      await s.command(session, 'useTrick', hid, 6, 1, FOREIGN_CITY);
      await s.query('delete from sys_user_state where uid = 1002');
      // Own-troop prechecks: no such troop, no leading hero, wrong state, just ran.
      await s.command(session, 'useTrick', hid, 10, 2, 99999);
      await s.query(
        `insert into sys_troops (id, uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource)
         values (900401, ?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 1200,
           unix_timestamp() + 600, '1,3,100', '0')`,
        [uid, cid, FOREIGN_CITY],
      );
      await s.command(session, 'useTrick', hid, 10, 2, 900401);
      await s.query('update sys_troops set state = 4 where id = 900401');
      await s.command(session, 'useTrick', hid, 10, 2, 900401);
      await s.query(
        'update sys_troops set state = 1, lastrun = unix_timestamp() where id = 900401',
      );
      await s.command(session, 'useTrick', hid, 10, 2, 900401);
      s.mask(1); // the wait counts down
      // Incoming-enemy prechecks (tricktype 3): empty target and a non-arriving troop.
      await s.command(session, 'useTrick', hid, 11, 3, 99999);
      await s.query('update sys_troops set state = 1 where id = 900401');
      await s.command(session, 'useTrick', hid, 11, 3, 900401);
      await s.command(session, 'useTrick', hid, 12, 3, 99999);
      // cfg_trick 5 rides usetype 2 (an original data quirk): its 暗度陈仓 gate reads $targetcid,
      // which tricktype 2 never sets — the 十面埋伏 buffer lookup misses and the trick fails.
      await s.query('update sys_troops set state = 0 where id = 900401');
      await s.command(session, 'useTrick', hid, 5, 2, 900401);
      // Energy drain blocks the cast.
      await s.query('update mem_hero_blood set energy = 0 where hid = ?', [hid]);
      await s.command(session, 'useTrick', hid, 1, 0, 0);
    },
  },
  {
    // 本城四计 (TrickFunc.php trickCaoMuJieBin/KongCheng/PaoZhuangYingYu/JinBiQingYe): the
    // scripted RNG pins each rate (5+draw%6 / 10+draw%11); the success texts embed MakeEndTime,
    // which runs a second apart on the two engines — the buffers carry the real assertion.
    name: 'trick: own-city tricks spend jinnang and energy',
    tables: { mem_troops_buffer: { offsets: ['endtime'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      // The scripted sequence restarts on every request, so each cast arms its own draw:
      // 草木皆兵 rate 5+1%6=6, 空城计 10+13%11=12, 抛砖引玉 5, 坚壁清野 10+25%11=13.
      for (const [trickid, draw] of [
        [1, 1],
        [2, 13],
        [3, 0],
        [4, 25],
      ] as const) {
        s.rng([draw]);
        await s.command(session, 'useTrick', hid, trickid, 0, 0);
        s.mask(4, 0); // "…,持续时间至<MakeEndTime>"
      }
      s.stopRng();
      // The buffers landed with the pinned bufparams and running end times.
      await s.command(session, 'getTrickBuffer', cid);
      s.mask(4, 1, '*', 'endtime'); // the trick endtimes ran one request apart
      // An empty energy pool blocks the cast.
      await s.query('update mem_hero_blood set energy = 0 where hid = ?', [hid]);
      await s.command(session, 'useTrick', hid, 1, 0, 0);
    },
  },
  {
    // 敌城三计 (trickYaoYinHuoZhong/ChenHuoDaJie/FenShaoLiangCao): first cast succeeds and writes
    // the 24h/6h city cooldown, the immediate second cast answers the fail text — every reply and
    // report text is deterministic (no MakeEndTime), so they compare verbatim.
    name: 'trick: enemy-city tricks drain morale, food and protection',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      const target = 188128; // uid 1002's 州城: morale 90, food 9100, cooldown stamps 0
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      for (const trickid of [6, 15, 20]) {
        await s.command(session, 'useTrick', hid, trickid, 1, target);
        await s.command(session, 'useTrick', hid, trickid, 1, target);
      }
    },
  },
  {
    // 挑拨离间 (trickTiaoBoLiJian) plus the chief-wisdom roll, on a purpose-built target city so
    // the original's `order by rand()` always has exactly one candidate per pick; 围魏救赵/
    // 调虎离山 recall the target's marches.
    name: 'trick: instigate defenders, chief roll and recall tricks',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      const target = 300005; // a fresh uid-1002 city: no defenders beyond the two inserted below
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      await s.query(
        "insert into sys_city (cid, uid, name, type, state, province) values (?, 1002, '计谋靶城', 0, 0, 10)",
        [target],
      );
      await s.query('insert into mem_city_schedule (cid) values (?)', [target]);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, wisdom_base,
           loyalty, herotype)
         values (900501, 1002, '守将甲', 0, 0, ?, 0, 1, 30, 100, 1000),
                (900502, 1002, '军师乙', 0, 0, ?, 0, 1, 200, 100, 1000)`,
        [target, target],
      );
      // The target city keeps marches for 围魏救赵 (900505) and a 以逸待劳 one for 调虎离山 (900506).
      const troop = `insert into sys_troops
          (id, uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
        values (?, 1002, ?, 60, ?, 2, 0, unix_timestamp() - 600, 1200,
          unix_timestamp() + 600, '1,3,100', '0')`;
      await s.query(troop, [900505, target, cid]);
      await s.query(troop, [900506, target, cid]);
      await s.query(
        `insert into mem_troops_buffer (troopid, buftype, bufparam, endtime)
         values (900506, 26, '', 2000000000)`,
      );
      // Chief roll lost: 城守 军师乙 (智谋 200) out-rolls the caster — 1+199%200 = 200 > 60.
      await s.query('update sys_city set chiefhid = 900502 where cid = ?', [target]);
      s.rng([199]);
      await s.command(session, 'useTrick', hid, 15, 1, target);
      // 挑拨离间 skips the chief roll (TrickFunc.php:827) — restore the empty chiefship.
      await s.query('update sys_city set chiefhid = 0 where cid = ?', [target]);
      s.rng([0]); // every request draws seq[0]: the roll 1+0%90 answers 1 ≤ 60
      // No in-city hero to catch the slander.
      await s.query('update sys_city_hero set state = 2 where hid in (900501, 900502)');
      await s.command(session, 'useTrick', hid, 7, 1, target);
      await s.query('update sys_city_hero set state = 0 where hid = 900501');
      // 守将甲 loses ceil(60/10)=6 loyalty, the 24h hero cooldown starts.
      await s.command(session, 'useTrick', hid, 7, 1, target);
      // Same hero inside the cooldown window (the cooldown answers before any roll).
      await s.command(session, 'useTrick', hid, 7, 1, target);
      // 军师乙 out-rolls the caster: 1+259%260 = 260 > 60 (900501 leaves the candidacy first).
      s.rng([259]);
      await s.query('update sys_city_hero set state = 2 where hid = 900501');
      await s.query('update sys_city_hero set state = 0 where hid = 900502');
      await s.command(session, 'useTrick', hid, 7, 1, target);
      s.stopRng();
      // 调虎离山 recalls only the 以逸待劳 troops; 围魏救赵 recalls whatever still marches.
      await s.command(session, 'useTrick', hid, 27, 1, target);
      await s.command(session, 'useTrick', hid, 19, 1, target);
      // A second 围魏 inside the 24h city cooldown fails.
      await s.command(session, 'useTrick', hid, 19, 1, target);
    },
  },
  {
    // 十面埋伏/上屋抽梯 (trickShiMianMaiFu/ShangWuChouTi) and the mem_city_buffer gates the rest
    // of the game reads: 出征 blocked by 十面埋伏 (buftype 8), released by 暗度陈仓 (5), allied
    // reinforcements blocked by 上屋抽梯 (28). Their reports embed MakeEndTime — masked; the
    // replies carry only MakeTimeLeft durations and compare verbatim.
    name: 'trick: blockade tricks and the startTroop buffer gates',
    tables: {
      sys_report: { map: { content: () => '<masked>' } },
      mem_troops_buffer: { offsets: ['endtime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      const target = 188128; // uid 1002's city: schedule cooldown stamps 0, so first casts run
      const marchTarget = 188128; // a real world tile for the 出征 gate probes
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      await s.command(session, 'useTrick', hid, 8, 1, target);
      await s.command(session, 'useTrick', hid, 8, 1, target); // 24h city cooldown
      await s.command(session, 'useTrick', hid, 28, 1, target);
      // The 5h cooldown only answers cleanly one second after the cast (a same-second delta=0
      // trips the original's `0 == false` re-insert, which dies with the PearDB error).
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await s.command(session, 'useTrick', hid, 28, 1, target); // 5h city cooldown
      // With the schedule row gone the cast re-seeds last_trick_shangwuchouti=0 and succeeds.
      await s.query('delete from mem_city_schedule where cid = ?', [target]);
      await s.command(session, 'useTrick', hid, 28, 1, target);
      // 出征 with the blockade live: the gate error text counts down the remaining seconds.
      await s.query('delete from sys_troops where uid = ? and cid = ?', [uid, cid]);
      await s.query(
        `insert into mem_city_buffer (cid, buftype, bufparam, endtime)
         values (?, 8, 0, unix_timestamp() + 600)`,
        [cid],
      );
      const march = (task: number) =>
        s.dialog(session, cid, 8, 40, 'StartTroop', 0, marchTarget, task, 0, '0', '0,0,0,0,0,');
      await march(3);
      s.mask(1); // the blockade error counts down the remaining seconds
      // 暗度陈仓 opens the gate; the 掠夺 cast then fails on the missing hero instead.
      await s.query(
        `insert into mem_city_buffer (cid, buftype, bufparam, endtime)
         values (?, 5, 0, unix_timestamp() + 600)
         on duplicate key update endtime = unix_timestamp() + 600`,
        [cid],
      );
      await march(3);
      // 上屋抽梯 (the cast above left its live buftype-28 row) blocks even a plain 运输 while
      // both unions match.
      await s.query('delete from mem_city_buffer where cid = ? and buftype in (5, 8)', [cid]);
      await s.query('update sys_user set union_id = 88 where uid in (1001, 1002)');
      await march(0);
      // With the trick buffer gone the cast reaches the 运输 validation instead.
      await s.query('delete from mem_city_buffer where cid = ? and buftype = 28', [target]);
      await march(0);
      await s.query('update sys_user set union_id = 0 where uid in (1001, 1002)');
    },
  },
  {
    // 军队五计 (金蝉脱壳/以逸待劳/千里奔袭 on the own march; 八门金锁/关门打狗/诱敌深入 on the
    // enemy march) plus 虚张声势/偃旗息鼓 troops buffers. The scripted sequence restarts per
    // request, so draw 0 pins every win and the final 259 loses the 900502 roll.
    name: 'trick: troop tricks on own and enemy marches',
    tables: { mem_troops_buffer: { offsets: ['endtime'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      const target = 188128; // uid 1002's city
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      const march = `insert into sys_troops
          (id, uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
        values (?, ?, ?, ?, ?, 2, 0, unix_timestamp() - 600, 12000,
          unix_timestamp() + 11400, '1,3,100', '0')`;
      await s.query(march, [900401, uid, cid, hid, target]);
      await s.query(march, [900501, 1002, target, 900501, cid]);
      await s.query(march, [900502, 1002, target, 900502, cid]);
      // The marching heroes: 900501 智谋 30 loses the rolls, 900502 智谋 200 wins them.
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, wisdom_base,
           loyalty, herotype)
         values (900501, 1002, '守将甲', 0, 0, ?, 2, 1, 30, 100, 1000),
                (900502, 1002, '军师乙', 0, 0, ?, 2, 1, 200, 100, 1000)`,
        [target, target],
      );
      // 以逸待劳 queues the marching troop until 2033 (it needs state 0; 金蝉脱壳 turns it back).
      await s.command(session, 'useTrick', hid, 26, 2, 900401);
      // 金蝉脱壳: a marching troop turns back first, then the return shortens; the 1h lastrun
      // cooldown makes the immediate second cast fail with a counting-down wait (masked).
      await s.command(session, 'useTrick', hid, 10, 2, 900401);
      await s.command(session, 'useTrick', hid, 10, 2, 900401);
      s.mask(1); // the wait counts down
      // 千里奔袭 accelerates the returning troop, then hits its own cooldown.
      await s.command(session, 'useTrick', hid, 13, 2, 900401);
      await s.command(session, 'useTrick', hid, 13, 2, 900401);
      s.rng([0]); // every request draws seq[0]=0: rates 5/10, rolls answer 1 ≤ 60
      // 虚张声势 5×, 偃旗息鼓 10% — replies masked (MakeEndTime), buffers carry the rate.
      await s.command(session, 'useTrick', hid, 21, 2, 900401);
      s.mask(4, 0);
      await s.command(session, 'useTrick', hid, 22, 2, 900401);
      s.mask(4, 0);
      // Enemy marches: 八门金锁 succeeds then cools down; 关门打狗 pins noback; 诱敌深入 speeds
      // the enemy up then cools down.
      await s.command(session, 'useTrick', hid, 11, 3, 900501);
      await s.command(session, 'useTrick', hid, 11, 3, 900501);
      await s.command(session, 'useTrick', hid, 12, 3, 900501);
      await s.command(session, 'useTrick', hid, 23, 3, 900501);
      await s.command(session, 'useTrick', hid, 23, 3, 900501);
      s.stopRng();
      // The fresh 900502 troop out-rolls the caster: 1+259%260 = 260 > 60.
      s.rng([259]);
      await s.command(session, 'useTrick', hid, 11, 3, 900502);
      s.stopRng();
    },
  },
  {
    // 釜底抽薪 (trickHuDiChouXin): recalls the target's famous-hero marches state-by-state via
    // the extracted recallTroop, drops their 采集 rows and cancels a running 历练 through the
    // extracted cancelExpr; the 24h city cooldown answers the second cast.
    name: 'trick: famous-hero recall pulls troops and cancels exprs',
    tables: { sys_hero_expr: { offsets: ['starttime', 'endtime'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      const hid = 900401;
      const target = 188128; // uid 1002's city, schedule cooldown stamps 0
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (?, ?, '谋士', 0, 0, ?, 0, 1, 50, 1, 1, 60, 100, 1000)`,
        [hid, uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (?, 100, 100, 100, 100)',
        [hid],
      );
      await s.query('update sys_goods set count = 100 where uid = ? and gid = 13', [uid]);
      // Two famous marches (hid < 2000): one marching (state 0), one garrisoned (state 4, 采集).
      const march = `insert into sys_troops
          (id, uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource)
        values (?, 1002, ?, ?, ?, 2, ?, unix_timestamp() - 600, 12000,
          unix_timestamp() + 11400, '1,3,100', '0')`;
      await s.query(march, [900601, target, 60, cid, 0]);
      await s.query(march, [900602, target, 61, 209355, 4]);
      await s.query(
        'insert into sys_gather (wid, troopid, fooduse, level, starttime) values (35, 900602, 0, 1, 0)',
      );
      // A hero out on 历练 (state 10) with a running expr booking.
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, wisdom_base,
           loyalty, herotype)
         values (1999, 1002, '历练将', 0, 0, ?, 10, 1, 40, 100, 1000)`,
        [target],
      );
      await s.query(
        `insert into sys_hero_expr (uid, cid, hid, type, starttime, endtime, hours, carrymoney,
           accTimes, state)
         values (1002, ?, 1999, 1, unix_timestamp() - 3600, unix_timestamp() + 3600, 2, 0, 0, 0)`,
        [target],
      );
      await s.command(session, 'useTrick', hid, 25, 1, target);
      await s.command(session, 'useTrick', hid, 25, 1, target); // 24h city cooldown
    },
  },
  {
    // 成就列表 (AchivementFunc.php getOverviewStat/getAchivementsByGroup): the finished/unfinished
    // pages, 5-per-page pagination and the two unlock gates (sys_user.state 新手保护, mem_state 5
    // 黄巾之乱) over the shipped config.
    name: 'achievements: overview, group pages and unlock gates',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.command(session, 'getOverviewStat', uid);
      await s.command(session, 'getOverviewStat', 1002); // the uid rides the param, not the session
      await s.query(
        'insert into sys_user_achivement (uid, achivement_id, time) values (?, 1, 1), (?, 12, 2), (?, 20019, 100)',
        [uid, uid, uid],
      );
      await s.command(session, 'getOverviewStat', uid);
      // Unlocked set {0} only (state 1 is neither 0 nor 2): 全部/已完成/未完成 pages of group 1.
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 0, 0);
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 0, 1);
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 1, 0);
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 2, 0);
      // 脱离新手保护 unlocks open_time 1.
      await s.query('update sys_user set state = 0 where uid = ?', [uid]);
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 0, 0);
      await s.command(session, 'getAchivementsByGroup', uid, 3, 0, 0, 0);
      // 黄巾之乱 finished unlocks open_time 2.
      await s.query('update mem_state set value = 1 where state = 5');
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 0, 0);
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 0, 2);
      await s.command(session, 'getOverviewStat', uid);
      await s.query('update sys_user set state = 1 where uid = ?', [uid]);
      await s.query('update mem_state set value = 0 where state = 5');
      // An unknown type returns the bare empty list, like the original's fall-through.
      await s.command(session, 'getAchivementsByGroup', uid, 1, 0, 9, 0);
    },
  },
  {
    // 成就详情 (getAchivementDetail): type 2 progress runs the cfg_achivement.sql_current_value
    // template (sprintf'd with the uid) as raw SQL; type 3 runs each cfg_achivement_goal.
    // sql_check_goal; completed rows answer the canned progress; a missing row auto-vivifies.
    name: 'achievements: detail progress templates',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // Type 2 template with %s: no log row yet → the cell reads false.
      await s.command(session, 'getAchivementDetail', uid, 1);
      await s.query('insert into log_action_count (uid, aid, count) values (?, 17, 7)', [uid]);
      await s.command(session, 'getAchivementDetail', uid, 1);
      // A template without a placeholder (id 22 hardcodes uid 26999) and one with a trailing
      // semicolon (id 30) are executed as-is, like the original sprintf.
      await s.command(session, 'getAchivementDetail', uid, 22);
      await s.command(session, 'getAchivementDetail', uid, 30);
      // Completed type 2: userValue echoes targetValue.
      await s.query('insert into sys_user_achivement (uid, achivement_id, time) values (?, 1, 5)', [
        uid,
      ]);
      await s.command(session, 'getAchivementDetail', uid, 1);
      // Type 3: the rank-table goals answer isDone 0/1, completed rows answer isDone 1.
      await s.command(session, 'getAchivementDetail', uid, 20019);
      await s.query(
        'insert into sys_user_achivement (uid, achivement_id, time) values (?, 20019, 6)',
        [uid],
      );
      await s.command(session, 'getAchivementDetail', uid, 20019);
      // A missing achievement row auto-vivifies {sql_current_value: ""}, as PHP's false did.
      await s.command(session, 'getAchivementDetail', uid, 99999);
    },
  },
  {
    // 幸运宝盒 (LotteryFunc.php): the shipped mem_state 150=1 keeps every gate command on
    // not_available; the plain reads (getTodayCount, useMoney) and the getWin fatal compare
    // verbatim. The 11/19点 window cannot be pinned — inside it the 150=0 assertions expect the
    // next error instead, so the case stays correct whichever hour it runs in. The seeded
    // log_lottery datetimes land a second apart per side, so the delta compares without them.
    name: 'lottery: gate errors, side rooms and the hour window',
    tables: { log_lottery: { map: { time: () => '<masked>' } } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.command(session, 'getTodayCount');
      await s.query(
        'insert into log_lottery (uid, time, gid, type) values (?, now(), 13, 0), (?, now(), 13, 0)',
        [uid, uid],
      );
      await s.query(
        'insert into log_lottery (uid, time, gid, type) values (?, now() - interval 2 hour, 13, 0)',
        [uid],
      );
      await s.command(session, 'getTodayCount');
      // The whitelisted useMoney: the param array outranks 1 in PHP, so 6 元宝 always go.
      const [money] = await s.query<{ money: string }>('select money from sys_user where uid = ?', [
        uid,
      ]);
      await s.command(session, 'useMoney');
      await s.command(session, 'useMoney');
      await s.query('update sys_user set money = 5 where uid = ?', [uid]);
      await s.command(session, 'useMoney');
      await s.query('update sys_user set money = ? where uid = ?', [money?.money ?? 0, uid]);
      // getWin as a command dies on the original's missing argument 3 — verbatim fatal text.
      await s.command(session, 'getWin');
      // Gates, in their original order: nobility first, then the 150 switch, then the hour.
      await s.command(session, 'startLottery');
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.command(session, 'startLottery');
      await s.command(session, 'getLotteryReward');
      await s.command(session, 'autoGetReward');
      await s.command(session, 'addCount');
      await s.command(session, 'restart', 5, 0, '');
      const [clock] = await s.query<{ h: string }>('select date_format(now(), "%H") as h');
      const lottoHour = clock?.h === '11' || clock?.h === '19';
      await s.query('update mem_state set value = 0 where state = 150');
      if (lottoHour) {
        // The window is open: startLottery reaches the paid-chain dry-out (the free draw was
        // spent above), the round commands reach the missing-round check instead.
        await s.command(session, 'startLottery');
        await s.command(session, 'getLotteryReward');
        await s.command(session, 'restart', 5, 0, '');
      } else {
        await s.command(session, 'startLottery');
        await s.command(session, 'getLotteryReward');
        await s.command(session, 'autoGetReward');
        await s.command(session, 'addCount');
        await s.command(session, 'restart', 5, 0, '');
      }
      await s.query('update mem_state set value = 1 where state = 150');
      await s.query('update sys_user set nobility = 0 where uid = ?', [uid]);
    },
  },
  {
    // 联盟外交写侧 (UnionFunc.php addUnionRelation/pendingFriendly/removeUnionRelation): the
    // neutral setting, the 900s frequency window, the repeated-relation rejections and every
    // byName/context error — the messages with a live countdown are masked.
    name: 'union: diplomacy write errors, neutral and hostility',
    run: async (s) => {
      const first = await s.login(EXISTING_PLAYER);
      const firstCid = await lastCity(s, first.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [firstCid]);
      const firstUnion = Number(
        ((await s.command(first, 'createUnion', '外写甲')) as unknown[])[0],
      );
      s.alias(firstUnion, '<wunion1>');
      const second = await s.login('judingwan');
      const secondCid = await lastCity(s, second.uid);
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [secondCid]);
      const secondUnion = Number(
        ((await s.command(second, 'createUnion', '外写乙')) as unknown[])[0],
      );
      s.alias(secondUnion, '<wunion2>');
      // Context and byName validation.
      await s.command(first, 'addUnionRelationByName', 0, '');
      await s.command(first, 'addUnionRelationByName', 0, '一二三四五六七八九');
      await s.command(first, 'addUnionRelationByName', 0, '不存在盟');
      await s.command(first, 'addUnionRelation', 5, secondUnion);
      const outsider = await s.login('difftest_invalid');
      await s.command(outsider, 'addUnionRelationByName', 0, '外写乙');
      await s.command(first, 'addUnionRelationByName', 1, '外写甲');
      // Neutral applies immediately; repeating it answers have_done (中立).
      await s.command(first, 'addUnionRelationByName', 1, '外写乙');
      await s.command(first, 'addUnionRelationByName', 1, '外写乙');
      // The 900s window guards a change of relation.
      await s.command(first, 'addUnionRelationByName', 2, '外写乙');
      s.mask(1); // the frequency error counts down the remaining wait
      // Past the window: both hostile rows take one timestamp; a re-declare answers hostile_have_done.
      await s.query(
        'update sys_union_relation set time = unix_timestamp() - 1000 where unionid = ? and target = ?',
        [firstUnion, secondUnion],
      );
      await s.command(first, 'addUnionRelationByName', 2, '外写乙');
      // The target's own declare reuses the original timestamp (no 8-hour reset).
      await s.command(second, 'addUnionRelationByName', 2, '外写甲');
      await s.command(first, 'addUnionRelationByName', 2, '外写乙');
      // Hostile removal; an immediate second removal hits removeUnionRelation.too_frequency.
      await s.command(first, 'removeUnionRelation', 2, secondUnion);
      await s.command(first, 'removeUnionRelation', 2, secondUnion);
      s.mask(1); // the frequency error counts down the remaining wait
      await s.command(first, 'removeUnionRelation', 9, secondUnion);
      await s.command(first, 'removeUnionRelation', 1, secondUnion);
      // Friendly: an unanswered attempt, a duplicate, the accept and its lists.
      await s.command(second, 'pendingFriendly', 1, firstUnion);
      await s.query(
        'update sys_union_relation set time = unix_timestamp() - 1000 where unionid = ? and target = ?',
        [firstUnion, secondUnion],
      );
      await s.command(first, 'addUnionRelationByName', 0, '外写乙');
      await s.command(second, 'getRequestList');
      s.mask(4, 1, '*', 'time'); // from_unixtime stamps a per-second clock
      await s.command(first, 'addUnionRelationByName', 0, '外写乙');
      await s.command(second, 'getRequestList');
      s.mask(4, 1, '*', 'time');
      await s.command(second, 'pendingFriendly', 1, firstUnion);
      s.mask(4, 1, '*', 'time');
      await s.command(first, 'getUnionRelation', 0);
      await s.command(second, 'pendingFriendly', 0, firstUnion);
    },
  },
  {
    // 过关斩将 (PKFunc.php 征战半部): loadCampaignInitData 的首次建档与 10 军令赠礼、
    // regetCampaignMaxData、buyJunlingFunc 的价格/上限/非元宝拒绝、getAllHeroByUid 的分页与
    // 君主将置顶，以及 getOneBattleRet 的军令不足/参数/越级/等级/修为五类拒绝。
    // rng 10000: mt_rand(1,20000)→10001 不触发四技能、mt_rand(1,10)→1 不掉落。
    name: 'campaign: init, junling economy and hero picker',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // 军令尚未发放：征战拒绝走 changeCityPosition.no_adv_lijianfu。
      await s.command(session, 'getOneBattleRet', 1, 0, 1, [80213, 900500, 900501]);
      // 参数不足 4 个（PHP count 标量=1 的第四参同样走 invalid_param）。
      await s.command(session, 'getOneBattleRet', 1);
      await s.command(session, 'getOneBattleRet', 1, 0, 1, 80213);
      // 首次建档：sys_pk_user (1,1) + 赠 10 军令（cfg 面板数据两边同库同文；英雄清单无
      // order by，5.7/8.4 扫描序不同，按多重集比较）。
      await s.command(session, 'loadCampaignInitData');
      s.unordered(4, 1);
      s.unordered(4, 2);
      await s.command(session, 'regetCampaignMaxData');
      // 军令经济：非元宝、0 个、正常购买、超出 100 上限（sprintf 的余量入文案）。
      await s.command(session, 'buyJunlingFunc', 1, 1);
      await s.command(session, 'buyJunlingFunc', 0, 0);
      await s.command(session, 'buyJunlingFunc', 0, 5);
      await s.query('update sys_goods set count = 99 where uid = ? and gid = 19200', [uid]);
      await s.command(session, 'buyJunlingFunc', 0, 2);
      await s.query('update sys_goods set count = 15 where uid = ? and gid = 19200', [uid]);
      // 将领选择器：非数组/0 页拒绝；空选首页带君主将；选中君主将不带；选他人；翻页。
      await s.command(session, 'getAllHeroByUid', 5);
      await s.command(session, 'getAllHeroByUid', [], 0);
      await s.command(session, 'getAllHeroByUid', [], 1);
      await s.command(session, 'getAllHeroByUid', [80213], 1);
      await s.command(session, 'getAllHeroByUid', [999999], 1);
      await s.command(session, 'getAllHeroByUid', [], 2);
      // 关卡闸门：君主将等级（普通）、修为（精英）、越级三层拒绝，然后是将领归属。
      await s.command(session, 'getOneBattleRet', 1, 0, 1, [80213, 900500, 900501]);
      await s.query('update sys_city_hero set level = 10 where uid = ? and herotype = 1000', [uid]);
      await s.command(session, 'getOneBattleRet', 1, 1, 1, [80213, 900500, 900501]);
      await s.command(session, 'getOneBattleRet', 1, 0, 2, [80213, 900500, 900501]);
      await s.command(session, 'getOneBattleRet', 1, 0, 5, [80213, 900500, 900501]);
      await s.command(session, 'getOneBattleRet', 3, 0, 1, [80213, 900500, 900501]);
      await s.command(session, 'getOneBattleRet', 1, 0, 1, [80213, 999997, 999998]);
      // 两员陪练猛将（一击秒杀 NPC），君主将顶在第一位按原版先手轮换。
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (900500, ?, '陪练甲', 0, 0, ?, 0, 1, 50, 1, 20000, 20000, 100, 0),
                (900501, ?, '陪练乙', 0, 0, ?, 0, 1, 50, 1, 20000, 20000, 100, 0)`,
        [uid, cid, uid, cid],
      );
      await s.query(
        `insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
         values (900500, 100000, 100000, 100, 100), (900501, 100000, 100000, 100, 100)`,
      );
      // 首场真实战斗：君主将 16 刀阵亡、两陪练各一击清场 → winer=1，奖励串为空数组。
      s.rng([10000]);
      await s.command(session, 'getOneBattleRet', 1, 0, 1, [80213, 900500, 900501]);
      s.stopRng();
    },
  },
  {
    // 过关斩将: 战斗链路 — 精英档（sys_user_level 修为闸门 + 18011 掉落，rng 10002 使
    // mt_rand(1,10)=3）、普通档 1-10 层逐层推进（第 10 层宝箱 + cfg_pk_first 首通占位）、
    // getPkFirstReward 领取与重复拒绝、loadPKRewardRank 物品态奖励串解析（跨家族联读）。
    name: 'campaign: ladder battles, first-pass ranks and boards',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.command(session, 'loadCampaignInitData'); // 10 军令 + sys_pk_user (1,1)
      s.unordered(4, 1); // 英雄清单无 order by，5.7/8.4 扫描序不同
      s.unordered(4, 2);
      await s.command(session, 'buyJunlingFunc', 0, 20); // 补到 30 个
      await s.query('insert into sys_user_level (uid, level) values (?, 1)', [uid]);
      await s.query('update sys_city_hero set level = 10 where uid = ? and herotype = 1000', [uid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
           affairs_base, bravery_base, wisdom_base, loyalty, herotype)
         values (900500, ?, '陪练甲', 0, 0, ?, 0, 1, 50, 1, 20000, 20000, 100, 0),
                (900501, ?, '陪练乙', 0, 0, ?, 0, 1, 50, 1, 20000, 20000, 100, 0)`,
        [uid, cid, uid, cid],
      );
      await s.query(
        `insert into mem_hero_blood (hid, \`force\`, force_max, energy, energy_max)
         values (900500, 100000, 100000, 100, 100), (900501, 100000, 100000, 100, 100)`,
      );
      // 精英第 1 层：掉落 roll 掷中 3 → 发 18011（cfg_goods 在册），special 推进到 101。
      s.rng([10002]);
      await s.command(session, 'getOneBattleRet', 1, 1, 1, [80213, 900500, 900501]);
      // 普通 1-10 层：每层胜利推进 normal，第 10 层触发 cfg_pk_reward 宝箱与首通占位。
      s.rng([10000]);
      for (let level = 1; level <= 10; level++) {
        await s.command(session, 'getOneBattleRet', 1, 0, level, [80213, 900500, 900501]);
      }
      s.stopRng();
      // 首通奖励：占位行 uid=1001/time=0 可领，领后 time=now；重复领取拒绝；未占位拒绝。
      await s.command(session, 'getPkFirstReward', 1, 0, 1);
      await s.command(session, 'getPkFirstReward', 1, 0, 1);
      await s.command(session, 'getPkFirstReward', 1, 0, 2);
      await s.command(session, 'getPkFirstReward', 1, 1, 1);
      // 首通前三榜：第 1 名已有主（userName+formatTime），2/3 名空位，奖励串按物品解析。
      await s.command(session, 'loadPKRewardRank', 1, 0);
      s.mask(4, 0, '*', 'formatTime');
      await s.command(session, 'loadPKRewardRank', 1, 1);
      await s.command(session, 'regetCampaignMaxData');
    },
  },
  {
    // 竞技场: 爵位闸门（推恩令 buffer 16/bufparam 2 加成过闸，跨家族 getBufferNobility 路径）、
    // 首进三表初始化（mem_assemble maxRank+1 / sys_user_assemble / mem_assemble_hero 三君主将）、
    // holdBattleHeroInfo 的将数与君主将规则、loadRankBefore10/loadBeforeUser10 榜单、
    // gotoSelectedRank 的价格档/自座/超顶/上下搬移、refreshAssembleRankInfo 6 秒冷却、
    // clearArenaCoolTime 的未冷却拒绝与 getArenaReward 的 5 小时累计领取（type 2 资源态）。
    // rng 10000 → resetResistArenaReward 的 mt_rand(1,100)=1 → gid -1。
    name: 'arena: nobility gate, seating and reward clock',
    tables: {
      mem_assemble: { offsets: ['endtime'] },
      sys_user_assemble: { offsets: ['next_challenge_time', 'next_refresh_time'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // 爵位 0 不够上造。
      await s.command(session, 'loadArenaBattleInitData');
      // 推恩令 bufparam 2 → 爵位 2 过闸；首进初始化三表 + 首次奖励钟（rng 钉死）。
      await s.query(
        `insert into mem_user_buffer (uid, buftype, endtime, bufparam)
         values (?, 16, unix_timestamp() + 86400, 2)`,
        [uid],
      );
      s.rng([10000]);
      await s.command(session, 'loadArenaBattleInitData');
      s.mask(4, 3, '*', 'getRewardTime'); // 5 小时内的剩余秒，属于小数值，offset 比不了
      s.offset(4, 3, '*', 'endtime');
      s.stopRng();
      await s.command(session, 'loadUserBattleHero');
      await s.command(session, 'loadRankBefore10');
      s.mask(4, 0, '*', 'getRewardTime');
      s.offset(4, 0, '*', 'endtime');
      await s.command(session, 'loadBeforeUser10');
      s.mask(4, 0, '*', 'getRewardTime');
      s.offset(4, 0, '*', 'endtime');
      // 上阵配置：单参拒绝；无君主将拒绝；三君主将成功。
      await s.command(session, 'holdBattleHeroInfo', 80213);
      await s.command(session, 'holdBattleHeroInfo', 80213, 900600, 900601);
      await s.command(session, 'holdBattleHeroInfo', 80213, 80213, 80213);
      // 座次：第二名的陪榜行让 gotoSelectedRank 上下两个方向都有实搬。
      await s.query(
        `insert into mem_assemble (\`rank\`, uid, level, rewardid, count, endtime)
         values (2, 1002, 1, 152, 7, unix_timestamp() + 5400)`,
      );
      await s.query('insert into sys_user_assemble (uid, `rank`, maxrank) values (1002, 2, 2)');
      await s.command(session, 'gotoSelectedRank', 3);
      await s.command(session, 'gotoSelectedRank', 1);
      await s.command(session, 'gotoSelectedRank', 500);
      await s.command(session, 'gotoSelectedRank', 2); // 往下爬：1002 上移、自己 2 号
      s.mask(4, 1, '*', 'getRewardTime');
      s.offset(4, 1, '*', 'endtime');
      await s.command(session, 'gotoSelectedRank', 1); // 往上爬：1002 回 2 号、自己回 1 号
      s.mask(4, 1, '*', 'getRewardTime');
      s.offset(4, 1, '*', 'endtime');
      // 刷新：非法页签、正常刷新与 6 秒冷却。
      await s.command(session, 'refreshAssembleRankInfo', 2);
      await s.command(session, 'refreshAssembleRankInfo', 0);
      s.mask(4, 2, '*', 'getRewardTime');
      s.offset(4, 2, '*', 'endtime');
      await s.command(session, 'refreshAssembleRankInfo', 0);
      // 冷却与奖励：未冷却拒绝；1002 号奖励目标拒绝；未到 5 小时拒绝；到时领取（gid -1 是
      // type 2 资源态 → 城黄金 +base*5）→ 领取后重掷奖励钟。
      await s.command(session, 'clearArenaCoolTime');
      await s.command(session, 'getArenaReward', 1002);
      await s.command(session, 'getArenaReward', uid);
      await s.query('update mem_assemble set endtime = unix_timestamp() - 10 where uid = ?', [uid]);
      s.rng([10000]);
      await s.command(session, 'getArenaReward', uid);
      s.stopRng();
      await s.command(session, 'getArenaReward', uid);
    },
  },
  {
    // 竞技场: 挑战链路 — 三场对 uid 1002 的胜利（排名上搬/每日次数钟/连胜 3 次公告与
    // maxwin）、首榜挑战 50 元宝（isSkip=1）、防守方 endtime 过期的无奖励记录分支、
    // NPC（uid<1000）目标占领后 cfg_assemble_special_hero isopen 清零、
    // getArenaRankRewardInfo/getArenaRankReward 的夹具榜单与领取。
    // rng 10002 → mt_rand(1,20000)→10003 不触发四技能（斗将短报文）且 mt_rand(1,100)=3。
    name: 'arena: challenge fights, streaks and rank rewards',
    tables: {
      mem_assemble: { offsets: ['endtime'] },
      sys_user_assemble: { offsets: ['next_challenge_time', 'next_refresh_time'] },
      mem_assemble_record: { offsets: ['time'] },
      mem_assemble_win_record: { offsets: ['last_challenge_time'] },
      log_assemble_reward: { offsets: ['time'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // 夹具：自己 3 号位、1002 2 号位；自己君主将加成拉满一击秒杀（省报文）；防守方体力 10。
      await s.query(
        `insert into mem_assemble (\`rank\`, uid, level, rewardid, count, endtime)
         values (3, ?, 1, 152, 7, unix_timestamp() + 5400),
                (2, 1002, 1, 152, 7, unix_timestamp() + 5400)`,
        [uid],
      );
      await s.query(
        `insert into mem_assemble_hero (uid, hid1, hid2, hid3)
         values (?, 80213, 80213, 80213), (1002, 80216, 80216, 80216)`,
        [uid],
      );
      await s.query(
        'insert into sys_user_assemble (uid, `rank`, maxrank) values (?, 3, 3), (1002, 2, 2)',
        [uid],
      );
      await s.query('update mem_hero_blood set `force` = 10 where hid = 80216');
      await s.query(
        `update sys_city_hero set bravery_add_on = 5000, wisdom_add_on = 5000,
           command_add_on = 5000 where hid = 80213`,
      );
      // 爵位闸门（推恩令加成路径已在另一用例覆盖，这里直接给足爵位）。
      await s.query('update sys_user set nobility = 2 where uid = ?', [uid]);
      const pinDefender = () =>
        s.query(
          `update mem_assemble set rewardid = 152, count = 7, endtime = unix_timestamp() + 5400
           where uid = 1002`,
        );
      const reopen = () =>
        s.query('update sys_user_assemble set next_challenge_time = 0 where uid = ?', [uid]);
      // 胜 1：排名 3→2 上搬（updatePartUserRank 上行 + maxrank 更新），奖励 152×35。
      s.rng([10002]);
      await s.command(session, 'startArenaChallenge', 1002, 0);
      await reopen();
      // 胜 2：isSkip=1 → 首榜挑战 50 元宝（top10 之外窗口的强爬路径）。
      await pinDefender();
      await s.command(session, 'startArenaChallenge', 1002, 1);
      await reopen();
      // 胜 3：连胜 3 次 → mem_assemble_win_record + 全服公告 + maxwin=3。
      await pinDefender();
      await s.command(session, 'startArenaChallenge', 1002, 0);
      await reopen();
      // NPC 目标（uid 5）：胜利后 isopen 全清、mem_assemble_hero uid<1000 删行、NPC 公告、
      // endtime=0 已过期的记录分支与占领搬移。
      await s.query(
        `insert into mem_assemble (\`rank\`, uid, level, rewardid, count, endtime)
         values (3, 5, 1, 10616, 3, 0)`,
      );
      await s.query('insert into mem_assemble_hero (uid, hid1, hid2, hid3) values (5, 1, 2, 3)');
      await s.command(session, 'startArenaChallenge', 5, 0);
      s.stopRng();
      // 榜单与排行奖励：夹具前二占位行 → 信息面 + 领取（12027）+ 重复领取拒绝。
      await s.query(
        `insert into log_assemble_reward (\`rank\`, uid, name, reward, time)
         values (1, ?, 'changle', 0, 0), (2, 1002, 'judingwan', 0, 0)`,
        [uid],
      );
      await s.command(session, 'getArenaRankRewardInfo');
      await s.command(session, 'getArenaRankReward');
      await s.command(session, 'getArenaRankReward');
      await s.command(session, 'getArenaRankRewardInfo');
    },
  },
  {
    // 洛阳战场: mem_state 2000/2001 的四段闸门、推恩令加成过爵位闸（bufparam 5+nobility 1→6）、
    // 联盟闸门、luoyangYuanjun 扣 100 元宝写 second=1、luoyangTroopStart 的军旗检查（周三
    // 19 点闸门读 DB 时钟无法夹具，两边按各自钟走同一分支）、召回、战场城军队列表、
    // 调城的四层校验、千里奔袭的类型/锦囊/状态/冷却四层、遭遇战落 sys_battle/mem_battle。
    name: 'luoyang: battlefield gates, troops, tricks and skirmish',
    tables: {
      // mem_state.value 在本用例里既有开关数字也有开启时间戳，统一按偏移量比（数字原样返回）。
      mem_state: { offsets: ['value'] },
      sys_luoyang_troops: { offsets: ['starttime', 'endtime'] },
      sys_battle: { offsets: ['starttime'] },
      mem_battle: { offsets: ['nexttime'] },
      // 途中召回的 pathtime = now-starttime，两边相差请求间隔的 1-2 秒，按 10 秒取整比对。
      sys_troops: {
        offsets: ['starttime', 'endtime'],
        map: {
          pathtime: (v) =>
            typeof v === 'string' && /^\d+$/.test(v) ? String(Math.round(Number(v) / 10)) : v,
        },
      },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // 开关四段：0→out_of_time、2→out_of_time、1+0→waigua.invalid、1+过期→has_close。
      await s.command(session, 'getLYBattleData');
      await s.query('update mem_state set value = 2 where state = 2000');
      await s.command(session, 'getLYBattleData');
      await s.query('update mem_state set value = 1 where state = 2000');
      await s.command(session, 'getLYBattleData');
      await s.query('update mem_state set value = unix_timestamp() - 8000 where state = 2001');
      await s.command(session, 'getLYBattleData');
      await s.query('update mem_state set value = unix_timestamp() - 100 where state = 2001');
      // 爵位 6 闸门：推恩令 bufparam 5 + 实爵 1 → 6（跨家族 getBufferNobility 路径）。
      await s.command(session, 'getLYBattleData');
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.query(
        `insert into mem_user_buffer (uid, buftype, endtime, bufparam)
         values (?, 16, unix_timestamp() + 86400, 5)`,
        [uid],
      );
      await s.command(session, 'getLYBattleData'); // not_in_union
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [cid]);
      const unionid = Number(((await s.command(session, 'createUnion', '洛甲')) as unknown[])[0]);
      s.alias(unionid, '<lyunion>');
      await s.command(session, 'getLYBattleData'); // 全景：城图/剩余秒/援军权/军队
      s.mask(4, 1); // leavingTime 是秒数差，小数值
      s.mask(4, 3, '*', 'leavingTime');
      s.offset(4, 3, '*', 'endtime');
      s.offset(4, 3, '*', 'starttime');
      // 派兵：军旗检查在时间闸门之前（no_flag 两边确定）；带旗后按各自时钟走闸门。
      await s.command(session, 'luoyangTroopStart', 80213, cid, unionid, '1,3,100', 0);
      await s.command(session, 'luoyangTroopStart', 80213, cid, unionid, '1,3,100', 1);
      await s.query(
        `insert into sys_goods (uid, gid, count) values (?, 59, 2)
         on duplicate key update count = 2`,
        [uid],
      );
      await s.command(session, 'luoyangTroopStart', 80213, cid, unionid, '1,3,100', 1);
      // shipped 新手城可能已带 3 号兵行：upsert 到 100，保证两边起点一致。
      await s.query(
        `insert into sys_city_soldier (cid, sid, count) values (?, 3, 100)
         on duplicate key update count = 100`,
        [cid],
      );
      await s.command(session, 'luoyangTroopStart', 80213, cid, unionid, '1,3,200', 1);
      await s.command(session, 'luoyangTroopStart', 80213, cid, unionid, '1,3,100', 1);
      // 召回：非自己的队伍拒绝；途中召回（pathtime=now-starttime）转 sys_troops 回城。
      await s.command(session, 'luoyangCallbackTroop', 999);
      await s.query(
        `insert into sys_luoyang_troops
           (uid, cid, hid, targetcid, state, starttime, pathtime, endtime, soldiers, startcid, unionid)
         values (?, ?, 80213, 215265, 0, unix_timestamp() - 600, 600,
           unix_timestamp() + 600, '1,3,100', ?, ?)`,
        [uid, cid, cid, unionid],
      );
      const [mine] = await s.query<{ id: string }>(
        'select id from sys_luoyang_troops where uid = ? and hid = 80213 order by id limit 1',
        [uid],
      );
      const myTroop = Number(mine?.id ?? 0);
      await s.command(session, 'luoyangCallbackTroop', myTroop);
      // 战场城军队列表：无座拒绝；NPC（uid<1000）与我军同城按 unionid 排序拼名字。
      await s.command(session, 'luoyangCityTroops', 3, 80213);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, loyalty, herotype)
         values (900700, 5, '洛阳NPC将', 0, 0, 0, 0, 1, 100, 0)`,
      );
      await s.query(
        `insert into sys_luoyang_troops
           (uid, cid, hid, targetcid, state, starttime, pathtime, endtime, soldiers, startcid, unionid)
         values (5, 3, 900700, 3, 0, unix_timestamp() - 600, 600, unix_timestamp() + 600,
           '1,3,100', 3, 0)`,
      );
      await s.query(
        `insert into sys_luoyang_troops
           (uid, cid, hid, targetcid, state, starttime, pathtime, endtime, soldiers, startcid, unionid)
         values (?, 3, 80213, 3, 0, unix_timestamp() - 600, 600, unix_timestamp() + 600,
           '1,3,100', 3, ?)`,
        [uid, unionid],
      );
      const [mine2] = await s.query<{ id: string }>(
        'select id from sys_luoyang_troops where uid = ? and cid = 3 order by id limit 1',
        [uid],
      );
      const cityTroop = Number(mine2?.id ?? 0);
      await s.command(session, 'luoyangCityTroops', 3, 80213);
      // 调城：非己队/无cfg边/endtime 未过/NPC 占城四层拒绝，然后成功迁到 6 号城。
      await s.command(session, 'luoyangChangeCity', 999, 3, 6);
      await s.command(session, 'luoyangChangeCity', cityTroop, 3, 99);
      await s.command(session, 'luoyangChangeCity', cityTroop, 3, 6);
      await s.query('update sys_luoyang_troops set endtime = unix_timestamp() - 1 where id = ?', [
        cityTroop,
      ]);
      await s.command(session, 'luoyangChangeCity', cityTroop, 3, 6); // NPC 军队占用
      await s.query('delete from sys_luoyang_troops where uid = 5');
      await s.command(session, 'luoyangChangeCity', cityTroop, 3, 6);
      // 千里奔袭：非 13 类型/usetype 不符/将领不存在/锦囊不足（原样 not_enough_goods13#12）/
      // 目标非洛阳/正常缩时/1 小时冷却/冷却过后复用。
      await s.command(session, 'useLuoyangTrick', 80213, 25, 2);
      await s.command(session, 'useLuoyangTrick', 80213, 13, 3);
      await s.command(session, 'useLuoyangTrick', 999, 13, 2);
      await s.command(session, 'useLuoyangTrick', 80213, 13, 2);
      await s.query(
        `insert into sys_goods (uid, gid, count) values (?, 13, 50)
         on duplicate key update count = 50`,
        [uid],
      );
      await s.command(session, 'useLuoyangTrick', 80213, 13, 2); // targetcid=6 → wrong_state
      await s.query('update sys_luoyang_troops set targetcid = 215265 where id = ?', [cityTroop]);
      await s.command(session, 'useLuoyangTrick', 80213, 13, 2);
      await s.command(session, 'useLuoyangTrick', 80213, 13, 2); // cool_down
      await s.query('update sys_luoyang_troops set lastcc = unix_timestamp() - 4000 where id = ?', [
        cityTroop,
      ]);
      await s.command(session, 'useLuoyangTrick', 80213, 13, 2);
      // 遭遇战：双方同城异盟 → sys_battle type5 + mem_battle type5 + 默认遭遇战术。
      await s.query(
        `insert into sys_luoyang_troops
           (uid, cid, hid, targetcid, state, starttime, pathtime, endtime, soldiers, startcid, unionid)
         values (5, 6, 900700, 6, 0, unix_timestamp() - 600, 600, unix_timestamp() + 600,
           '1,3,100', 6, 0)`,
      );
      await s.command(session, 'luoyangAttack', 80213, 900700, 6);
      // 援军权：100 元宝 → sys_user_luoyang second=1，全景里 isOpenSecond 变 1。
      await s.command(session, 'luoyangYuanjun');
      await s.command(session, 'getLYBattleData');
      s.mask(4, 1);
      s.mask(4, 3, '*', 'leavingTime');
      s.offset(4, 3, '*', 'endtime');
      s.offset(4, 3, '*', 'starttime');
    },
  },
  {
    // 洛阳归属: 六条读命令的空表语义（含 sys_luoyang_info.uid=710 的 NPC 持有态）、
    // luoyangAllocate 的 uid<1000/非成员/成功（count 连续、130527 王爵位 buffer、nobility=21、
    // 换主事件）与本周已分配拒绝、sendBelongInform 当日一次、openUnionZhaoAn 全盟 72h
    // （含从旧 endtime 顺延的 on-dup 路径）、getLuoyangGovernCount、五政令全类型与
    // 当日已政令/每日上限拒绝、getBeiZhanLuoYangProgress 非盟拒绝与 112001-112004 补种。
    name: 'luoyang belong: allocate, notices, decrees and union epic',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      // 空态语义：sys_luoyang_info.uid=710（NPC 持有）、积分榜空、事件空。
      await s.command(session, 'getLuoyangInfo');
      await s.command(session, 'getLuoyangEvent');
      await s.command(session, 'getLYBelongInfo');
      await s.command(session, 'getUnionRankPoint');
      await s.command(session, 'getUserRankPoint');
      await s.command(session, 'getUserInfoPoint');
      // 备战洛阳：非 0 类型与无盟都走 rankfunc.uniontask。
      await s.command(session, 'getBeiZhanLuoYangProgress', 1);
      await s.command(session, 'getBeiZhanLuoYangProgress', 0);
      // 分配：现持者 uid<1000 拒绝 → 夹具换主成本盟 → 非成员拒绝 → 成功分配（各路写齐）。
      await s.command(session, 'luoyangAllocate', 'changle');
      await s.query('update mem_city_resource set gold = 100000 where cid = ?', [cid]);
      const unionid = Number(((await s.command(session, 'createUnion', '洛丙')) as unknown[])[0]);
      s.alias(unionid, '<lyunion2>');
      await s.query('update sys_luoyang_info set uid = ?, unionid = ?, name = ? where uid = 710', [
        uid,
        unionid,
        'changle',
      ]);
      await s.command(session, 'luoyangAllocate', '不存在的人');
      await s.command(session, 'luoyangAllocate', 'changle');
      await s.command(session, 'luoyangAllocate', 'changle'); // 本周已分配
      await s.command(session, 'getLYBelongInfo'); // yearCount=1 的合并行
      // 归属者闸门下的三条：政令计数（当日清零快照序）、飘公告当日一次、诏安全盟 72h。
      await s.command(session, 'getLuoyangGovernCount');
      await s.command(session, 'sendBelongInform');
      await s.command(session, 'sendBelongInform'); // has_send_inform
      await s.query(
        `insert into mem_user_buffer (uid, buftype, endtime)
         values (1002, 10333, unix_timestamp() - 1000)`,
      );
      await s.query('update sys_user set union_id = ? where uid = 1002', [unionid]);
      await s.command(session, 'openUnionZhaoAn');
      await s.command(session, 'openUnionZhaoAn'); // has_used
      // 五政令：夹具五座 uid 1002 的城（各城当日一次），征税/抽丁/征粮/收编/裁军全类型。
      const target = async (n: number, withSoldiers: boolean) => {
        const tcid = 20000 + n * 10;
        await s.query(
          `insert into sys_city (cid, uid, name, type, state, province)
           values (?, 1002, '政令城', 0, 0, 10)`,
          [tcid],
        );
        await s.query(
          `insert into mem_city_resource (cid, people, food, wood, rock, iron, gold, morale,
             complaint, lastupdate)
           values (?, 1000, 1000, 0, 0, 0, 1000, 0, 0, 0)`,
          [tcid],
        );
        if (withSoldiers) {
          await s.query('insert into sys_city_soldier (cid, sid, count) values (?, 3, 1000)', [
            tcid,
          ]);
        }
        return tcid;
      };
      const t1 = await target(1, false);
      const t2 = await target(2, false);
      const t3 = await target(3, false);
      const t4 = await target(4, true);
      const t5 = await target(5, true);
      await s.command(session, 'governLuoyangOthers', 0, 600, 600);
      await s.command(session, 'governLuoyangOthers', 0, t1 % 1000, Math.floor(t1 / 1000));
      await s.command(session, 'governLuoyangOthers', 0, t1 % 1000, Math.floor(t1 / 1000)); // 当日已政令
      await s.command(session, 'governLuoyangOthers', 1, t2 % 1000, Math.floor(t2 / 1000));
      await s.command(session, 'governLuoyangOthers', 2, t3 % 1000, Math.floor(t3 / 1000));
      await s.command(session, 'governLuoyangOthers', 3, t4 % 1000, Math.floor(t4 / 1000));
      await s.command(session, 'governLuoyangOthers', 4, t5 % 1000, Math.floor(t5 / 1000));
      await s.command(session, 'getLuoyangGovernCount'); // 5 次
      // 每日 10 次上限挂在洛阳 schedule 行上。
      await s.query('update mem_city_schedule set govern_count = 10 where cid = 215265');
      await s.command(session, 'governLuoyangOthers', 0, t2 % 1000, Math.floor(t2 / 1000));
      // 备战洛阳：有盟后补种 112001-112004 进度行（cfg_task_goal sort 203）。
      await s.command(session, 'getBeiZhanLuoYangProgress', 0);
      await s.command(session, 'getBeiZhanLuoYangProgress', 0); // 已存在的行 curvalue 原样
    },
  },
  {
    // 婚姻·君主历练: loadMarryInfo/loadMarryKingExpr 的空态行、beginKingExpr 的 1-8 小时/
    // 休假/忙碌三层拒绝与建单、fasterKingExpr 两态两道具（12060 过程 30% 封底 1800s、
    // 12061 返程召回）、cancelKingExpr 的未过半程折半与超半程保持两分支。
    name: 'marry: king expr lifecycle',
    tables: {
      sys_king_expr: { offsets: ['starttime', 'endtime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.command(session, 'loadMarryInfo');
      await s.command(session, 'loadMarryKingExpr');
      // 小时数闸门。
      await s.command(session, 'beginKingExpr', 0);
      await s.command(session, 'beginKingExpr', 9);
      // 休假拒绝（sys_user_state.vacend）。
      await s.query(
        `insert into sys_user_state (uid, forbistart, forbiend, vacstart, vacend, reason)
         values (?, 0, 0, 0, unix_timestamp() + 1000, '')`,
        [uid],
      );
      await s.command(session, 'beginKingExpr', 2);
      await s.query('delete from sys_user_state where uid = ?', [uid]);
      // 忙碌拒绝（将领 state≠0）。
      await s.query('update sys_city_hero set state = 2 where uid = ? and herotype = 1000', [uid]);
      await s.command(session, 'beginKingExpr', 2);
      await s.query('update sys_city_hero set state = 0 where uid = ? and herotype = 1000', [uid]);
      // 8 小时历练建单（log_user_action/log_action_count 各 21 号；回包是 [msg, [row]]）。
      await s.command(session, 'beginKingExpr', 8);
      s.offset(4, 1, 0, 'endtime');
      // 过程加速：无 12060 → 原样 not_enough_goods12060；有票两次各减 30%（封底 1800s）。
      await s.command(session, 'fasterKingExpr');
      await s.query('insert into sys_goods (uid, gid, count) values (?, 12060, 3)', [uid]);
      await s.command(session, 'fasterKingExpr');
      s.offset(4, 0, 'endtime');
      await s.command(session, 'fasterKingExpr');
      s.offset(4, 0, 'endtime');
      // 取消：未过半程 endtime=2*now-starttime（随用例时长跑动，掩掉）；将领 10→11。
      await s.command(session, 'cancelKingExpr');
      s.mask(4, 0, 'endtime'); // 2*now-starttime 随用例时长跑动
      // 把返程钟拨到未来，钉死 state=1 分支（原样取消后 endtime≈now，大多直接已返回）。
      await s.query('update sys_king_expr set endtime = unix_timestamp() + 3000 where uid = ?', [
        uid,
      ]);
      // 返程加速：无 12061 → 原样 not_enough_goods12061；有票立即召回（删单、将领回 0）。
      await s.command(session, 'fasterKingExpr');
      await s.query('insert into sys_goods (uid, gid, count) values (?, 12061, 1)', [uid]);
      await s.command(session, 'fasterKingExpr');
      // 超半程取消的另一分支：夹具一单 starttime 已过 4000s（> hours*1800）→ endtime 原样。
      await s.query('update sys_city_hero set state = 10 where uid = ? and herotype = 1000', [uid]);
      await s.query(
        `insert into sys_king_expr (uid, cid, hid, type, starttime, endtime, hours, accTimes, state)
         values (?, 0, (select hid from sys_city_hero where uid = ? and herotype = 1000), 0,
           unix_timestamp() - 4000, unix_timestamp() + 4000, 1, 0, 0)`,
        [uid, uid],
      );
      await s.command(session, 'cancelKingExpr');
      s.offset(4, 0, 'endtime'); // 超半程分支 endtime 原样（now+4000，绝对时刻）
      s.offset(4, 0, 'starttime'); // 夹具行的 starttime（now-4000）
    },
  },
  {
    // 婚姻·红颜与亲子: finishMeetWife 的红玫瑰兑换（成功文案走异常）、byebye、proposeMarry
    // 的 favor/档位/铜钱三层拒绝与四档成功率（5/30 档掷不中直接成、空手档触发守护 NPC 战）、
    // 3 小时冷却、addMadamFavor 的礼品梯/80 态闸门与 88 怀孕迁移、doSpeedFeta、
    // getMadamChild 铜钱/元宝两路支付与出生（名字表裁成单行使 order by rand() 确定）、
    // 培养与出师、改名一次性、开房 200/400 封顶 3、周游列国送子换礼包。
    // rng 10006 → mt_rand(1,100)=7：提亲 5/30 档不触发 PK、培养成功率 80 档掷中、
    // mt_rand(0,1)=0 生女（原版 sex==0 取 boyname 的怪癖路径）。
    name: 'marry: girlfriend, proposal and children',
    tables: {
      sys_king_expr: { offsets: ['starttime', 'endtime'] },
      mem_marry_during: { offsets: ['starttime', 'endtime'] },
      mem_marry_hero_favor: { offsets: ['coolingEndtime', 'proposeCoolTime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // 名字表裁成单行并把幸存行改名为固定值：order by rand() 两边必同（两边默认排序规则
      // 不同，min(name) 选出的行可能不一样，所以再 update 钉死文案）。
      for (const [table, name] of [
        ['mem_cfg_firstname', '丁'],
        ['mem_cfg_boyname', '一佑'],
        ['mem_cfg_girlname', '丫丫'],
      ] as const) {
        await s.query(
          `delete from \`${table}\` where name <> (select name from
             (select min(name) as name from \`${table}\`) t)`,
        );
        await s.query(`update \`${table}\` set name = ?`, [name]);
      }
      // 缘份奖励换红颜：无奖励行 → 夹具行 → 红玫瑰不足（cfg_marry_mother_hero hid 1 需 2 朵）
      // → 兑换（mem_marry_hero_favor 建档 + getFlag + 公告，成功文案经异常返回）→ 重复领。
      await s.command(session, 'finishMeetWife', 999);
      await s.query(
        'insert into sys_king_expr_reward (uid, hid, time, getFlag) values (?, 1, 0, 0)',
        [uid],
      );
      const [reward] = await s.query<{ id: string }>(
        'select id from sys_king_expr_reward where uid = ? limit 1',
        [uid],
      );
      const rewardId = Number(reward?.id ?? 0);
      await s.command(session, 'finishMeetWife', rewardId);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 12065, 5)', [uid]);
      await s.command(session, 'finishMeetWife', rewardId);
      await s.command(session, 'finishMeetWife', rewardId);
      // 分手：无红颜拒绝；第二位红颜（夹具行）分手成功。
      await s.command(session, 'byebye', 2);
      await s.query(
        'insert into mem_marry_hero_favor (uid, hid, favor, state, count) values (?, 2, 0, 0, 0)',
        [uid],
      );
      await s.command(session, 'byebye', 2);
      // 提亲：参数个数/favor<50/档位/铜钱四层拒绝 → 高档 666 元宝掷不中直接成（公告+state 1）
      // → 3 小时冷却 → 空手档 100% 触发守护 NPC 418 的斗将（君主将落败不结）。
      await s.command(session, 'proposeMarry', 1);
      await s.command(session, 'proposeMarry', 1, 5);
      await s.query('update mem_marry_hero_favor set favor = 60 where uid = ? and hid = 1', [uid]);
      await s.command(session, 'proposeMarry', 1, 5);
      await s.command(session, 'proposeMarry', 1, 3);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 152, 300)', [uid]);
      s.rng([10006]);
      await s.command(session, 'proposeMarry', 1, 1);
      await s.command(session, 'proposeMarry', 1, 1); // 冷却文案带剩余时长，整条掩掉
      s.mask();
      await s.query(
        'update mem_marry_hero_favor set proposeCoolTime = 0 where uid = ? and hid = 1',
        [uid],
      );
      await s.command(session, 'proposeMarry', 1, 2); // 333 元宝档掷中 → PK 落败
      await s.command(session, 'proposeMarry', 1, 4); // 空手档 100% → PK 落败
      s.stopRng();
      // 好感礼品：类型/红颜/状态闸门 → 礼品梯缺货 → 送礼 +2 → 80 态 0 拒绝 → 88 怀孕迁移
      // （mem_marry_during 3 天）→ state 2 拒绝续送。
      await s.command(session, 'addMadamFavor', 3, 1);
      await s.command(session, 'addMadamFavor', 1, 999);
      await s.command(session, 'addMadamFavor', 1, 1);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 12068, 5)', [uid]);
      await s.command(session, 'addMadamFavor', 1, 1);
      await s.query(
        'update mem_marry_hero_favor set favor = 80, state = 0 where uid = ? and hid = 1',
        [uid],
      );
      await s.command(session, 'addMadamFavor', 1, 1);
      await s.query('update mem_marry_hero_favor set state = 1 where uid = ? and hid = 1', [uid]);
      await s.command(session, 'addMadamFavor', 1, 1); // 82
      await s.query('update mem_marry_hero_favor set favor = 88 where uid = ? and hid = 1', [uid]);
      await s.command(session, 'addMadamFavor', 1, 1); // 怀孕 → state 2
      await s.command(session, 'addMadamFavor', 1, 1);
      await s.command(session, 'loadMarryMadam');
      s.mask(4, 0, '*', 'leaveDuringTime');
      s.offset(4, 0, '*', 'coolingEndtime');
      s.offset(4, 0, '*', 'proposeCoolTime');
      // 胎教加速：500 元宝减 77760s 一次；第二次 has_speed；剩余时间与状态推送。
      await s.command(session, 'doSpeedFeta', 1);
      s.mask(4, 0, 'leaveDuringTime');
      s.offset(4, 0, 'endtime');
      s.offset(4, 0, 'starttime');
      await s.command(session, 'doSpeedFeta', 1);
      await s.command(session, 'getMadamLeavingTime', 999);
      await s.command(session, 'getMadamLeavingTime', 1);
      s.mask(4, 0, 'leaveDuringTime');
      s.offset(4, 0, 'endtime');
      s.offset(4, 0, 'starttime');
      // 房间数：孩子数兜底 1 的语义 + 状态推到 3。
      await s.command(session, 'checkRoomCount', 1);
      // 接生：铜钱路（152×200）→ 出生（名字/性别/四维 roll rng 钉死）。
      await s.query('update mem_marry_during set endtime = unix_timestamp() - 10 where uid = ?', [
        uid,
      ]);
      await s.command(session, 'getMadamChild', 3, 1);
      await s.command(session, 'getMadamChild', 1, 999);
      await s.command(session, 'getMadamChild', 1, 1);
      s.offset(4, 1, 'coolingEndtime');
      const [child] = await s.query<{ hid: string }>(
        'select hid from sys_user_child where uid = ? order by hid limit 1',
        [uid],
      );
      const childHid = Number(child?.hid ?? 0);
      // 培养：房间号闸门 → 培养丹缺失 → 成功培养两次（属性 roll rng 钉死）→ 出师
      // （herotype 10001 子将 + mem_hero_blood + out_hid 回写）。
      await s.command(session, 'loadChildCulture', 5, childHid);
      await s.command(session, 'loadChildCulture', 1, childHid);
      await s.command(session, 'startCulture', childHid, 1);
      await s.query('insert into sys_goods (uid, gid, count) values (?, 12059, 10)', [uid]);
      s.rng([10006]);
      await s.command(session, 'startCulture', childHid, 1);
      await s.command(session, 'startCulture', childHid, 1);
      await s.command(session, 'completeCulture', childHid);
      s.stopRng();
      s.mask(1, '*', 'name');
      // 改名：一次性。
      await s.command(session, 'changeChildName', childHid, '  小火龙  ');
      await s.command(session, 'changeChildName', childHid, 'x');
      // 开房：200 → 接生第二胎（元宝路 + wenpo）→ 400 → 封顶 3。
      await s.command(session, 'openChildRoom');
      await s.query(
        `insert into mem_marry_during (uid, hid, starttime, endtime, isSpeed)
         values (?, 1, unix_timestamp(), unix_timestamp() - 10, 0)`,
        [uid],
      );
      s.rng([10006]); // 第二胎的性别/四维/面容 roll 与第一胎同序
      await s.command(session, 'getMadamChild', 2, 1);
      s.stopRng();
      s.offset(4, 1, 'coolingEndtime');
      await s.command(session, 'openChildRoom');
      await s.command(session, 'openChildRoom');
      // 周游列国：出师子不可送 → 铜钱不足 → 送走换 50320 礼包。
      await s.command(session, 'deleteSpecialChild', childHid);
      await s.command(session, 'deleteSpecialChild', childHid + 1);
      await s.query('update sys_goods set count = 1000 where uid = ? and gid = 152', [uid]);
      await s.command(session, 'deleteSpecialChild', childHid + 1);
      s.mask(1, '*', 'name');
      await s.command(session, 'loadMarryChild');
      s.mask(1, '*', 'name');
      // 白名单幽灵命令：PHP 无定义 → WizardFunc GM 台空应答 → 两边都回裸头部。
      await s.command(session, 'sendGift', 1);
      await s.command(session, 'getMotherInfo');
    },
  },
  // --- battlefield (stage9/BattleFunc.php) ---------------------------------------------------
  // The 战场 slices: S1 hall readers, S2 create/join/quit lifecycle, S3 the tick arrivals and
  // the type-4 settlement, S4 the in-battle command face, S5 the task/chat/shop periphery.
  // Fixtures seed sys_user_battle_field/-state/-city rows directly; both engines answer through
  // their own port of the same BattleFunc.php lines. Per-case table rules: the battle tables
  // stamp unix_timestamp() into jointime/updatetime/evttime/… at insert (the two sides run a
  // second or two apart), and the quit cases scope mem_war_event out entirely — the new side's
  // push drain (war-event.service) deletes rows for battlefields nobody is in any more, while
  // the original only ever INSERTs them.
  {
    // S1: the 战况-entry readers on a save nobody is fighting in — every not-in-battle branch,
    // each reader's cheapest error gate, the medal quotes and the disabled-battlenet shapes.
    name: 'battlefield hall readers and their gates (empty state)',
    tables: {
      mem_war_event: { offsets: ['evttime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.command(session, 'refreshUserBattleState'); // [0] — 不在战场
      await s.command(session, 'getUserBattleInfo'); // [[0,0,-1],[0]]
      await s.command(session, 'getBattleInfo'); // 大厅列表 + 战况警报复位
      await s.command(session, 'getChibiInfo', 1);
      await s.command(session, 'getChibiInfo', 0);
      await s.command(session, 'getUserBattleState'); // 未入战分支（含等待队列探测）
      await s.command(session, 'getChibiGongXun'); // 赤壁网络关闭 → [0]
      await s.command(session, 'getChibiState4User', 1); // 爵位不足大夫
      await s.query('update sys_user set nobility = 5 where uid = ?', [uid]);
      await s.command(session, 'getChibiState4User', 1); // 史诗 (mem_state 5) 未完成
      await s.command(session, 'getMedalExchangeInfo'); // 勋章行情（各战场 type）
      await s.command(session, 'resetTodayWarCount'); // today_war_count 已是 0
      await s.query('update mem_user_schedule set today_war_count = 1 where uid = ?', [uid]);
      await s.command(session, 'resetTodayWarCount'); // 没有请战书 → not_enough_goods138
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 138, 1) on duplicate key update count = 1',
        [uid],
      );
      await s.command(session, 'resetTodayWarCount'); // 烧掉请战书，次数清零
      await s.command(session, 'getPVPBattleInfo', 1001); // 无实例行 → 仅列表
      await s.command(session, 'getPVPBattleInfo', 2001); // 官渡两阵营 + 每级一行
      await s.command(session, 'getPVPBattleInfo', 4001); // 只能加入汉室 (unionid 7)
      await s.command(session, 'getPVPBattleInfo', 6001); // 跨服兜底行 (25, 自己的名字)
      await s.command(session, 'getPVPBattleInfo', 7001); // 本包无 7001 阵营行
      await s.command(session, 'getPVPBattleInfo', 9999); // 未知 bid
      await s.command(session, 'getBattleNews', 1001, 0, 0, 10); // 空战报页
      await s.command(session, 'getBattleInfor', 1001, 1); // 场次 1 是官渡且 state 2 → 拒绝
      await s.query(
        `insert into sys_user_battle_field (bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
      );
      await s.command(session, 'getBattleInfor', 1001, 31); // state-0 场次的详情行
      await s.command(session, 'getBattleActiveState'); // 总览：开放/未开放/条件进行中
      // 行序：原版对 cfg_battle_field 不加 ORDER BY，MyISAM 磁盘序 (…10001, 8001…) 与 InnoDB
      // 主键序不同 — 该列表按多重集比对。
      s.unordered(4, 0);
      await s.command(session, 'getBattleTime'); // 倍率时刻表（date 折算 mm.dd + weekday）
      await s.command(session, 'getBattleNetUrl'); // BATTLE_NET 关闭 → [[]]
    },
  },
  {
    // S2: createBattle 的每一个拒绝分支 — 爵位、未知/未开战场、当日次数、荣誉、开房上限、
    // 讨伐令 (道具 137, level>10)、黄巾门票 (demandGoods 30:2,31:2) 与已在战场。
    name: 'battlefield createBattle refuses every bad ticket',
    tables: {
      // 结尾的成功开房插入真实 starttime/endtime（endtime = now + maxtime），两边相差秒级。
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.command(session, 'createBattle', 1001, 1); // 爵位 0 → nobility_not_rearch
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.command(session, 'createBattle', 7001, 1); // 无 cfg_battle_field 行
      await s.command(session, 'createBattle', 2001, 1); // 官渡 state 0 → no_battle_field
      await s.query('update mem_user_schedule set today_war_count = 5 where uid = ?', [uid]);
      await s.command(session, 'createBattle', 1001, 1); // 当日次数 5/5
      await s.query('update mem_user_schedule set today_war_count = 0 where uid = ?', [uid]);
      await s.query('update sys_user set honour = -1 where uid = ?', [uid]);
      await s.command(session, 'createBattle', 1001, 1); // 荣誉为负
      await s.query('update sys_user set honour = 1000 where uid = ?', [uid]);
      await s.query('update cfg_battle_field set maxcount = 0 where id = 1001');
      await s.command(session, 'createBattle', 1001, 1); // 房间数达上限
      await s.query('update cfg_battle_field set maxcount = 300 where id = 1001');
      await s.command(session, 'createBattle', 1001, 12); // 12 级要 2 张讨伐令 → #2
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 137, 1) on duplicate key update count = 1',
        [uid],
      );
      await s.command(session, 'createBattle', 1001, 1); // 黄巾票 31 缺货 → join_resource_not_enough
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 30, 2), (?, 31, 2) on duplicate key update count = values(count)',
        [uid, uid],
      );
      await s.query(
        `insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level, state)
         values (?, 1001, 1, 1, 1, 0)`,
        [uid],
      );
      await s.command(session, 'createBattle', 1001, 1); // 已在战场
      await s.query('delete from sys_user_battle_state where uid = ?', [uid]);
      // 全部门票就位后成功开房（建 NPC 军的 rand() 序列在下一个用例固定；此处只看成功面）。
      s.seed(11);
      const ret = await s.command(session, 'createBattle', 1001, 11);
      s.stopRng();
      s.mask(0, 'endtime'); // endtime = now + maxtime，两边相差秒级
      void ret;
    },
  },
  {
    // S2+S1: createBattle 成功开房（createSoldier 的 rand() 固定）后，大厅的各读口翻到在战态。
    // 用例结束仍留在战场 → mem_war_event 行两边都保留（新侧 drain 不删）。
    name: 'battlefield createBattle opens 黄巾之乱 and the hall follows',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_war_buf: { offsets: ['updatetime'] },
      mem_war_event: { offsets: ['evttime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // 原始库存留有战场 35 的孤儿城池行（sys_battle_city 635xxx），而 sys_user_battle_field
      // 的自增恰从 35 起 — 新开房间必然撞唯一键（原版同样中途 die 留半成品）。用例双方先清掉
      // 这批孤儿行，让 createBattle 走到成功面。
      await s.query('delete from sys_battle_city where cid between 635000 and 636000');
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 30, 2), (?, 31, 2), (?, 137, 1) on duplicate key update count = values(count)',
        [uid, uid, uid],
      );
      s.rng([1, 2, 3, 4, 5, 6, 7, 8, 9, 2]); // createSoldier 的 rand()，按请求循环重放
      const ret = await s.command(session, 'createBattle', 1001, 1);
      s.stopRng();
      s.offset(4, 0, 'endtime'); // 房间 endtime = now + 10800，两边差秒级
      // 回包是 AMF 信封 [1, 2, 0, funcName, result] — createBattle 的结果在 [4]。
      const bfid = ((ret as unknown[])[4] as unknown[])[0] as { battlefieldid: number };
      await s.command(session, 'getUserBattleState'); // 在战全量：旗帜/军队/出生据点
      s.offset(4, 3, 'endtime'); // [4][3] = sys_user_battle_field 行，endtime 两边差秒级
      s.unordered(4, 2); // cfg_battle_field 列表无 ORDER BY：MyISAM 磁盘序 ≠ InnoDB 主键序
      await s.command(session, 'refreshUserBattleState');
      s.offset(4, 1, 'endtime'); // [4][1] = sys_user_battle_field 行，endtime 两边差秒级
      await s.command(session, 'getPVPBattleInfo', 1001); // 自己的 level-1 房 + people 1
      await s.command(session, 'getBattleInfo'); // canCreate 翻转前后一致地重算
      s.unordered(4, 2);
      await s.command(session, 'getBattleInfor', 1001, bfid.battlefieldid);
      await s.command(session, 'getQuitResult'); // winner -1 → [-1]
    },
  },
  {
    // S2: joinToPVPBattle / joinToBattle 的拒绝与成功面 + quitBattle 的逃跑结算。中途 quit 会
    // 清空战场 31 的参战者 → 新侧 drain 丢 mem_war_event 行（原版只写不删）→ 该表跳过比对。
    name: 'battlefield join paths (PVP auto-pick, invite join) and an escape quit',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_war_buf: { offsets: ['updatetime'] },
      mem_war_event: { skip: () => true },
      log_battle_honour: { offsets: ['quittime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.command(session, 'joinToPVPBattle', 2001, 0, 3); // 官渡关闭 → 兜底行 → max_people
      await s.command(session, 'joinToPVPBattle', 9999, 1, 1); // 无场次 → no_battle_field
      await s.command(session, 'joinToPVPBattle', 1001, 31, 1); // 场次 31 不存在
      await s.query(
        `insert into sys_user_battle_field (bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
      );
      await s.command(session, 'joinToPVPBattle', 1001, 31, 1); // 黄巾票缺 31
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 30, 2), (?, 31, 2) on duplicate key update count = values(count)',
        [uid, uid],
      );
      await s.command(session, 'joinToPVPBattle', 1001, 31, 1); // 成功（扣票、进门、初始任务）
      await s.command(session, 'joinToPVPBattle', 1001, 31, 1); // 已在战场
      await s.command(session, 'getBattleInvite'); // 自己没有邀请
      await s.command(session, 'joinToBattle', 999); // 邀请不存在
      await s.query(
        `insert into sys_battle_invite (fromuid, battlename, battlefieldid, level, time, touid,
           state, fromname, toname)
         values (1002, '黄巾之乱', 31, 1, unix_timestamp(), 1002, 0, '飓鼎玩网单', '飓鼎玩网单')`,
      );
      await s.command(session, 'joinToBattle', 31); // touid 不是自己 → no_such_invite
      await s.command(session, 'quitBattle'); // winner -1 → 逃跑：荣誉 -level²·20、关场
      await s.command(session, 'quitBattle'); // 已不在战场
      // 重进一场再走一次 joinToBattle 成功面（门票重新入库）。
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 30, 2), (?, 31, 2) on duplicate key update count = values(count)',
        [uid, uid],
      );
      await s.query(
        `insert into sys_user_battle_field (bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
      );
      await s.query(
        `insert into sys_battle_invite (fromuid, battlename, battlefieldid, level, time, touid,
           state, fromname, toname)
         values (1002, '黄巾之乱', 32, 1, unix_timestamp(), ?, 0, '飓鼎玩网单', '长乐')`,
        [uid],
      );
      await s.command(session, 'joinToBattle', 32); // 成功：删邀请、进门、初始任务
      await s.command(session, 'getBattleInvite'); // 邀请已被 join 消费
      await s.command(session, 'getQuitResult');
    },
  },
  {
    // S2: 邀请生命周期 — 创建者邀请/重复邀请/未知玩家、被邀视角的 getBattleInvite/ignore、
    // 创建者撤回 cancelBattleInvite，以及 getBattleFieldUsers 的在战+邀请合并视图。
    name: 'battlefield invites (inviteBattleUser, ignore, cancel, member list)',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_war_buf: { offsets: ['updatetime'] },
      mem_war_event: { offsets: ['evttime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      // 同上一用例：先清掉原始库存的战场 35 孤儿城池行，createBattle 才能以 id 35 走完。
      await s.query('delete from sys_battle_city where cid between 635000 and 636000');
      await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 30, 2), (?, 31, 2), (?, 137, 1) on duplicate key update count = values(count)',
        [uid, uid, uid],
      );
      s.seed(5);
      const created = await s.command(session, 'createBattle', 1001, 1);
      s.stopRng();
      s.offset(4, 0, 'endtime'); // 房间 endtime = now + 10800，两边差秒级
      // 回包是 AMF 信封 [1, 2, 0, funcName, result] — 结果在 [4]，inviteBattleUser 的
      // 邀请行在 result[3]。
      const fieldid = (((created as unknown[])[4] as unknown[])[0] as { battlefieldid: number })
        .battlefieldid;
      const invited = await s.command(session, 'inviteBattleUser', fieldid, '飓鼎玩网单', '长乐');
      const invite = ((invited as unknown[])[4] as unknown[])[3] as { id: number };
      await s.command(session, 'inviteBattleUser', fieldid, '飓鼎玩网单', '长乐'); // 重复邀请
      await s.command(session, 'inviteBattleUser', fieldid, 'npc', '长乐'); // 第二个被邀人
      await s.command(session, 'inviteBattleUser', fieldid, '不存在的人', '长乐');
      await s.command(session, 'inviteBattleUser', 999, 'npc', '长乐'); // 不在战场
      await s.command(session, 'getBattleInvite'); // 自己名下无邀请
      await s.query(
        `insert into sys_battle_invite (fromuid, battlename, battlefieldid, level, time, touid,
           state, fromname, toname)
         values (1002, '黄巾之乱', ?, 1, unix_timestamp(), ?, 0, '飓鼎玩网单', '长乐')`,
        [fieldid, uid],
      );
      await s.command(session, 'getBattleInvite'); // 被邀视角：一行 pending
      await s.command(session, 'ignoreBattle', 32); // 谁的邀请都能忽略（原样）
      await s.command(session, 'cancelBattleInvite', invite.id); // 创建者撤回
      await s.command(session, 'cancelBattleInvite', 999); // 不存在
      await s.command(session, 'getBattleFieldUsers', fieldid); // 在战 1 人 + npc 邀请
      await s.command(session, 'getBattleHonourStat'); // 剧情战场 → 不支持
    },
  },
  {
    // S2: quitBattle 的四种结算 — 准备 (quittype 3)、逃跑 (2)、失败 (1)、胜利 (0，canwin 的
    // false/true 两态：黄巾主线 goal 60000-60002 计数 3 才算赢)。空场关场 + 3001 winner 6、
    // 胜利犒赏 gid 19990、勋章 addThings、log_battle_honour、战报 40 全部落库比对。
    name: 'battlefield quitBattle settles every quit type',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_war_buf: { offsets: ['updatetime'] },
      mem_war_event: { skip: () => true },
      log_battle_honour: { offsets: ['quittime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const seedField = async (id: number, state: number, winner: number, createuid: number) => {
        await s.query(
          `insert into sys_user_battle_field (id, bid, createuid, level, maxpeople, state,
             starttime, endtime, finishtime, type, minpeople, winner, progress)
           values (?, 1001, ?, 1, 5, ?, 0, 0, 0, 0, 1, ?, 0)`,
          [id, createuid, state, winner],
        );
        await s.query(
          `insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level, state)
           values (?, 1001, ?, 1, 1, 0)`,
          [uid, id],
        );
      };
      // 准备态 (state 2)：quittype 3，不写 log，称号文案不同。
      await seedField(31, 2, -1, 1002);
      await s.command(session, 'getQuitResult'); // [2]
      await s.command(session, 'quitBattle');
      // 逃跑 (winner -1)：荣誉 -20，创建者空场转队长（无他人 → 不动）。
      await seedField(32, 0, -1, uid);
      await s.command(session, 'getQuitResult'); // [-1]
      await s.command(session, 'quitBattle');
      // 失败 (winner 3 袁绍)：荣誉 -5。
      await seedField(33, 0, 3, 1002);
      await s.command(session, 'quitBattle');
      // 胜利但没做满黄巾主线 goal → canwin false：荣誉 +0、勋章 0，犒赏 19990 照发。
      await seedField(34, 0, 1, 1002);
      s.rng([50]); // mt_rand(1,100) 的战场活动 roll（canwin false 时先消耗）
      await s.command(session, 'quitBattle');
      s.stopRng();
      // 补上三条主线 goal 再胜利退出 → 荣誉 +level²·8·rate、勋章 +level、活动 roll 空转。
      await seedField(35, 0, 1, 1002);
      await s.query(
        'insert into sys_user_goal (uid, gid) values (?, 101951), (?, 101952), (?, 101953)',
        [uid, uid, uid],
      );
      s.rng([50]);
      await s.command(session, 'quitBattle');
      s.stopRng();
      await s.query('delete from sys_user_battle_state where uid = ?', [uid]);
    },
  },
  {
    // S3: task 7 战场出征到达（park、军报 36）与 task 8 战场调遣到达（battleid 复位、两个据点
    // resetBattleFieldUid、虎牢关门 101982、cfg_battle_event triggerid 367 的任务触发器、
    // 死代码 winpoint 块）。用例结束仍留战场。
    name: 'battlefield tick settles task 7 and task 8 arrivals at the strongholds',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      // 资源波未移植：任务到达公共收尾的 check_city_resource 会按各自引擎重算城池上限
      // （legacy 多计了城内建筑加成），sys_city_res_add 的空据点初始化行同样属于资源波 —
      // 本用例的真实断言在 sys_troops / sys_report / sys_user_goal / sys_battle_city。
      mem_city_resource: { skip: () => true },
      sys_city_res_add: { skip: () => true },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const bfid = 31;
      const cidOf = (xy: number) => (bfid + 600) * 1000 + xy; // utils.php battleid2cid
      await s.query(
        `insert into sys_user_battle_field (id, bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (?, 1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
        [bfid],
      );
      await s.query(
        `insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level, state)
         values (?, 1001, ?, 1, 1, 0)`,
        [uid, bfid],
      );
      for (const [xy, name, unionid] of [
        [767, '襄阳', 1],
        [101, '钜鹿', 2],
        [164, '下曲阳', 2],
        [223, '东郡', 2],
        [367, '虎牢关', 0],
      ] as const) {
        await s.query(
          `insert into sys_battle_city (cid, battlefieldid, name, nextxy, \`drop\`, unionid, rate,
             uid, xy, image, hasuser, winpoint, losepoint, ownerunionid, can_quest)
           values (?, ?, ?, '0', '-1', ?, 0, 0, ?, 0, 0, 0, 0, 0, 0)`,
          [cidOf(xy), bfid, name, unionid, xy],
        );
      }
      // task 7：从襄阳出发去虎牢关（无将领，纯兵力）。
      await s.query(
        `insert into sys_troops (uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource, people, fooduse, battlefieldid, startcid, battleunionid, bid)
         values (?, 209355, 0, ?, 7, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1,
           '1,7,100', '0', 0, 0, ?, 209355, 1, 1001)`,
        [uid, cidOf(367), bfid],
      );
      await s.tick('HandleTroop'); // 虎牢关驻军 (state 4) + 军报 36
      // task 8：襄阳 → 虎牢关的调遣；另留一支黄巾 NPC 在东郡撑起 triggertype 2 的"敌军尚在"闸门。
      await s.query(
        `insert into sys_troops (uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource, people, fooduse, battlefieldid, startcid, battleunionid, bid)
         values (?, ?, 0, ?, 8, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1,
           '1,7,100', '0', 0, 0, ?, ?, 1, 1001)`,
        [uid, cidOf(767), cidOf(367), bfid, cidOf(767)],
      );
      await s.query(
        `insert into sys_troops (uid, cid, hid, soldiers, state, \`drop\`, rate, battlefieldid,
           battleunionid, bid)
         values (0, ?, 1004, '1,19,50,', 4, '', 0, ?, 2, 1001)`,
        [cidOf(223), bfid],
      );
      await s.tick('HandleTroop'); // 虎牢关门 101982 + 事件 60015 + 两据点重判定 + 军报 37
      await s.command(session, 'selectOneTroop', 2); // 军队现位（取 id 序第二支）
    },
  },
  {
    // S3: 战场战斗 (type 4) 打到终局 — 攻击同据点 NPC 驻军 → mem_battle → HandleBattle 推回合
    // → getBattleResult end 0 type 4：战况消息 (mem_war_event)、cfg_battle_event 终局触发器、
    // bak_troops 快照、胜方驻防。随机序列固定。
    name: 'battlefield battle runs a type-4 fight to settlement',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      // 资源波未移植：任务到达公共收尾的 check_city_resource 会按各自引擎重算城池上限
      // （legacy 多计了城内建筑加成），sys_city_res_add 的空据点初始化行同样属于资源波 —
      // 本用例的真实断言在 sys_troops / sys_report / sys_user_goal / sys_battle_city。
      mem_city_resource: { skip: () => true },
      sys_city_res_add: { skip: () => true },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_war_event: { offsets: ['evttime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const bfid = 31;
      const cidOf = (xy: number) => (bfid + 600) * 1000 + xy;
      await s.query(
        `insert into sys_user_battle_field (id, bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (?, 1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
        [bfid],
      );
      await s.query(
        `insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level, state)
         values (?, 1001, ?, 1, 1, 0)`,
        [uid, bfid],
      );
      await s.query(
        `insert into sys_battle_city (cid, battlefieldid, name, nextxy, \`drop\`, unionid, rate,
           uid, xy, image, hasuser, winpoint, losepoint, ownerunionid, can_quest)
         values (?, ?, '虎牢关', '0', '-1', 0, 0, 0, 367, 0, 0, 0, 0, 0, 0)`,
        [cidOf(367), bfid],
      );
      await s.query(
        `insert into sys_troops (uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource, people, fooduse, battlefieldid, startcid, battleunionid,
           bid, targettroopid)
         values (?, 209355, 80213, ?, 9, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1,
           '1,7,2000', '0', 0, 0, ?, 209355, 1, 1001, 900001)`,
        [uid, cidOf(367), bfid],
      );
      // 虎牢关的黄巾驻军（弱，让攻击方速胜）。
      await s.query(
        `insert into sys_troops (id, uid, cid, hid, soldiers, state, \`drop\`, rate, battlefieldid,
           battleunionid, bid)
         values (900001, 0, ?, 1011, '1,18,5,', 4, '', 0, ?, 2, 1001)`,
        [cidOf(367), bfid],
      );
      s.rng([1, 2, 1, 0, 0, 3, 1]); // 回合目标选择 + 终局负伤/俘获 roll
      await s.tick('HandleTroop');
      for (let i = 0; i < 45; i++) await s.tick('HandleBattle');
      s.stopRng();
      await s.query('delete from sys_troops where uid = ? or id = 900001', [uid]);
      await s.query('delete from mem_battle where attackcid = ? or resistcid = ?', [
        209355,
        cidOf(367),
      ]);
    },
  },
  {
    // S4: 战场内指令面 — startBattleTroop 出征、getBattleFieldState 快照、校场闸门、调遣/攻击
    // （邻接/同阵营/锁定）、探索 60 秒冷却、召军/援军池/回军/加速/信鸽侦察、军队详情与木料监官。
    name: 'battlefield in-battle command face marches, fights and supports the armies',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      // 资源波未移植：任务到达公共收尾的 check_city_resource 会按各自引擎重算城池上限
      // （legacy 多计了城内建筑加成），sys_city_res_add 的空据点初始化行同样属于资源波 —
      // 本用例的真实断言在 sys_troops / sys_report / sys_user_goal / sys_battle_city。
      mem_city_resource: { skip: () => true },
      sys_city_res_add: { skip: () => true },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_battle_event_mark: { offsets: ['time'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const bfid = 31;
      const cidOf = (xy: number) => (bfid + 600) * 1000 + xy;
      await s.query(
        `insert into sys_user_battle_field (id, bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (?, 1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
        [bfid],
      );
      await s.query(
        `insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level, state)
         values (?, 1001, ?, 1, 1, 0)`,
        [uid, bfid],
      );
      // 襄阳(1) — 钜鹿(2) — 下曲阳(2) — 东郡(2) 的邻接图；钜鹿可探索。
      for (const [xy, name, unionid, nextxy, canQuest] of [
        [767, '襄阳', 1, '2,101,164,', 0],
        [101, '钜鹿', 2, '2,767,164,', 1],
        [164, '下曲阳', 2, '3,767,101,282,', 0],
        [282, '陈留', 2, '1,164,', 0],
      ] as const) {
        await s.query(
          `insert into sys_battle_city (cid, battlefieldid, name, nextxy, \`drop\`, unionid, rate,
             uid, xy, image, hasuser, winpoint, losepoint, ownerunionid, reinforce_soldiers, can_quest)
           values (?, ?, ?, ?, '-1', ?, 0, 0, ?, 0, 0, 0, 0, 0, ?, ?)`,
          [cidOf(xy), bfid, name, nextxy, unionid, xy, xy === 101 ? '1,7,50,' : null, canQuest],
        );
      }
      // T1 从主城出征；T2 直接驻在钜鹿；T3 在调遣途中；T4 剩余 5 秒（加速拒绝面）。
      await s.command(session, 'startBattleTroop', 209355, 80213, '1,7,500', 0, 767);
      await s.query(
        `insert into sys_troops (uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource, people, fooduse, battlefieldid, startcid, battleunionid, bid)
         values (?, ?, 80213, ?, 7, 4, unix_timestamp(), 0, 0, '1,7,100', '0', 0, 0, ?, ?, 1, 1001)`,
        [uid, cidOf(101), cidOf(101), bfid, cidOf(101)],
      );
      await s.query(
        `insert into sys_troops (uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource, people, fooduse, battlefieldid, startcid, battleunionid, bid)
         values (?, ?, 0, ?, 8, 0, unix_timestamp(), 600, unix_timestamp() + 600,
           '1,7,20', '0', 0, 0, ?, ?, 1, 1001)`,
        [uid, cidOf(101), cidOf(164), bfid, cidOf(101)],
      );
      await s.query(
        `insert into sys_troops (uid, cid, hid, targetcid, task, state, starttime, pathtime,
           endtime, soldiers, resource, people, fooduse, battlefieldid, startcid, battleunionid, bid)
         values (?, ?, 0, ?, 8, 0, unix_timestamp(), 600, unix_timestamp() + 5,
           '1,7,5', '0', 0, 0, ?, ?, 1, 1001)`,
        [uid, cidOf(164), cidOf(282), bfid, cidOf(164)],
      );
      const mine = await s.query<{ id: string; targetcid: string }>(
        'select id, targetcid from sys_troops where uid = ? order by id',
        [uid],
      );
      const t1 = Number(mine[0]!.id); // startBattleTroop 的那支（先插）
      const t2 = Number(mine[1]!.id);
      const t3 = Number(mine[2]!.id);
      const t4 = Number(mine[3]!.id);
      // 敌军：钜鹿的黄巾悍将 + 陈留的黄巾军 + 监官 (8056)。
      await s.query(
        `insert into sys_troops (id, uid, cid, hid, soldiers, state, \`drop\`, rate, battlefieldid,
           battleunionid, bid)
         values (900101, 0, ?, 1011, '1,18,10,', 4, '', 0, ?, 2, 1001),
                (900102, 0, ?, 1004, '1,19,10,', 4, '', 0, ?, 2, 1001),
                (900103, 0, ?, 8056, '1,20,5,', 4, '', 0, ?, 2, 1001)`,
        [cidOf(101), bfid, cidOf(282), bfid, cidOf(101), bfid],
      );
      // T2 随身的木料（监官对话的转移物）。
      await s.query(
        'insert into sys_troop_things (uid, troop_id, thing_id, count) values (?, ?, 83, 100)',
        [uid, t2],
      );
      await s.query(
        'insert into sys_goods (uid, gid, count) values (?, 135, 1), (?, 136, 3), (?, 140, 1) on duplicate key update count = values(count)',
        [uid, uid, uid],
      );
      await s.tick('HandleTroop'); // T1 从主城进入襄阳 (state 4)
      await s.command(session, 'getBattleFieldState', bfid, 1, cidOf(767), '襄阳', cidOf(767));
      await s.command(session, 'getCurrentCityGroundLevel1', 209355);
      await s.command(session, 'getCurrentCityGroundLevel2', 209355);
      await s.command(session, 'getInfoForBattleArmyReinforce', cidOf(767));
      await s.command(session, 'getInfoForBattleArmySend', t1, cidOf(101), '钜鹿');
      await s.command(session, 'getInfoForBattleArmyAttack', t1, 900101, '黄巾悍将');
      await s.command(session, 'selectOneTroop', t1);
      await s.command(session, 'battleTroopDispatch', t1, cidOf(101), '长乐', '钜鹿');
      await s.command(session, 'battleTroopDispatch', t2, cidOf(282), '长乐', '陈留'); // 不邻接
      await s.tick('HandleTroop'); // T1 进钜鹿；两据点重判定（钜鹿混营 → 争夺中）
      await s.command(session, 'battleAttack', t2, 900101, '黄巾悍将', '钜鹿'); // 同据点 10 秒
      await s.command(session, 'battleAttack', t2, 900102, '黄巾军', '陈留'); // 不邻接
      await s.command(session, 'battleAttack', t2, t1, '长乐', '钜鹿'); // 同阵营
      await s.command(session, 'questInCity', 80213, cidOf(101));
      await s.command(session, 'questInCity', 80213, cidOf(101)); // 60 秒冷却
      await s.command(session, 'callArmy', t2, 7, 100); // 援军令 1 张、荣誉 -3
      await s.command(session, 'callArmy', t2, 7, 100000); // 超过 honor/人数上限
      await s.command(session, 'addArmyFromReinforce', cidOf(101), t2, 7); // 池里 50 个
      await s.command(session, 'addArmyFromReinforce', cidOf(101), t2, 7); // 池已空
      await s.command(session, 'getCityBattleTroopDetail', 900101);
      await s.command(session, 'getBattleTroopDetail', 900101);
      await s.command(session, 'getBattleTroopDetail', t3);
      s.offset(4, 0, 'endtime'); // t3 详情里的行军 endtime，两边差秒级
      // 注：t2 在 battleAttack 后已是 task-9 进攻态（endtime=now+10），fasterArmy 的
      // `<10 秒` 检查落在秒边界上，两边谁成功取决于请求是否跨秒 — 固有非确定，跳过；
      // 状态 4 驻军的 troop_not_in_move 拒绝面此场景不再可达。
      await s.command(session, 'fasterArmy', t3, bfid); // 成功：剩 600 秒
      s.offset(4, 0, 'endtime'); // 加速后的 endtime = now+10，两边差秒级
      await s.command(session, 'fasterArmy', t4, bfid); // 剩 5 秒 → 拒绝
      await s.command(session, 'battlePatrol', t2, 900101); // 没有信鸽
      await s.command(session, 'battlePatrol', t2, 900102); // 信鸽侦察陈留 → 45 号战报
      await s.command(session, 'callBackArmy', t1); // 钜鹿撤回主城
      await s.command(session, 'callBackToField', t3, bfid); // 调遣途中召回
      await s.command(session, 'chatWithHero', t2, 900103); // 木料监官：100/5000，无阶段钟
      await s.command(session, 'chatWithHero', t2, 900101); // 无对话事件 → 默认台词
      await s.command(session, 'getFasterGoodInfo', 136);
    },
  },
  {
    // S5: 战场周边 — 任务面板 (refreshBattleTaskState/getLastMainTask)、战场商城与勋章购买
    // （沙场积分/黄巾勋章、限购、缺货）、成员视图。回包的 endtime 类字段用 mask 抹秒差。
    name: 'battlefield periphery: task panel, NPC shop, member views',
    tables: {
      sys_user_battle_field: { offsets: ['starttime', 'endtime', 'finishtime'] },
      sys_user_battle_state: {
        only: [
          'uid',
          'bid',
          'battlefieldid',
          'unionid',
          'level',
          'state',
          'honour',
          'sent_troop_count',
          'startcid',
          'in_cross_battle',
          'in_battle_hids',
        ], // jointime 是 CURRENT_TIMESTAMP datetime，两边差秒级
      },
      mem_war_buf: { offsets: ['updatetime'] },
      mem_war_event: { offsets: ['evttime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const bfid = 31;
      await s.query(
        `insert into sys_user_battle_field (id, bid, createuid, level, maxpeople, state, starttime,
           endtime, finishtime, type, minpeople, winner, progress)
         values (?, 1001, 1002, 1, 5, 0, 0, 0, 0, 0, 1, -1, 0)`,
        [bfid],
      );
      await s.query(
        `insert into sys_user_battle_state (uid, bid, battlefieldid, unionid, level, state)
         values (?, 1001, ?, 1, 1, 0)`,
        [uid, bfid],
      );
      // 任务面板素材：60901-60905 挂起，另造一条 9001 主线链。
      for (let tid = 60901; tid <= 60905; tid++) {
        await s.query('insert into sys_user_task (uid, tid, state) values (?, ?, 0)', [uid, tid]);
      }
      for (let tid = 60906; tid <= 60914; tid++) {
        await s.query('insert into sys_user_task (uid, tid, state) values (?, ?, 0)', [uid, tid]);
      }
      await s.command(session, 'refreshBattleTaskState');
      await s.command(session, 'getLastMainTask', 1001); // 非 9001 → 空
      await s.command(session, 'getLastMainTask', 9001); // 60901-60914 链
      await s.command(session, 'getUserBattleShopInfo');
      s.unordered(4, 1); // cfg_battle_field 列表无 ORDER BY：MyISAM 磁盘序 ≠ 主键序
      s.unordered(4, 7); // 装甲列表 (cfg_armor join) 原版同样无 ORDER BY，两引擎计划序不同
      await s.command(session, 'getUserBattleShopInfoForChiBi');
      s.unordered(4, 1);
      s.unordered(4, 7);
      await s.command(session, 'buyBattleGoods', 0, 1, 0, 0); // 下架
      await s.command(session, 'buyBattleGoods', 41011, 0, 0, 0); // 数量非法
      await s.command(session, 'buyBattleGoods', 41011, 1, 0, 0); // 沙场积分不足
      await s.query(
        'insert into sys_things (uid, tid, count) values (?, 104001, 100) on duplicate key update count = values(count)',
        [uid],
      );
      await s.command(session, 'buyBattleGoods', 41011, 1, 0, 0); // 扣积分买 gid 1010
      await s.query(
        'insert into sys_things (uid, tid, count) values (?, 30001, 200) on duplicate key update count = values(count)',
        [uid],
      );
      await s.command(session, 'buyBattleGoods', 20001, 1, 1, 0); // 限购装备第一次
      await s.command(session, 'buyBattleGoods', 20001, 1, 1, 0); // 达每日限购
      await s.command(session, 'getBattleFieldUsers', bfid);
    },
  },
  {
    // 排行联动: quitBattle 落的 log_battle_honour 是 rank_battle_* 的源 — 先种荣誉流水，
    // 再跑 UpdateUsersCurse（'is' 补丁让 HandleUsersRank 必跑），读三个战场榜。
    name: 'battlefield honour log feeds the rank_battle boards',
    tables: {
      log_battle_honour: { offsets: ['quittime'] },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query(
        `insert into log_battle_honour (uid, battleid, battlefieldid, starttime, quittime,
           result, honour, metal, unionid, level)
         values (?, 1001, 31, 0, unix_timestamp(), 0, 120, 1, 1, 1),
                (?, 1001, 32, 0, unix_timestamp() - 100, 1, 30, 0, 1, 2),
                (?, 2001, 33, 0, unix_timestamp() - 700000, 2, 500, 3, 3, 5)`,
        [uid, uid, uid],
      );
      await s.query('update sys_user set honour = 650 where uid = ?', [uid]);
      await s.tick('UpdateUsersCurse', { hour: 8, weekday: 6 });
      await s.command(session, 'getPageRank', 0, 'battle_total');
      await s.command(session, 'getPageRank', 0, 'battle_day');
      await s.command(session, 'getPageRank', 0, 'battle_week');
    },
  },

  // W4: keep response errors exact; successful writes are compared by the normal table delta.
  {
    name: 'W4 relocation: ordinary validation order and unique random destination',
    tables: { log_move_city: { offsets: ['time'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const target = await w4MoveDestination(s, cid);
      await s.query('delete from sys_goods where uid = ? and gid = 24', [session.uid]);
      await s.command(session, 'changeCityPosition', 99, 999999); // province before goods/owner
      await s.query('update mem_world set state = 1 where wid = ?', [cid2wid(target)]);
      await s.command(session, 'changeCityPosition', 18, 999999); // land exists, none usable
      await s.query('update mem_world set state = 0 where wid = ?', [cid2wid(target)]);
      await s.command(session, 'changeCityPosition', 18, 999999); // goods before ownership
      await w4Goods(s, session.uid, 24, 2);
      await s.command(session, 'changeCityPosition', 18, 999999);
      await s.query('update mem_world set state = 1 where wid = ?', [cid2wid(cid)]);
      await s.command(session, 'changeCityPosition', 18, cid); // own city in battle
      await s.query('update mem_world set state = 0 where wid = ?', [cid2wid(cid)]);
      s.rng([17]); // province 0 draws province 18; SQL RAND is pinned by the unique candidate
      w4Success(await s.command(session, 'changeCityPosition', 0, cid));
      await w4Number(
        s,
        'select lastcid as value from sys_user where uid = ?',
        [session.uid],
        target,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 24',
        [session.uid],
        1,
      );
      await w4Number(
        s,
        'select ownercid as value from mem_world where wid = ?',
        [cid2wid(target)],
        target,
      );
      // Both ids are deterministic and deliberately not aliased: cid/wid alias collisions cannot hide a write.
    },
  },
  {
    name: 'W4 relocation: advanced coordinates, item before owner, schedule and inventory',
    tables: {
      log_move_city: { offsets: ['time'] },
      mem_city_schedule: {
        ignore: ['next_good_event', 'next_bad_event'],
        offsets: ['last_anming', 'last_reset_recruit', 'last_adv_move'],
      },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const target = await w4MoveDestination(s, cid);
      const x = target % 1000;
      const y = Math.floor(target / 1000);
      await s.query('delete from sys_goods where uid = ? and gid = 82', [session.uid]);
      await s.command(session, 'changeCityPositionPointing', -1, y, 999999);
      await s.command(session, 'changeCityPositionPointing', 501, y, 999999);
      await s.command(session, 'changeCityPositionPointing', x, y, 999999);
      await w4Goods(s, session.uid, 82, 2);
      await s.command(session, 'changeCityPositionPointing', x, y, 999999);
      await s.command(
        session,
        'changeCityPositionPointing',
        cid % 1000,
        Math.floor(cid / 1000),
        cid,
      );
      w4Success(await s.command(session, 'changeCityPositionPointing', x, y, cid));
      await w4Number(
        s,
        'select lastcid as value from sys_user where uid = ?',
        [session.uid],
        target,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 82',
        [session.uid],
        1,
      );
      await w4Number(
        s,
        'select (last_adv_move >= unix_timestamp() - 10) as value from mem_city_schedule where cid = ?',
        [target],
        1,
      );
    },
  },
  {
    name: 'W4 protection: free extension, paid cooldown bypass, recovery and allowPK upsert',
    tables: {
      log_action_time: { offsets: ['time'] },
      sys_user_action_log: { offsets: ['time'] },
    },
    run: async (s) => {
      s.rng([0]); // Pin giveDalibao's mt_rand(0, 1) to gid 50186 on both servers.
      const session = await s.login(EXISTING_PLAYER);
      s.stopRng();
      const uid = session.uid;
      await w4Idle(s, uid);
      await s.query('update mem_state set value = 0 where state = 197');
      await s.query("delete from sys_user_action_log where uid = ? and action = 'usemianzhan'", [
        uid,
      ]);
      await w4Goods(s, uid, 12, 10);
      await s.command(session, 'changeUserState', -1, 0);
      await s.command(session, 'changeUserState', 4, 0);
      await s.command(session, 'changeUserState', 0, 0); // already normal
      await s.command(session, 'loadMianZhanEndTime'); // absent buffer and counter
      w4Success(await s.command(session, 'changeUserState', 1, 0));
      // loadUserGoods: things only ORDER BY cfg_things.position (ties may permute).
      // Keep goods at [4][1][0] ordered: cfg_goods.group,gid includes the unique gid.
      s.unordered(4, 1, 1);
      w4Success(await s.command(session, 'changeUserState', 1, 0)); // second use consumes two
      s.unordered(4, 1, 1);
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 12',
        [uid],
        7,
      );
      await s.command(session, 'loadMianZhanEndTime');
      s.offset(4, 0);
      w4Success(await s.command(session, 'changeUserState', 0, 0));
      s.unordered(4, 1, 1);
      await s.query('update mem_user_buffer set endtime = 1 where uid = ? and buftype = 8', [uid]);
      await s.command(session, 'changeUserState', 1, 0); // expired row still blocks (existence check)
      s.mask(1); // negative MakeTimeLeft embeds the call's second
      await s.query('update sys_user set money = 299 where uid = ?', [uid]);
      await s.command(session, 'changeUserState', 3, 0);
      await s.query('update sys_user set money = 500 where uid = ?', [uid]);
      await s.query(
        'insert into mem_user_buffer (uid, buftype, endtime) values (?, 913, unix_timestamp() + 10000)',
        [uid],
      );
      w4Success(await s.command(session, 'changeUserState', 3, 0)); // clears both 8 and 913
      s.unordered(4, 1, 1);
      await w4Number(s, 'select money as value from sys_user where uid = ?', [uid], 200);
      await s.query(
        'insert into sys_allowpk (uid, allow) values (?, 0) on duplicate key update allow = 0',
        [uid],
      );
      w4Success(await s.command(session, 'allowPK'));
      w4Success(await s.command(session, 'allowPK'));
      await w4Number(s, 'select allow as value from sys_allowpk where uid = ?', [uid], 1);
    },
  },
  {
    name: 'W4 vacation: validation order, buffer 23 versus 913, begin and early recovery',
    tables: { sys_user_state: { offsets: ['vacstart', 'vacend'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await w4Idle(s, uid);
      await s.query('update sys_user set money = 0 where uid = ?', [uid]);
      await s.command(session, 'changeUserState', 2, 1);
      await s.command(session, 'changeUserState', 2, 100);
      await s.query('update sys_technic set state = 1 where uid = ?', [uid]);
      await s.query('update sys_building set state = 1 where cid = ?', [cid]);
      await s.command(session, 'changeUserState', 2, 2); // technic before building/money
      await s.query('update sys_technic set state = 0 where uid = ?', [uid]);
      await s.command(session, 'changeUserState', 2, 2);
      await s.query('update sys_building set state = 0 where cid = ?', [cid]);
      await s.command(session, 'changeUserState', 2, 2); // money
      await s.query('update sys_user set money = 500 where uid = ?', [uid]);
      await s.query(
        'insert into mem_user_buffer (uid, buftype, bufparam, endtime) values (?, 23, 7, 1)',
        [uid],
      );
      await s.command(session, 'changeUserState', 2, 2); // even an expired 23 blocks
      s.mask(1); // negative MakeTimeLeft embeds the call's second
      await s.query('delete from mem_user_buffer where uid = ? and buftype = 23', [uid]);
      await s.query('insert into mem_user_buffer (uid, buftype, endtime) values (?, 913, 1)', [
        uid,
      ]);
      w4Success(await s.command(session, 'changeUserState', 2, 2)); // 913 does not block vacation
      await w4Number(s, 'select money as value from sys_user where uid = ?', [uid], 470);
      await w4Number(s, 'select vacation as value from mem_city_resource where cid = ?', [cid], 1);
      await w4Number(s, 'select state as value from sys_user where uid = ?', [uid], 0); // PHP never sets state=6
      await w4Number(
        s,
        'select (endtime > unix_timestamp() + 172800) as value from mem_user_buffer where uid = ? and buftype = 913',
        [uid],
        1,
      );
      await s.query(
        'update sys_user_state set vacstart = unix_timestamp() - 3 * 86400, vacend = unix_timestamp() + 86400 where uid = ?',
        [uid],
      );
      w4Success(await s.command(session, 'changeUserState', 0, 0));
      await w4Number(s, 'select vacation as value from mem_city_resource where cid = ?', [cid], 0);
    },
  },
  {
    name: 'W4 lijian: coordinate, city, inventory, union gates and global loyalty update',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const other = await s.login('judingwan');
      const target = await lastCity(s, other.uid);
      const x = target % 1000;
      const y = Math.floor(target / 1000);
      await s.query('update sys_user set union_id = 0 where uid in (?, ?)', [uid, other.uid]);
      await s.query('delete from sys_goods where uid = ? and gid in (160035, 160036, 160037)', [
        uid,
      ]);
      await s.command(session, 'useLiJianFu', -1, y, 160035);
      await s.command(session, 'useLiJianFu', 500, 500, 160035);
      await s.command(session, 'useLiJianFu', x, y, 160035);
      await w4Goods(s, uid, 160035, 2);
      await s.command(session, 'useLiJianFu', x, y, 160035); // equal union 0 rejects
      await s.query('update sys_user set union_id = 990041 where uid = ?', [other.uid]);
      // Guarantee exactly one eligible target hero, plus an unrelated hero to catch missing-WHERE semantics.
      await s.query('delete from sys_city_hero where cid = ?', [target]);
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, loyalty) values (990041, ?, '离间目标', 0, 0, ?, 80), (990042, ?, '无关武将', 0, 0, 0, 60)`,
        [other.uid, target, uid],
      );
      s.rng([0]);
      for (const [gid, drop] of [
        [160035, 1],
        [160036, 3],
        [160037, 5],
      ] as const) {
        await w4Goods(s, uid, gid, 2);
        const [before] = await s.query<{ value: string }>(
          'select sum(loyalty) as value from sys_city_hero',
        );
        const [count] = await s.query<{ value: string }>(
          'select count(*) as value from sys_city_hero',
        );
        w4Success(await s.command(session, 'useLiJianFu', x, y, gid));
        await w4Number(
          s,
          'select sum(loyalty) as value from sys_city_hero',
          [],
          Number(before!.value) - Number(count!.value) * drop,
        );
      }
      await w4Number(s, 'select loyalty as value from sys_city_hero where hid = 990042', [], 51);
    },
  },
  {
    name: 'W4 war: declaration order, reverse duplicate and reports',
    tables: {
      mem_user_inwar: { offsets: ['endtime'] },
      sys_report: { offsets: ['time'], map: { content: w4ReportClock } },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const other = await s.login('judingwan');
      const target = await lastCity(s, other.uid);
      await s.query('delete from mem_user_inwar where uid in (?, ?) or targetuid in (?, ?)', [
        session.uid,
        other.uid,
        session.uid,
        other.uid,
      ]);
      await s.query('update sys_user set state = 1, union_id = 0 where uid in (?, ?)', [
        session.uid,
        other.uid,
      ]);
      await s.command(session, 'startWar', other.uid, target); // own protection first
      await s.query('update sys_user set state = 0 where uid = ?', [session.uid]);
      await s.command(session, 'startWar', other.uid, target);
      await s.query('update sys_user set state = 0 where uid = ?', [other.uid]);
      w4Success(await s.command(session, 'startWar', other.uid, target));
      s.unordered(4);
      await w4Number(
        s,
        'select count(*) as value from mem_user_inwar where uid = ? and targetuid = ? and state = 0',
        [session.uid, other.uid],
        1,
      );
      await s.query('update sys_user set state = 1 where uid = ?', [other.uid]);
      await s.command(other, 'startWar', session.uid, await lastCity(s, session.uid)); // duplicate before newbie
    },
  },
  {
    name: 'W4 taoni: goods before war, target city owner, refresh and no prestige deduction',
    tables: {
      mem_user_trickwar: { offsets: ['endtime'] },
      sys_report: { offsets: ['time'], map: { content: w4ReportClock } },
    },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const other = await s.login('judingwan');
      const uid = session.uid;
      const target = await lastCity(s, other.uid);
      await s.query('delete from mem_user_inwar where uid = ? or targetuid = ?', [uid, uid]);
      await s.query('delete from sys_goods where uid = ? and gid = 157', [uid]);
      await s.query('update sys_user set state = 1 where uid in (?, ?)', [uid, other.uid]);
      await s.command(session, 'useTaoNiShengZhi', other.uid, target);
      await w4Goods(s, uid, 157, 3);
      await s.command(session, 'useTaoNiShengZhi', other.uid, target);
      await s.query('update sys_user set state = 0, prestige = 10000 where uid = ?', [uid]);
      await s.command(session, 'useTaoNiShengZhi', other.uid, target);
      await s.query('update sys_user set state = 0, prestige = 100 where uid = ?', [other.uid]);
      // Supplied uid checks protection; actual war/report target is re-read from the city.
      w4Success(await s.command(session, 'useTaoNiShengZhi', uid, target));
      w4Success(await s.command(session, 'useTaoNiShengZhi', other.uid, target));
      await w4Number(s, 'select prestige as value from sys_user where uid = ?', [uid], 10000);
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 157',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count(*) as value from mem_user_trickwar where uid = ? and targetuid = ?',
        [uid, other.uid],
        1,
      );
      await s.query(
        'insert into mem_user_inwar (uid, targetuid, state, endtime) values (?, ?, 0, 1)',
        [other.uid, uid],
      );
      await s.command(session, 'useTaoNiShengZhi', other.uid, target); // reversed, expired war still blocks
    },
  },
  {
    name: 'W4 unionAssit: city, position, union, buffers, war, money and extension',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const other = await s.login('judingwan');
      const uid = session.uid;
      const target = await lastCity(s, other.uid);
      await w4Idle(s, other.uid);
      await s.query(
        'update sys_user set union_id = 990041, union_pos = 0, money = 0 where uid = ?',
        [uid],
      );
      await s.query('update sys_user set union_id = 990042 where uid = ?', [other.uid]);
      await s.command(session, 'unionAssit', 999999);
      await s.command(session, 'unionAssit', target);
      await s.query('update sys_user set union_pos = 4 where uid = ?', [uid]);
      await s.command(session, 'unionAssit', target);
      await s.query('update sys_user set union_id = 990041 where uid = ?', [other.uid]);
      await s.query(
        'insert into mem_user_buffer (uid, buftype, endtime) values (?, 8, unix_timestamp() + 3600)',
        [other.uid],
      );
      await s.command(session, 'unionAssit', target);
      await s.query('delete from mem_user_buffer where uid = ? and buftype = 8', [other.uid]);
      await s.query('update sys_city set type = 0 where cid = ?', [target]);
      await s.query('update mem_world set state = 1 where wid = ?', [cid2wid(target)]);
      await s.command(session, 'unionAssit', target);
      await s.query('update mem_world set state = 0 where wid = ?', [cid2wid(target)]);
      await s.command(session, 'unionAssit', target);
      await s.query('update sys_user set money = 500 where uid = ?', [uid]);
      w4Success(await s.command(session, 'unionAssit', target));
      await s.query('update sys_user set union_pos = 5 where uid = ?', [uid]);
      w4Success(await s.command(session, 'unionAssit', target));
      await w4Number(s, 'select money as value from sys_user where uid = ?', [uid], 100);
      await w4Number(s, 'select state as value from sys_user where uid = ?', [other.uid], 2);
      await w4Number(
        s,
        'select (endtime between unix_timestamp() + 14380 and unix_timestamp() + 14400) as value from mem_user_buffer where uid = ? and buftype = 7',
        [other.uid],
        1,
      );
    },
  },

  {
    name: 'W5 rumor: goods before portrait, retained portrait, null gid and quality boundaries',
    run: async (s) => {
      s.rng([0]); // Pin the daily login box as well as subsequent PHP RNG calls.
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query(
        'delete from sys_goods where uid = ? and gid in (149, 100123, 110123, 120123, 130123, 140123, 150123)',
        [uid],
      );
      await s.query('delete from sys_things where uid = ? and tid = 20123', [uid]);
      w5Error(await s.command(session, 'genWuHunByRumor', 20123));
      await w4Goods(s, uid, 149, 12);
      w5Error(await s.command(session, 'genWuHunByRumor', 20123));
      await s.query('insert into sys_things (uid, tid, count) values (?, 20123, 1)', [uid]);
      for (const draw of [0, 89]) {
        s.rng([draw]); // inclusive <=90 fragment branch
        const ret = await s.command(session, 'genWuHunByRumor', 20123);
        w4Success(ret);
        if ((ret as unknown[][])[4]?.[0] !== null)
          throw new Error('PHP rumor reply must retain undefined gid as null');
      }
      for (const [draw, gid] of [
        [0, 110123],
        [60, 120123],
        [90, 130123],
        [97, 140123],
        [99, 150123],
      ] as const) {
        s.rng([90, draw]);
        w4Success(await s.command(session, 'genWuHunByRumor', 20123));
        await w4Number(
          s,
          'select count as value from sys_goods where uid = ? and gid = ?',
          [uid, gid],
          1,
        );
      }
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 100123',
        [uid],
        2,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 149',
        [uid],
        5,
      );
      await w4Number(
        s,
        'select count as value from sys_things where uid = ? and tid = 20123',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count(*) as value from log_things where uid = ? and tid = 20123 and count < 0',
        [uid],
        0,
      );
    },
  },
  {
    name: 'W5 fragments: banner gate, PHP truthiness, failed consumption and guaranteed RNG draw',
    run: async (s) => {
      s.seed(5002);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query(
        'delete from sys_goods where uid = ? and gid in (148, 100123, 110123, 120123, 130123, 140123, 150123)',
        [uid],
      );
      w5Error(await s.command(session, 'genWuHunBySuipian', 100123, 1)); // banner before fragments
      await w4Goods(s, uid, 148, 2);
      w5Error(await s.command(session, 'genWuHunBySuipian', 100123, 1));
      await w4Goods(s, uid, 100123, 21);
      s.rng([70]); // 71 fails, still consumes ten
      w4Success(await s.command(session, 'genWuHunBySuipian', 100123, '0'));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 100123',
        [uid],
        11,
      );
      s.rng([69, 59]); // 70 succeeds, quality 60 inclusive
      w4Success(await s.command(session, 'genWuHunBySuipian', 100123, 0));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 110123',
        [uid],
        1,
      );
      s.rng([99, 60]); // guaranteed success still draws 100, then quality 61
      w4Success(await s.command(session, 'genWuHunBySuipian', 100123, '1'));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 120123',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 100123',
        [uid],
        0,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 148',
        [uid],
        1,
      );
      w5Error(await s.command(session, 'genWuHunBySuipian', 100123, 0));
    },
  },
  {
    name: 'W5 cards: closed gates and mix strict threshold, materials consumed on failure',
    run: async (s) => {
      s.seed(5003);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('update mem_state set value = 0 where state = 197');
      for (const args of [[], [210123], [240123, 240124]])
        w5Error(await s.command(session, 'mixCard', ...args));
      w5Error(await s.command(session, 'multiUseCard'));
      for (const gid of [250, 240123, 251]) {
        await w4Goods(s, uid, gid, 1);
        w5Error(await s.command(session, 'useGoods', gid));
        await w4Number(
          s,
          'select count as value from sys_goods where uid = ? and gid = ?',
          [uid, gid],
          1,
        );
      }
      await s.query('update mem_state set value = 60 where state = 197');
      w5Error(await s.command(session, 'mixCard', 240123));
      w5Error(await s.command(session, 'mixCard', 210123, 240124));
      await s.query('delete from sys_goods where uid = ? and gid in (240124, 230123)', [uid]);
      w5Error(await s.command(session, 'mixCard', 240123, 240124));
      await w4Goods(s, uid, 240124, 2);
      s.rng([3]); // roll 4 is NOT <4: original retained, material lost
      w4Success(await s.command(session, 'mixCard', 240123, 240124));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240123',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240124',
        [uid],
        1,
      );
      s.rng([2]); // roll 3 upgrades the named original
      w4Success(await s.command(session, 'mixCard', 240123, 240124));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240123',
        [uid],
        0,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 230123',
        [uid],
        1,
      );
      // PHP does not roll back earlier materials when a later material or the original is absent.
      await w4Goods(s, uid, 240124, 1);
      await s.query('delete from sys_goods where uid = ? and gid = 240125', [uid]);
      s.rng([0]);
      w5Error(await s.command(session, 'mixCard', 240123, 240124, 240125));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240124',
        [uid],
        0,
      );
      await w4Goods(s, uid, 240124, 1);
      s.rng([0]);
      w5Error(await s.command(session, 'mixCard', 240123, 240124));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240124',
        [uid],
        0,
      );
    },
  },
  {
    name: 'W5 cards: unique scheduled hero, batch quality order, 100 cap and single use',
    run: async (s) => {
      s.seed(5004);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('update mem_state set value = 55555555 where state = 197');
      await s.query('update mem_state set value = 1 where state = 250');
      await s.query('update cfg_hero_card_schedule set part = 0');
      await s.query(
        "insert into cfg_hero_card_schedule (hid, name, part) values (123, '验收卡将', 1) on duplicate key update part = 1",
      );
      await s.query(
        'delete from sys_goods where uid = ? and gid in (250, 210123, 220123, 230123, 240123)',
        [uid],
      );
      w4Success(await s.command(session, 'multiUseCard')); // zero is a successful empty summary
      await w4Goods(s, uid, 250, 7);
      s.rng([887, 888, 988, 989, 998, 999, 1004]);
      w4Success(await s.command(session, 'multiUseCard'));
      for (const [gid, count] of [
        [240123, 1],
        [230123, 2],
        [220123, 2],
        [210123, 2],
      ]) {
        await w4Number(
          s,
          'select count as value from sys_goods where uid = ? and gid = ?',
          [uid, gid],
          count!,
        );
      }
      await w4Goods(s, uid, 250, 101);
      s.rng([0]);
      w4Success(await s.command(session, 'multiUseCard'));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 250',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240123',
        [uid],
        101,
      );
      w4Success(await s.command(session, 'useGoods', 250));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240123',
        [uid],
        102,
      );
      w5Error(await s.command(session, 'useGoods', 250));
    },
  },
  {
    name: 'W5 question: singleton draw, unchecked replay reward, literal text and answer box',
    run: async (s) => {
      s.seed(5005);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query('delete from sys_goods where uid = ? and gid in (147, 150)', [uid]);
      // No prior question, answer or item ownership is required by PHP; replay also grants rewards.
      for (const message of ["验收'a\\b", ''])
        w4Success(await s.command(session, 'afterUseShenMiChuanYinFu', message));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 150',
        [uid],
        2,
      );
      await w4Number(s, 'select count(*) as value from sys_inform where msg = ?', ["验收'a\\b"], 1);
      w5Error(await s.command(session, 'useGoods', 147));
      await s.query('delete from sys_question');
      await s.query(
        "insert into sys_question (id, question, option1, option2, option3, option4, answer, info) values (990051, '验收问题', '甲', '乙', '丙', '丁', 2, '验收说明')",
      );
      await w4Goods(s, uid, 147, 1);
      w5Error(await s.command(session, 'useGoods', 147, 2));
      w4Success(await s.command(session, 'useGoods', 147));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 147',
        [uid],
        0,
      );
      // SQL ORDER BY RAND cannot be scripted: one positive woodbox candidate fixes the answer box.
      await s.query('update cfg_goods set woodbox = 0');
      await s.query('update cfg_goods set inuse = 1, value = 1, woodbox = 1 where gid = 85');
      await s.query('update cfg_act set endtime = 1 where type = 15');
      const [before] = await s.query<{ value: string }>(
        'select coalesce(sum(count), 0) as value from sys_goods where uid = ? and gid = 85',
        [uid],
      );
      w4Success(await s.command(session, 'useGoods', 150));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 85',
        [uid],
        Number(before!.value) + 1,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 150',
        [uid],
        1,
      );
    },
  },
  {
    name: 'W5 hero box sort7: consumed on full office, one hero, loyalty override and blood',
    run: async (s) => {
      s.seed(5006);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from cfg_box_open_condition where boxid = 990051 or keyid = 990051');
      await s.query('delete from cfg_box_details where srctype = 0 and srcid = 990051');
      await s.query(
        `insert into cfg_box_details (id, srctype, srcid, sort, type, count, rate, inform, dayopencount, totalopencount, owncount) values (990051, 0, 990051, 7, 990051, 99, 1, 1, 1, 1, 1)`,
      );
      await s.query(
        `insert into cfg_recruit_hero (id, heroname, herotype, min_face, max_face, min_affairs_base, max_affairs_base, min_bravery_base, max_bravery_base, min_wisdom_base, max_wisdom_base, min_loyalty, max_loyalty, sex, level, min_level, max_level) values (990051, '验收箱将', 301, 1, 1, 30, 30, 60, 60, 30, 30, 5, 5, 0, 10, 10, 10)`,
      );
      await w4Goods(s, uid, 990051, 3);
      await s.query('delete from sys_city_hero where uid = ? and cid = ?', [uid, cid]);
      await s.query('update sys_building set level = 0 where cid = ? and bid = 11', [cid]);
      w5Error(await s.command(session, 'useGoods', 990051));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 990051',
        [uid],
        2,
      );
      await s.query('update sys_building set level = 10 where cid = ? and bid = 11', [cid]);
      s.rng([0, 0, 0, 0, 0, 0, 8]);
      for (let i = 0; i < 2; i++) w5Error(await s.command(session, 'useGoods', 990051)); // committed success message is an error envelope
      await w4Number(
        s,
        'select count(*) as value from sys_city_hero where uid = ? and cid = ? and name = ? and loyalty = 70 and level = 10 and face = 9',
        [uid, cid, '验收箱将'],
        2,
      );
      await w4Number(
        s,
        'select count(*) as value from mem_hero_blood b join sys_city_hero h on h.hid = b.hid where h.uid = ? and h.name = ? and b.`force` = 100 and b.energy = 100 and b.force_max = 123 and b.energy_max = 113',
        [uid, '验收箱将'],
        2,
      );
      await w4Number(
        s,
        'select count(*) as value from log_act where uid = ? and actid = 990051',
        [uid],
        0,
      ); // sort7 ignores count/limit/inform bookkeeping
    },
  },
  {
    name: 'W5 reduceGoods: wuhun all-reason threshold, idempotent achievement and gid158 type filter',
    tables: { sys_user_achivement: { offsets: ['time'] } },
    run: async (s) => {
      s.seed(5007);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('update sys_user set nobility = 1, state = 0 where uid = ?', [uid]);
      await s.query('update sys_building set level = 5 where cid = ? and bid = 13', [cid]);
      await s.query(
        'update cfg_achivement set state = 1, open_time = 0, system_inform = 0, union_inform = 0 where id in (30, 70016)',
      );
      await s.query(
        'delete from sys_user_achivement where uid = ? and achivement_id in (30, 70016)',
        [uid],
      );
      await s.query(
        'delete from log_goods where uid = ? and (gid between 110001 and 159999 or gid = 158)',
        [uid],
      );
      await s.query(
        'insert into log_goods (uid, gid, count, time, type) values (?, 110123, -28, 1, 9), (?, 110123, 500, 1, 0), (?, 110000, -500, 1, 0), (?, 160000, -500, 1, 0)',
        [uid, uid, uid, uid],
      );
      await w4Goods(s, uid, 110123, 3);
      w4Success(await s.command(session, 'sellGoods', cid, 110123, 1));
      await w4Number(
        s,
        'select count(*) as value from sys_user_achivement where uid = ? and achivement_id = 30',
        [uid],
        0,
      );
      w4Success(await s.command(session, 'sellGoods', cid, 110123, 1));
      w4Success(await s.command(session, 'sellGoods', cid, 110123, 1));
      await w4Number(
        s,
        'select count(*) as value from sys_user_achivement where uid = ? and achivement_id = 30',
        [uid],
        1,
      );
      await s.query(
        'insert into log_goods (uid, gid, count, time, type) values (?, 158, -14, 1, 0), (?, 158, -100, 1, 9)',
        [uid, uid],
      );
      await w4Goods(s, uid, 158, 3);
      w4Success(await s.command(session, 'sellGoods', cid, 158, 1)); // type9 must NOT count toward 15
      await w4Number(
        s,
        'select count(*) as value from sys_user_achivement where uid = ? and achivement_id = 70016',
        [uid],
        0,
      );
      // The real type0 use path is disabled remote transport, so seed the historical 15th use.
      await s.query(
        'insert into log_goods (uid, gid, count, time, type) values (?, 158, -1, 1, 0)',
        [uid],
      );
      w4Success(await s.command(session, 'sellGoods', cid, 158, 1));
      await w4Number(
        s,
        'select count(*) as value from sys_user_achivement where uid = ? and achivement_id = 70016',
        [uid],
        1,
      );
      w5Error(await s.command(session, 'useGoods', 158)); // PHP remote call throws before consumption
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 158',
        [uid],
        1,
      );
    },
  },

  {
    name: 'W5 useGoods wuhun: missing item, busy hero, replacement and busy extension',
    tables: { mem_hero_buffer: { offsets: ['endtime'] } },
    run: async (s) => {
      s.seed(5008);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('delete from sys_goods where uid = ? and gid = 110123', [uid]);
      w5Error(await s.command(session, 'useGoods', 110123, 1, 990058));
      await s.query(
        `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base, affairs_base, bravery_base, wisdom_base, loyalty) values (990058, ?, '武魂验收', 0, 1, ?, 1, 1, 10, 10, 10, 10, 100)`,
        [uid, cid],
      );
      await s.query(
        'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (990058, 100, 100, 100, 100)',
      );
      // Ensure get command_base by npcid has exactly one row (PHP rejects multiple results).
      await s.query('update sys_city_hero set npcid = 0 where npcid = 123');
      await s.query(
        "insert into sys_city_hero (hid, uid, name, sex, face, cid, npcid, command_base) values (990059, 0, '武魂模板', 0, 1, 0, 123, 100)",
      );
      await w4Goods(s, uid, 110123, 3);
      w5Error(await s.command(session, 'useGoods', 110123, 2, 990058)); // generic multi-use guard first
      w5Error(await s.command(session, 'useGoods', 110123, 1, 990058)); // busy, no matching buffer
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 110123',
        [uid],
        3,
      );
      await s.query('update sys_city_hero set state = 0 where hid = 990058');
      await s.query(
        'insert into mem_hero_buffer (hid, buftype, endtime) values (990058, 120098, 1)',
      );
      w4Success(await s.command(session, 'useGoods', 110123, 1, 990058));
      await w4Number(
        s,
        'select command_base as value from sys_city_hero where hid = 990058',
        [],
        60,
      );
      await w4Number(
        s,
        'select count(*) as value from mem_hero_buffer where hid = 990058 and buftype = 120098',
        [],
        0,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_city_hero_base_add where hid = 990058 and type = 2',
        [],
        1,
      );
      await s.query('update sys_city_hero set state = 1 where hid = 990058');
      await s.query(
        'update mem_hero_buffer set endtime = 1 where hid = 990058 and buftype = 110098',
      );
      w4Success(await s.command(session, 'useGoods', 110123, 1, 990058)); // existing expired buffer bypasses busy check
      await w4Number(
        s,
        'select endtime as value from mem_hero_buffer where hid = 990058 and buftype = 110098',
        [],
        86401,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_city_hero_base_add where hid = 990058 and type = 2',
        [],
        1,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 110123',
        [uid],
        1,
      );
    },
  },
  {
    name: 'W5 useGoods card hero: office gate, five-card cap and deterministic summon',
    run: async (s) => {
      s.seed(5009);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('update mem_state set value = 60 where state = 197');
      await s.query(
        'delete from sys_city_hero where uid = ? and (cid = ? or herotype between 21250 and 24250)',
        [uid, cid],
      );
      await s.query('update sys_city_hero set npcid = 0 where npcid = 123');
      await s.query(
        "insert into sys_city_hero (hid, uid, name, sex, face, cid, npcid, command_base) values (990060, 0, '卡牌模板', 0, 1, 0, 123, 100)",
      );
      await w4Goods(s, uid, 240123, 2);
      await s.query('update sys_building set level = 0 where cid = ? and bid = 11', [cid]);
      w5Error(await s.command(session, 'useGoods', 240123));
      await s.query('update sys_building set level = 10 where cid = ? and bid = 11', [cid]);
      for (let i = 0; i < 5; i++)
        await s.query(
          "insert into sys_city_hero (hid, uid, name, sex, face, cid, herotype) values (?, ?, '已有卡将', 0, 1, 0, 24250)",
          [990061 + i, uid],
        );
      w5Error(await s.command(session, 'useGoods', 240123));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240123',
        [uid],
        2,
      );
      await s.query('delete from sys_city_hero where hid between 990061 and 990065');
      s.rng([0]);
      w4Success(await s.command(session, 'useGoods', 240123));
      await w4Number(
        s,
        'select count(*) as value from sys_city_hero where uid = ? and cid = ? and herotype = 24250 and loyalty = 100 and command_base = 5',
        [uid, cid],
        1,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_city_hero h join mem_hero_blood b on b.hid = h.hid where h.uid = ? and h.cid = ? and h.herotype = 24250 and b.`force` = b.force_max and b.energy = b.energy_max',
        [uid, cid],
        1,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 240123',
        [uid],
        1,
      );
    },
  },

  {
    name: 'W6 praise: catalog, dummy argument, hero and king gates, buff extension',
    tables: { mem_hero_buffer: { offsets: ['endtime'] } },
    run: async (s) => {
      s.rng([0]);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await w6Hero(s, uid, cid);
      w4Success(await s.command(session, 'loadHeroGoods'));
      s.unordered(4); // cfg query has no ORDER BY; compare every catalog row.
      await s.command(session, 'praiseHero', 'ignored', cid, 990099, 999); // unsupported gid falls through null
      w5Error(await s.command(session, 'praiseHero', 'ignored', cid, 990099, 26));
      await s.query('update sys_city_hero set state = 2, herotype = 1000 where hid = 990071');
      w5Error(await s.command(session, 'praiseHero', 'ignored', cid, 990071, 26)); // old branch king before busy
      w5Error(await s.command(session, 'praiseHero', 'ignored', cid, 990071, 160040)); // new branch busy before king
      await s.query('update sys_city_hero set state = 0, herotype = 0 where hid = 990071');
      await s.query('delete from sys_goods where uid = ? and gid = 26', [uid]);
      w5Error(await s.command(session, 'praiseHero', 'ignored', cid, 990071, 26));
      await w4Goods(s, uid, 160040, 1);
      w4Success(await s.command(session, 'praiseHero', 'ignored', cid, 990071, 160040));
      s.offset(4, '*', 'buf160040');
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 160040',
        [uid],
        0,
      );
      await w4Number(
        s,
        'select (endtime between unix_timestamp() + 3580 and unix_timestamp() + 3600) as value from mem_hero_buffer where hid = 990071 and buftype = 160040',
        [],
        1,
      );
      await w4Goods(s, uid, 26, 2);
      for (let i = 0; i < 2; i++) {
        w4Success(await s.command(session, 'praiseHero', 'ignored', cid, 990071, 26));
        s.offset(4, '*', 'buf1');
      }
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 26',
        [uid],
        0,
      );
      await w4Number(
        s,
        'select count(*) as value from mem_hero_buffer where hid = 990071 and buftype = 160040',
        [],
        0,
      ); // old hufu replaces chibi
      await w4Number(
        s,
        'select (endtime between unix_timestamp() + 172780 and unix_timestamp() + 172800) as value from mem_hero_buffer where hid = 990071 and buftype = 1',
        [],
        1,
      );
      s.stopRng();
    },
  },
  {
    name: 'W6 largess: inventory before conflicts, king buffs, grade replacement and pills',
    tables: { mem_hero_buffer: { offsets: ['endtime'] }, log_act: { offsets: ['time'] } },
    run: async (s) => {
      s.rng([0]);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await w6Hero(s, uid, cid);
      await s.query('update sys_city_hero set herotype = 1000 where hid = 990071');
      await s.query('delete from sys_goods where uid = ? and gid = 160040', [uid]);
      await s.query('insert into mem_hero_buffer (hid, buftype, endtime) values (990071, 1, 1)');
      w5Error(await s.command(session, 'largessHeroWithGid', '', cid, 990071, 160040)); // missing item before conflict
      await w4Goods(s, uid, 160040, 2);
      w5Error(await s.command(session, 'largessHeroWithGid', '', cid, 990071, 160040)); // even expired base buff conflicts
      await s.query('delete from mem_hero_buffer where hid = 990071');
      await s.query(
        'insert into mem_hero_buffer (hid, buftype, endtime) values (990071, 160040, 1)',
      );
      await w4Goods(s, uid, 160042, 1); // higher-grade treasure must be in stock before the swap
      w4Success(await s.command(session, 'largessHeroWithGid', '', cid, 990071, 160042)); // higher grade replaces lower
      s.offset(4, '*', 'buf160042');
      await w4Number(
        s,
        'select count(*) as value from mem_hero_buffer where hid = 990071 and buftype = 160040',
        [],
        0,
      );
      // Higher-grade treasure remains active; a lower-grade replacement is rejected.
      w5Error(await s.command(session, 'largessHeroWithGid', '', cid, 990071, 160040));
      await w4Number(
        s,
        'select count(*) as value from mem_hero_buffer where hid = 990071 and buftype = 160042',
        [],
        1,
      );
      await w4Goods(s, uid, 10152, 2);
      w5Error(await s.command(session, 'largessHeroWithGid', '', cid, 990071, 10152)); // pills forbid king
      await s.query('update sys_city_hero set herotype = 0 where hid = 990071');
      w4Success(await s.command(session, 'largessHeroWithGid', '', cid, 990071, 10152));
      // The pill branch writes no buffer: the still-active 160042 from the swap above is the
      // only future endtime in this heroInfo reply, so it is the one that needs the offset.
      s.offset(4, '*', 'buf160042');
      await w4Number(
        s,
        'select command_base as value from sys_city_hero where hid = 990071',
        [],
        11,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 10152',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_city_hero_base_add where hid = 990071 and type = 4 and command_base_add_on = 1',
        [],
        1,
      );
      s.stopRng();
    },
  },
  {
    name: 'W6 king study: book order, guarantee, failure counter, fractional count and designations',
    tables: { sys_user_level: { offsets: ['time'] }, log_user_level_add: { offsets: ['time'] } },
    run: async (s) => {
      s.rng([0]);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await w6Hero(s, uid, cid);
      await s.query('update sys_city_hero set herotype = 0 where uid = ? and herotype = 1000', [
        uid,
      ]);
      await s.query('update sys_city_hero set herotype = 1000, level = 100 where hid = 990071');
      await s.query('delete from sys_user_level where uid = ?', [uid]);
      await s.query('delete from sys_goods where uid = ? and gid = 10961', [uid]);
      w4Success(await s.command(session, 'loadKingTactic'));
      w5Error(await s.command(session, 'addUserLevelTimes', 0));
      w5Error(await s.command(session, 'addUserLevelTimes', 1));
      await w4Goods(s, uid, 10961, 20);
      s.rng([9999]); // level1 guaranteed even at roll 10000
      w4Success(await s.command(session, 'addUserLevelTimes', 1));
      await w4Number(s, 'select level as value from sys_user_level where uid = ?', [uid], 1);
      await w4Number(
        s,
        'select command_base as value from sys_city_hero where hid = 990071',
        [],
        20,
      );
      w4Success(await s.command(session, 'addUserLevelTimes', 1)); // level2 fails, counter increments
      await w4Number(s, 'select count as value from sys_user_level where uid = ?', [uid], 1);
      await s.query('update sys_user_level set count = 4 where uid = ?', [uid]);
      w4Success(await s.command(session, 'addUserLevelTimes', 1));
      await w4Number(s, 'select level as value from sys_user_level where uid = ?', [uid], 2);
      s.rng([0]);
      w4Success(await s.command(session, 'addUserLevelTimes', 1.5)); // PHP loop runs twice
      await w4Number(s, 'select level as value from sys_user_level where uid = ?', [uid], 4);
      await s.query('update sys_city_hero set level = 1 where hid = 990071');
      w4Success(await s.command(session, 'addUserLevelTimes', 1)); // returns level-limit message without consuming
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 10961',
        [uid],
        15,
      );
      await s.query('update sys_city_hero set level = 100 where hid = 990071');
      await s.query('delete from sys_user_designation where uid = ? and did in (20,21,22,23)', [
        uid,
      ]);
      w4Success(await s.command(session, 'addUserLevelTimes', 7)); // reaches 10 then stops
      await w4Number(s, 'select level as value from sys_user_level where uid = ?', [uid], 10);
      await w4Number(
        s,
        'select count(*) as value from sys_user_designation where uid = ? and did in (20,21,22,23)',
        [uid],
        4,
      );
      await w4Number(
        s,
        'select speed_add_on as value from sys_city_hero where hid = 990071',
        [],
        10,
      );
      await w4Goods(s, uid, 10961, 0);
      w5Error(await s.command(session, 'addUserLevelTimes', 1)); // inventory before max level
      await w4Goods(s, uid, 10961, 1);
      w5Error(await s.command(session, 'addUserLevelTimes', 1));
      s.stopRng();
    },
  },
  {
    name: 'W6 expr reward: timeout, ownership, money and details order, goods claim and replay',
    tables: {
      sys_hero_expr_reward: { offsets: ['endtime'] },
      log_hero_expr_reward: { offsets: ['endtime', 'time'] },
    },
    run: async (s) => {
      s.rng([0]);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await s.query('update sys_user set money = 100 where uid = ?', [uid]);
      w5Error(await s.command(session, 'finishCommonExpr', 990071));
      await w6Reward(s, uid + 1, cid, 990071, 1, 200, '30,31,');
      w5Error(await s.command(session, 'finishCommonExpr', 990071));
      await s.query('update sys_hero_expr_reward set uid = ?, endtime = 1 where id = 990071', [
        uid,
      ]);
      w5Error(await s.command(session, 'finishCommonExpr', 990071));
      await s.query(
        "update sys_hero_expr_reward set endtime = unix_timestamp() + 3600, details = '' where id = 990071",
      );
      w5Error(await s.command(session, 'finishCommonExpr', 990071)); // money before empty details
      await s.query('update sys_hero_expr_reward set money = -1 where id = 990071');
      w5Error(await s.command(session, 'finishCommonExpr', 990071));
      await s.query('update sys_hero_expr_reward set money = 2 where id = 990071');
      w5Error(await s.command(session, 'finishCommonExpr', 990071));
      await s.query("update sys_hero_expr_reward set details = '30,31,,0,' where id = 990071");
      await w4Goods(s, uid, 30, 0);
      await w4Goods(s, uid, 31, 0);
      w5Error(await s.command(session, 'finishCommonExpr', 990071)); // success commits then throws
      for (const gid of [30, 31])
        await w4Number(
          s,
          'select count as value from sys_goods where uid = ? and gid = ?',
          [uid, gid],
          1,
        );
      await w4Number(s, 'select money as value from sys_user where uid = ?', [uid], 98);
      await w4Number(
        s,
        'select count(*) as value from sys_hero_expr_reward where id = 990071',
        [],
        0,
      );
      await w4Number(
        s,
        'select count(*) as value from log_hero_expr_reward where uid = ? and type = 990071',
        [uid],
        1,
      );
      w5Error(await s.command(session, 'finishCommonExpr', 990071));
      await w4Number(s, 'select money as value from sys_user where uid = ?', [uid], 98);
      s.stopRng();
    },
  },
  {
    name: 'W6 expr reward: attributes, pearl conversion, missing armor friend and draft errors',
    tables: {
      sys_hero_expr_reward: { offsets: ['endtime'] },
      log_hero_expr_reward: { offsets: ['endtime', 'time'] },
    },
    run: async (s) => {
      s.rng([0]);
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      const cid = await lastCity(s, uid);
      await w6Hero(s, uid, cid);
      await s.query('update sys_user set money = 100 where uid = ?', [uid]);
      await w6Reward(s, uid, cid, 990072, 4, 1, '7,1,2,1,3,2,4,3,5,4,6,5,7,6,8');
      w5Error(await s.command(session, 'finishCommonExpr', 990072));
      for (const [column, value] of [
        ['bravery_base', 15],
        ['wisdom_base', 14],
        ['affairs_base', 15],
        ['command_base', 16],
        ['attack_add_on', 7],
        ['defence_add_on', 8],
      ] as const)
        await w4Number(
          s,
          `select ${column} as value from sys_city_hero where hid = 990071`,
          [],
          value,
        );
      await w6Reward(s, uid, cid, 990073, 5, 1, '30,31');
      await w4Goods(s, uid, 30, 0);
      await w4Goods(s, uid, 31, 0);
      w5Error(await s.command(session, 'finishCommonExpr', 990073));
      await w4Goods(s, uid, 30, 1);
      w5Error(await s.command(session, 'finishCommonExpr', 990073));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 30',
        [uid],
        0,
      );
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 31',
        [uid],
        1,
      );
      for (const [id, sort, detail] of [
        [990074, 6, '990099'],
        [990075, 7, '1'],
        [990076, 8, '50'],
      ] as const) {
        await w6Reward(s, uid, cid, id, sort, 1, detail);
        if (sort === 7)
          await s.query('delete from sys_lionize where uid = ? and npcid = 990071', [uid]);
        if (sort === 8) await s.query('delete from sys_city_draftqueue where cid = ?', [cid]);
        w5Error(await s.command(session, 'finishCommonExpr', id));
        await w4Number(
          s,
          'select count(*) as value from sys_hero_expr_reward where id = ?',
          [id],
          1,
        );
      }
      await w4Number(s, 'select money as value from sys_user where uid = ?', [uid], 98);
      s.stopRng();
    },
  },
  {
    name: 'W7 persuade: failed attempt consumes goods and cooldown; success transfers hero',
    run: async (s) => {
      s.rng([9999]);
      const session = await s.login(EXISTING_PLAYER);
      const { uid } = session;
      const cid = await lastCity(s, uid);
      // sys_city_hero.npcid is a smallint on both engines: an id above 32767 silently clamps
      // (to 32767) and the persuade's npcid lookup finds nothing. 32701 is outside the
      // baseline famous-hero range (1..1026) and unused.
      const hid = 32701;
      await s.query('delete from sys_city_hero where hid = ?', [hid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, npcid, name, sex, face, cid, state, level,
          bravery_base, wisdom_base, loyalty, herotype)
         values (?, 900001, ?, 'W7游说将', 1, 1, 188128, 0, 20, 60, 60, 60, 100)`,
        [hid, hid],
      );
      await s.query('delete from sys_lionize where uid = ? and npcid = ?', [uid, hid]);
      await s.query('insert into sys_lionize (uid, npcid, friend, state) values (?, ?, 100, 1)', [
        uid,
        hid,
      ]);
      await s.query('delete from sys_goods where uid = ? and gid = 13', [uid]);
      await w4Goods(s, uid, 13, 30);
      await s.query('delete from mem_user_schedule where uid = ?', [uid]);
      await s.query('update mem_state set value = 0 where state = 6');
      const hotel = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 10, 42, func, ...args);

      // A lost persuade roll is a success envelope carrying the failure text, not a thrown
      // error; PHP consumes the 15 tokens and starts the cooldown before rolling.
      w4Success(await hotel('PersuadeHero', hid));
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 13',
        [uid],
        15,
      );
      await w4Number(
        s,
        'select (last_persuade between unix_timestamp() - 10 and unix_timestamp()) as value from mem_user_schedule where uid = ?',
        [uid],
        1,
      );
      w5Error(await hotel('PersuadeHero', hid)); // the daily cooldown throws time_err
      await w4Number(
        s,
        'select count as value from sys_goods where uid = ? and gid = 13',
        [uid],
        15,
      );
      await s.query('update sys_city_hero set loyalty = 1 where hid = ?', [hid]);
      await s.query('update mem_user_schedule set last_persuade = 1 where uid = ?', [uid]);
      s.rng([0]);
      w4Success(await hotel('PersuadeHero', hid));
      await w4Number(s, 'select uid as value from sys_city_hero where hid = ?', [hid], uid);
      await w4Number(s, 'select cid as value from sys_city_hero where hid = ?', [hid], cid);
      await w4Number(
        s,
        'select state as value from sys_lionize where uid = ? and npcid = ?',
        [uid, hid],
        2,
      );
      s.stopRng();
    },
  },
  {
    name: 'W7 famous hero tasks: selector, acceptance, rumor target and recorded task pair',
    tables: { sys_hero_task: { offsets: ['endtime'] } },
    run: async (s) => {
      // A varied draw stream (not a fixed value): createTaskList re-draws while the tid is
      // already taken, so a constant sequence pins every draw to 401 and both engines' task
      // loops never terminate (the run then climbs into an OOM).
      s.seed(7);
      const session = await s.login(EXISTING_PLAYER);
      const { uid } = session;
      const cid = await lastCity(s, uid);
      const hid = 32702; // smallint-safe npcid, same constraint as the W7 persuade fixture
      const group = hid * 10 + 20001;
      await s.query('delete from sys_hero_task where uid = ? and `group` = ?', [uid, group]);
      await s.query('delete from sys_lionize where uid = ? and npcid = ?', [uid, hid]);
      // state 2 (already own) makes the first getHeroPublicTask throw state_err without
      // creating the six level-0 tasks; the update below restores state 1 for the real list.
      await s.query('insert into sys_lionize (uid, npcid, friend, state) values (?, ?, 100, 2)', [
        uid,
        hid,
      ]);
      await s.query('delete from sys_city_hero where hid = ?', [hid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, npcid, name, sex, face, cid, state, level, loyalty)
         values (?, 900001, ?, 'W7任务将', 1, 1, ?, 0, 20, 100)`,
        [hid, hid, cid],
      );
      await s.query('delete from sys_city_rumor where cid = ? and id = ?', [cid, hid]);
      await s.query(
        `insert into sys_city_rumor (id, cid, name, type, typeid, price)
         values (?, ?, 'W7任务将', 0, ?, 30)`,
        [hid, cid, hid],
      );
      const hotel = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 10, 42, func, ...args);
      w5Error(await hotel('getHeroPublicTask', hid, 0));
      await s.query('update sys_lionize set state = 1, friend = 100 where uid = ? and npcid = ?', [
        uid,
        hid,
      ]);
      await hotel('getHeroPublicTask', hid, 60);
      await w4Number(
        s,
        'select count(*) as value from sys_hero_task where uid = ? and `group` = ?',
        [uid, group],
        3,
      );
      const available = await s.query<{ tid: string }>(
        'select tid from sys_hero_task where uid = ? and `group` = ? order by tid limit 1',
        [uid, group],
      );
      const tid = Number(available[0]?.tid ?? 0);
      if (!tid) throw new Error('W7 expected generated famous-hero tasks');
      await hotel('getTheTask', tid, group);
      await w4Number(
        s,
        'select state as value from sys_hero_task where uid = ? and `group` = ? and tid = ?',
        [uid, group, tid],
        1,
      );
      await hotel('getRumor', hid);
      await s.query('delete from sys_user_task where uid = ? and tid in (?, ?)', [
        uid,
        20000 + hid,
        30000 + hid,
      ]);
      w5Error(await hotel('recordTask', hid));
      await w4Number(
        s,
        'select count(*) as value from sys_user_task where uid = ? and tid in (?, ?)',
        [uid, 20000 + hid, 30000 + hid],
        2,
      );
      w5Error(await hotel('recordTask', hid));
      await w4Number(
        s,
        'select count(*) as value from sys_user_task where uid = ? and tid in (?, ?)',
        [uid, 20000 + hid, 30000 + hid],
        2,
      );
      s.stopRng();
    },
  },
  {
    name: 'W7 commission detail and reward: 90% payout clears both rows and reports the poster',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const { uid } = session;
      // The dump ships no commission rows; ids live in the 200000-400000 detail/reward window.
      // finishuid = uid turns the detail state true, a fixed endtime keeps the reply absolute.
      await s.query(
        `insert into sys_pub_reward_task
           (id, uid, targetcid, targetname, type, goal, endtime, money, number, state, finishuid, todo)
         values (?, ?, 12003, '长乐', 0, 5000, 1900000000, 1010, 1, -1, ?, 'W7委托内容')`,
        [200001, uid, uid],
      );
      await s.query(
        `insert into sys_pub_reward_task
           (id, uid, targetcid, targetname, type, goal, endtime, money, number, state, finishuid, todo)
         values (?, ?, 12003, '长乐', 1, 8000, 1900000000, 500, 0, -1, ?, 'W7未完成委托')`,
        [200002, uid, uid],
      );
      await s.query(
        `insert into sys_user_reward_task (uid, tid, state, type, targetcid, goal)
         values (?, 200001, -1, 0, 12003, 5000), (?, 200002, 0, 1, 12003, 8000)`,
        [uid, uid],
      );
      await s.command(session, 'getTaskDetail', 200001);
      await s.command(session, 'getTaskDetail', 200002);
      const money = await s.query<{ money: string }>('select money from sys_user where uid = ?', [
        uid,
      ]);
      // An unfinished commission is refused before anything is granted or deleted.
      w5Error(await s.command(session, 'getReward', 200002));
      await w4Number(
        s,
        'select money - ? as value from sys_user where uid = ?',
        [Number(money[0]?.money ?? 0), uid],
        0,
      );
      w4Success(await s.command(session, 'getReward', 200001));
      // money*9/10, and both receiver and posted rows are gone (the delete has no uid filter).
      await w4Number(
        s,
        'select money - ? as value from sys_user where uid = ?',
        [Number(money[0]?.money ?? 0), uid],
        909,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_user_reward_task where tid = ?',
        [200001],
        0,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_pub_reward_task where id = ?',
        [200001],
        0,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_user_reward_task where tid = ?',
        [200002],
        1,
      );
    },
  },
  {
    name: 'W7 selection protocols: armor by part, by id and heroes by level',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const { uid } = session;
      const cid = await lastCity(s, uid);
      // Exactly one candidate per filter: the dump's unworn pieces tie on value, so the unfiltered
      // stock is dropped first (白虎护腕 53047 is part 7 / type 6).
      await s.query('delete from sys_user_armor where uid = ? and hid = 0', [uid]);
      await s.query(
        `insert into sys_user_armor (sid, uid, armorid, hp, hp_max, hid, strong_level, strong_value)
         values (990003, ?, 53047, 1000, 100, 0, 0, 0)`,
        [uid],
      );
      await s.command(session, 'getArmorsByPartOrType', cid, 52, 0, 7, 1);
      // A piece carries two attribute rows (attid 1 and 2); the PHP selects them without an
      // order by, so MyISAM and InnoDB return the pair in opposite orders. Every filter that
      // matches this piece (part 7, type 6 and by id) needs the unordered mark.
      s.unordered(4, 4);
      await s.command(session, 'getArmorsByPartOrType', cid, 51, 0, 6, 1);
      s.unordered(4, 4);
      await s.command(session, 'getArmorsByPartOrType', cid, 0, 53047, 0, 1);
      s.unordered(4, 4);
      await s.command(session, 'getArmorsByPartOrType', cid, 51, 0, 99, 1);
      s.unordered(4, 4);
      await s.command(session, 'getArmorsByPartOrType', cid, 0, 53047, 0, 1);
      s.unordered(4, 4);
      await s.command(session, 'getArmorsByPartOrType', cid, 51, 0, 99, 1);
      s.unordered(4, 4);
      // Two heroes of distinct levels: the filter and the empty reply compare exactly.
      await s.query('delete from sys_city_hero where uid = ? and state = 0', [uid]);
      await s.query(
        `insert into sys_city_hero (hid, uid, npcid, name, sex, face, cid, state, level, loyalty)
         values (990083, ?, ?, 'W7选将甲', 1, 1, ?, 0, 5, 100)`,
        [uid, uid, cid],
      );
      await s.query(
        `insert into sys_city_hero (hid, uid, npcid, name, sex, face, cid, state, level, loyalty)
         values (990084, ?, ?, 'W7选将乙', 0, 1, ?, 0, 30, 100)`,
        [uid, uid, cid],
      );
      await s.command(session, 'getHerosByLevel', cid, 0, 10);
      await s.command(session, 'getHerosByLevel', cid, 0, 50);
    },
  },
  {
    name: 'W8 login, sign, activity, craft buffers, progress and offline compatibility',
    tables: { sys_user_sign: { offsets: ['time'] } },
    run: async (s) => {
      s.rng([0]);
      const session = await s.login(EXISTING_PLAYER);
      const { uid } = session;
      await s.command(session, 'getLoginInfo');
      s.offset(2, 0, 'time');
      await s.command(session, 'finishOpenAnnounce');
      await w4Number(
        s,
        'select count(*) as value from sys_user_task where uid = ? and tid = 292 and state = 1',
        [uid],
        1,
      );
      await s.command(session, 'getLoginReward', -1);
      await s.command(session, 'getActivityList');
      await s.command(session, 'getHuangJinProgress', 0);
      await s.command(session, 'getDongZhuoProgress', 0);
      await s.command(session, 'getDongZhuoProgress', 6);
      await s.command(session, 'getAllHeroList');
      await s.command(session, 'getCrossShaChangInfo');
      await s.command(session, 'getCrossShaChangReward');
      await s.command(session, 'sendCloseMsg');
      w5Error(await s.command(session, 'joinCrossShaChang', 990099));
      const [hero] = await s.query<{ hid: string }>(
        'select hid from sys_city_hero where uid = ? and state = 0 order by hid limit 1',
        [uid],
      );
      if (hero) await s.command(session, 'joinCrossShaChang', Number(hero.hid));
      await s.command(session, 'getCraftBuffer');
      s.stopRng();
    },
  },
  {
    // 联盟群发 success path (MailFunc.php:395-460): one insert-select letter per member, both
    // alarms raised, 2 传音符 spent, goal 80 completed. The dump ships no unions, so the fixture
    // founds one directly; leader = uid satisfies the 盟主 gate with an ordinary union_pos. The
    // horn shortage is tried first: the raw not_enough_goods error fires before any letter row.
    // The fan-out `insert … select … from sys_user where union_id = …` has no order by, so the
    // engines emit the member rows in different orders (MyISAM dump order 1002-first vs InnoDB
    // PK order 1001-first) and the auto-increment sys_mail_box.mid lands swapped (16/17). That
    // is engine row order, not port behavior: mid is ignored in the delta and masked in the
    // mailbox replies, everything else (contentid, title, type, names, flags) compares exact.
    name: 'union mail: 联盟群发 fans out to both members and spends the horns',
    tables: { sys_mail_box: { ignore: ['mid'] } },
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const uid = session.uid;
      await s.query(
        `insert into sys_union (id, name, leader, creator, member, createtime)
         values (990021, '差分联盟', ?, 0, 2, 1500000000)`,
        [uid],
      );
      await s.query('update sys_user set union_id = 990021 where uid in (?, 1002)', [uid]);
      const member = await s.login('judingwan');
      await s.query('update sys_goods set count = 1 where uid = ? and gid = 1', [uid]);
      w5Error(
        await s.command(session, 'sendUnionMail', EXISTING_PLAYER, 990021, '群发', '差分群发正文'),
      );
      await w4Number(s, 'select count(*) as value from sys_mail_box where fromuid = ?', [uid], 0);
      // Exactly two horns are needed; the success send drains them to zero.
      await s.query('update sys_goods set count = 2 where uid = ? and gid = 1', [uid]);
      w4Success(
        await s.command(session, 'sendUnionMail', EXISTING_PLAYER, 990021, '群发', '差分群发正文'),
      );
      // The sender's own copy sits in the outbox with the ［联盟］ title prefix — and so does
      // the member's copy, because every fanned row carries fromuid = sender; both share one
      // posttime, so the `order by posttime desc` tie permutes between the engines. The
      // letter's own mid is the engine-swapped auto-inc (see the tables note above).
      await s.command(session, 'getOutboxMail', 0);
      s.mask(4, 2, '*', 'mid');
      s.unordered(4, 2);
      await s.command(member, 'getInboxMail', 0);
      s.mask(4, 2, '*', 'mid');
      await w4Number(s, 'select count as value from sys_goods where uid = ? and gid = 1', [uid], 0);
      await w4Number(
        s,
        `select count(*) as value from sys_mail_box
         where contentid = (select max(mid) from sys_mail_content)`,
        [],
        2,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_user_goal where uid = ? and gid = 80',
        [uid],
        1,
      );
      await w4Number(
        s,
        'select count(*) as value from sys_alarm where uid in (?, 1002) and mail = 1',
        [uid],
        2,
      );
    },
  },
];

async function seedScoutPatrol(
  s: Side,
  attacker: number,
  defender: number,
  draw = false,
): Promise<void> {
  const session = await s.login(EXISTING_PLAYER);
  const uid = session.uid;
  const cid = await lastCity(s, uid);
  const targetCid = 188128;
  const victimUid = 1002;
  await s.query('delete from sys_troops where uid = ?', [uid]);
  await s.query('delete from sys_report where uid in (?, ?)', [uid, victimUid]);
  await s.query(
    'insert into sys_alarm (uid, report) values (?, 1), (?, 1) on duplicate key update report = 1',
    [uid, victimUid],
  );
  await s.query('delete from sys_city_soldier where cid = ?', [targetCid]);
  await s.query('insert into sys_city_soldier (cid, sid, count) values (?, 3, ?)', [
    targetCid,
    defender,
  ]);
  await s.query(
    `insert into sys_city_technic (cid, tid, level) values (?, 7, 10)
      on duplicate key update level = 10`,
    [cid],
  );
  if (draw) await s.query('update cfg_soldier set ap = 0, dp = 0, hp = 1 where sid = 3');
  await s.query(
    `insert into sys_troops
      (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
     values (?, ?, 0, ?, 2, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, ?, '0', 0, 0)`,
    [uid, cid, targetCid, `1,3,${attacker}`],
  );
  s.rng([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  await s.tick('HandleTroop');
  s.stopRng();
  await s.query('delete from sys_troops where uid = ?', [uid]);
  await s.query('delete from sys_report where uid in (?, ?)', [uid, victimUid]);
}

async function seedPlayerCityCapture(
  s: Side,
  targetType: number,
  governmentLevel: number,
  withPrerequisites: boolean,
  relocate = false,
): Promise<void> {
  const session = await s.login(EXISTING_PLAYER);
  const uid = session.uid;
  const cid = await lastCity(s, uid);
  const target = 3005;
  await s.query('update sys_user set nobility = 1 where uid = ?', [uid]);
  await s.query('update mem_world set type = 0, ownercid = ? where wid = 35', [target]);
  await s.query(
    `insert into sys_city (cid, uid, name, type, state, province)
     values (?, 1002, '被占城', ?, 0, 10)`,
    [target, targetType],
  );
  await s.query(
    `insert into sys_building (cid, xy, bid, level)
     values (?, 120, 6, ?), (?, 121, 5, 15), (?, 10, 1, 8), (?, 99, 1, 8)`,
    [target, governmentLevel, target, target, target],
  );
  await s.query(
    `insert into mem_city_resource (cid, people, food, wood, rock, iron, gold, morale, complaint, lastupdate)
     values (?, 100, 2000, 3000, 4000, 5000, 6000, 0, 0, 0)`,
    [target],
  );
  await s.query(
    `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
       affairs_base, bravery_base, wisdom_base, loyalty, herotype)
     values (900101, 1002, '俘虏将', 0, 0, ?, 1, 10, 50, 60, 60, 60, 0, 0)`,
    [target],
  );
  await s.query('insert into sys_city_soldier (cid, sid, count) values (?, 3, 5)', [target]);
  if (withPrerequisites) {
    for (let i = 0; i < 4; i++) {
      const prerequisite = 900201 + i;
      await s.query(
        "insert into sys_city (cid, uid, name, type, state, province) values (?, ?, '前置县城', 1, 0, 10)",
        [prerequisite, uid],
      );
      await s.query('update mem_world set type = 0, ownercid = ? where wid = ?', [
        prerequisite,
        36 + i,
      ]);
    }
  }
  if (relocate) {
    await s.query('delete from sys_city where uid = 1002 and cid <> ?', [target]);
    await s.query(
      'update mem_world set state = 1 where province = 1 and type = 1 and wid <> 499499',
    );
    await s.query(
      'insert into mem_world (wid, type, ownercid, state, level, maxlevel, province, jun) values (499499, 1, 0, 0, 1, 1, 1, 1)',
    );
    await s.query(
      `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base,
        affairs_base, bravery_base, wisdom_base, loyalty, herotype)
       values (900102, 1002, '迁城君主', 0, 0, ?, 0, 1, 50, 1, 1, 1, 100, 1000)`,
      [target],
    );
    const defenderTroop = `insert into sys_troops
      (id, uid, cid, hid, targetcid, task, state, startcid, starttime, pathtime, endtime, soldiers, resource)
      values (?, 1002, ?, 0, ?, 4, ?, ?, unix_timestamp() - 600, 600, unix_timestamp() + 600, '1,1,20', '0')`;
    await s.query(defenderTroop, [900301, target, 188128, 0, 0]);
    await s.query(defenderTroop, [900302, 188128, target, 3, target]);
    await s.query(defenderTroop, [900303, 188128, target, 3, target]);
    await s.query(
      'insert into sys_gather (wid, troopid, fooduse, level, starttime) values (35, 900301, 0, 1, 0)',
    );
  }
  await s.query(
    `insert into sys_troops
      (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
     values (?, ?, 0, ?, 4, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,1,30000', '0', 0, 0)`,
    [uid, cid, target],
  );
  s.rng([1, 1, 0, 0, 1, 2, 1, 1, 1, 1]);
  await s.tick('HandleTroop');
  await s.query(
    'update sys_battle set starttime = 0 where id = (select id from mem_battle where attackcid = ?)',
    [cid],
  );
  await s.query(
    'update mem_battle set wallhp = 0, nexttime = unix_timestamp() - 1 where attackcid = ?',
    [cid],
  );
  await s.tick('HandleBattle');
  // A zero starttime deterministically selects the >86400 robbery branch on both engines; using
  // unix_timestamp() here made the outcome depend on whether the next tick crossed a second.
  await s.query(
    'update sys_battle set starttime = 0 where id = (select id from mem_battle where attackcid = ?)',
    [cid],
  );
  await s.query('update mem_battle set nexttime = unix_timestamp() - 1 where attackcid = ?', [cid]);
  await s.tick('HandleBattle');
  s.stopRng();
}

function wid2cid(wid: number): number {
  const y = Math.floor(wid / 10000) * 10 + Math.floor((wid % 100) / 10);
  const x = Math.floor((wid % 10000) / 100) * 10 + (wid % 10);
  return y * 1000 + x;
}

/** A 城墙 reply: `[current, next, defences, queue, space, used]`; the built entry's time runs. */
function reinforceTimes(s: Side): void {
  s.mask(6, 3, '*', 'time_left');
}

/**
 * A 兵营 reply: `[current, next, soldiers, queue, conversions]`, wrapped with a message by
 * dissolveSoldier; the trainee's time runs.
 */
function draftTimes(s: Side): void {
  s.mask(6, 3, '*', 'time_left');
  s.mask(6, 0, 3, '*', 'time_left');
}

/**
 * A 书院 reply: `[current, next, [technics, colleges]]` inside the dialog envelope. The legacy
 * technics come in MyISAM row order (11 and 16 swapped on disk), the new ones by tid.
 */
function technicTimes(s: Side): void {
  s.mask(6, 2, 0, '*', 'state_timeleft');
  s.offset(6, 2, 0, '*', 'state_endtime');
  s.unordered(6, 2, 0);
}

/** A city that belongs to someone else in the shipped save. */
const FOREIGN_CITY = 1;

/** A getCityBuilding-style reply: seconds left move with the clock, end times are now + duration. */
function buildingTimes(s: Side): void {
  s.mask(4, '*', 'state_timeleft');
  s.offset(4, '*', 'state_endtime');
}

function activityConfigTimes(s: Side): void {
  s.offset(4, 0, 'now');
  s.offset(4, 0, 'starttime');
  s.offset(4, 0, 'endtime');
  s.offset(4, 0, 'reward_endtime');
}

/**
 * A gather report says how long it ran ("经过10小时30分0秒的采集"); the start time is set just
 * before the call, so the seconds may tick over on one side.
 */
function gatherSeconds(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/(\d+小时\d+分钟?)\d+秒/g, '$1*秒') : value;
}

/** {@link gatherSeconds} for the string at `path` in the last response. */
function gatherSecondsIn(side: Side, ...path: number[]): void {
  const last = side.responses.at(-1);
  if (!last) return;
  let node = last.value as unknown[];
  for (const key of path.slice(0, -1)) node = node?.[key] as unknown[];
  const leaf = path.at(-1)!;
  if (Array.isArray(node)) node[leaf] = gatherSeconds(node[leaf]);
}

async function lastCity(side: Side, uid: number): Promise<number> {
  const [row] = await side.query<{ lastcid: string }>(
    'select lastcid from sys_user where uid = ?',
    [uid],
  );
  return Number(row?.lastcid ?? 0);
}

/** Assert success as well as parity: two matching errors must not pass a successful-write case. */
function w4Success(response: unknown): void {
  if (!Array.isArray(response) || Number(response[0]) !== 1) {
    throw new Error(`W4 expected command success: ${JSON.stringify(response)}`);
  }
}

async function w4Number(s: Side, sql: string, params: unknown[], expected: number): Promise<void> {
  const [row] = await s.query<{ value: string }>(sql, params);
  if (!row || Number(row.value) !== expected) {
    throw new Error(`W4 invariant failed: ${sql}; expected ${expected}, got ${row?.value}`);
  }
}

async function w4Goods(s: Side, uid: number, gid: number, count: number): Promise<void> {
  await s.query(
    'insert into sys_goods (uid, gid, count) values (?, ?, ?) on duplicate key update count = values(count)',
    [uid, gid, count],
  );
}

/** Remove only the tested user's activity so protection/relocation checks reach their intended gate. */
async function w4Idle(s: Side, uid: number): Promise<void> {
  await s.query('update sys_user set state = 0 where uid = ?', [uid]);
  await s.query('delete from sys_user_state where uid = ?', [uid]);
  await s.query('delete from mem_user_buffer where uid = ? and buftype in (7, 8, 23, 913)', [uid]);
  await s.query('delete from sys_troops where uid = ?', [uid]);
  await s.query('delete from sys_luoyang_troops where uid = ?', [uid]);
  await s.query('update sys_technic set state = 0 where uid = ?', [uid]);
  await s.query(
    'update sys_building set state = 0 where cid in (select cid from sys_city where uid = ?)',
    [uid],
  );
  for (const table of ['sys_city_draftqueue', 'sys_city_reinforcequeue']) {
    await s.query(`delete from ${table} where cid in (select cid from sys_city where uid = ?)`, [
      uid,
    ]);
  }
  await s.query(
    'update mem_world set state = 0 where ownercid in (select cid from sys_city where uid = ?)',
    [uid],
  );
}

async function w4MoveDestination(s: Side, cid: number): Promise<number> {
  const [owner] = await s.query<{ uid: string }>('select uid from sys_city where cid = ?', [cid]);
  await w4Idle(s, Number(owner!.uid));
  await s.query('update mem_state set value = 0 where state = 197');
  // Deterministic ORDER BY, no aliasing; filter cid==wid to avoid both placeholder collisions.
  const rows = await s.query<{ wid: string }>(
    'select w.wid from mem_world w where w.type = 1 and w.ownercid = 0 and w.wid > 0 and not exists (select 1 from sys_city c where c.cid = (floor(w.wid / 10000) * 10 + floor((w.wid % 100) / 10)) * 1000 + floor((w.wid % 10000) / 100) * 10 + (w.wid % 10)) order by w.wid',
  );
  const row = rows.find(
    (r) => wid2cid(Number(r.wid)) !== Number(r.wid) && wid2cid(Number(r.wid)) !== cid,
  );
  if (!row) throw new Error('W4 needs a free relocation tile');
  const wid = Number(row.wid);
  const target = wid2cid(wid);
  // Free NPC tiles retain data. Clear the destination before either server performs deletes/updates.
  for (const table of [
    'sys_city',
    'sys_building',
    'mem_building_destroying',
    'mem_building_upgrading',
    'mem_technic_upgrading',
    'sys_city_technic',
    'sys_technic',
    'mem_city_buffer',
    'sys_city_soldier',
    'sys_city_draftqueue',
    'mem_city_draft',
    'mem_city_wounded',
    'mem_city_captive',
    'mem_city_lamster',
    'sys_city_defence',
    'sys_city_reinforcequeue',
    'mem_city_reinforce',
    'sys_city_hero',
    'sys_city_tactics',
    'sys_city_res_add',
    'mem_city_resource',
    'mem_city_schedule',
    'sys_city_rumor',
    'sys_recruit_hero',
  ])
    await s.query(`delete from ${table} where cid = ?`, [target]);
  await s.query('delete from sys_troops where cid = ? or targetcid = ?', [target, target]);
  await s.query('delete from sys_troops where targetcid = ? and state = 4', [cid]);
  const fields = await s.query<{ wid: string }>('select wid from mem_world where ownercid = ?', [
    cid,
  ]);
  for (const field of fields) {
    await s.query('delete from sys_troops where targetcid = ? and state = 4', [
      wid2cid(Number(field.wid)),
    ]);
  }
  await s.query('delete from cfg_soldier_special_city where cid = ?', [cid]);
  await s.query('update sys_city set type = 0 where cid = ?', [cid]);
  await s.query('update mem_world set state = 1 where province = 18 and type = 1 and ownercid = 0');
  await s.query(
    'update mem_world set province = 18, type = 1, state = 0, ownercid = 0 where wid = ?',
    [wid],
  );
  return target;
}

/** Preserve report wording, users and dates: only the wall-clock HH:MM:SS is nondeterministic. */
function w4ReportClock(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\b\d{2}:\d{2}:\d{2}\b/g, '<clock>') : value;
}

function w5Error(response: unknown): void {
  if (!Array.isArray(response) || Number(response[0]) !== 0) {
    throw new Error(`W5 expected PHP error envelope: ${JSON.stringify(response)}`);
  }
}

/** Isolate hero-list responses to one hero; every future buffer timestamp has an explicit offset. */
async function w6Hero(s: Side, uid: number, cid: number): Promise<void> {
  await s.query('delete from sys_city_hero where uid = ? and cid = ?', [uid, cid]);
  await s.query(
    `insert into sys_city_hero (hid, uid, name, sex, face, cid, state, level, command_base, affairs_base, bravery_base, wisdom_base, loyalty) values (990071, ?, 'W6验收将', 0, 1, ?, 0, 1, 10, 10, 10, 10, 100)`,
    [uid, cid],
  );
  await s.query(
    'insert into mem_hero_blood (hid, `force`, force_max, energy, energy_max) values (990071, 100, 100, 100, 100)',
  );
}

async function w6Reward(
  s: Side,
  uid: number,
  cid: number,
  id: number,
  sort: number,
  money: number,
  details: string,
): Promise<void> {
  await s.query(
    'insert into sys_hero_expr_reward (id, uid, cid, hid, type, sort, money, details, endtime) values (?, ?, ?, 990071, 990071, ?, ?, ?, unix_timestamp() + 3600)',
    [id, uid, cid, sort, money, details],
  );
}
