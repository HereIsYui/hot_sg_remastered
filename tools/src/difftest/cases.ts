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
      await avoidCidWidTiles(s, 5);
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
      // count is rand(600,1800) and the sid can be rand(45,50); PHP rand() and the new server's
      // RandomService are both unseeded here with no shared source, so the exact count/sid are
      // nondeterministic and cannot match. We mask the success message and drop the random count
      // from the sys_city_soldier delta (see tables.ts); the leading-0 success flag, the sid when
      // fixed, and every later error branch still compare exactly.
      await s.query('update sys_city set type = 3, conscript = 1, is_special = 0 where cid = ?', [
        cid,
      ]);
      await ground('conscript');
      s.mask(1); // 成功招募到<兵种><rand(600,1800)> — the grant count is random on both sides.
      // Already drafted today.
      await s.query('update sys_city set conscript = unix_timestamp() where cid = ?', [cid]);
      await ground('conscript');
      // Not a 县/郡/州 the user owns.
      await ground('conscript');
      await s.dialog(session, FOREIGN_CITY, 8, 40, 'conscript');

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
    // 演习 (startManeuver): its settlement is cfg_js.php::upManeuver (the battle engine, another
    // agent's module), so startManeuver is refused here; getManeuverResult answers "still running"
    // for an unknown id. Both sides must reject — the new server throws a not-ported error, the
    // legacy queues a row no backend settles — so only the leading 0 is compared.
    name: 'ground maneuver is not settled (battle engine unported)',
    run: async (s) => {
      const session = await s.login(EXISTING_PLAYER);
      const cid = await lastCity(s, session.uid);
      const ground = (func: string, ...args: unknown[]) =>
        s.dialog(session, cid, 8, 40, func, ...args);
      await ground('getManeuverResult', 999999);
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
      await s.command(session, 'getArmyTroops');
      s.unordered(0);
      await s.command(session, 'getStayTroops');
      s.unordered(1);
      await s.command(session, 'getUnionTroops');
      await s.command(session, 'getEnemyTroops');

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
      // A battle arrival (task 4, state 0) due: both sides leave it in place.
      await s.query(
        `insert into sys_troops
          (uid, cid, hid, targetcid, task, state, starttime, pathtime, endtime, soldiers, resource, people, fooduse)
         values (?, ?, 0, ?, 4, 0, unix_timestamp() - 600, 600, unix_timestamp() - 1, '1,3,10', '0', 0, 0)`,
        [uid, cid, cid + 3000],
      );
      await s.tick('HandleTroop');
      await s.query('delete from sys_troops where uid = ?', [uid]);
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
