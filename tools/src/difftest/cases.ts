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
      // Set lists and set attributes come without ORDER BY: MyISAM vs InnoDB row order.
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
];

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

async function lastCity(side: Side, uid: number): Promise<number> {
  const [row] = await side.query<{ lastcid: string }>(
    'select lastcid from sys_user where uid = ?',
    [uid],
  );
  return Number(row?.lastcid ?? 0);
}
