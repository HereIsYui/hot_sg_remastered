import type { Side } from '../lib/difftest/side.ts';

export interface DiffCase {
  name: string;
  run(side: Side): Promise<unknown>;
}

function cid2wid(cid: number): number {
  const y = Math.floor(cid / 1000);
  const x = cid % 1000;
  return Math.floor(y / 10) * 10000 + Math.floor(x / 10) * 100 + (y % 10) * 10 + (x % 10);
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
    },
  },
  {
    name: 'new role opens its city',
    run: async (s) => {
      const session = await s.login('difftest_city');
      await s.command(session, 'createRole', '城主', '新城', 5, '城', 0, 3, 0);
      await aliasNewCity(s, session.uid);
      const cid = await lastCity(s, session.uid);
      await s.command(session, 'getCityInfo', cid, 1);
      s.mask(4, 2, '*', 'state_timeleft');
      s.mask(4, 4, 0, 'jun'); // random tile
      await s.cityCommand(session, cid, 0);
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
];

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

async function lastCity(side: Side, uid: number): Promise<number> {
  const [row] = await side.query<{ lastcid: string }>(
    'select lastcid from sys_user where uid = ?',
    [uid],
  );
  return Number(row?.lastcid ?? 0);
}
