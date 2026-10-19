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
];

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
