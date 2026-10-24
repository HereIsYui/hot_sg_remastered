import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import {
  array2troop,
  checkSodier,
  createCityDefence,
  createmapSoldier,
  v2r,
  type CheckSodierDeps,
} from './check-sodier';

type Row = Record<string, unknown>;

// $GLOBALS['soldier']['soldiervalue'] (index 0 unused); only the indices the tests touch matter.
const SOLDIER_VALUE = [
  0, 23, 31, 70, 90, 135, 140, 298, 285, 875, 1000, 1375, 2900, 31, 90, 135, 140, 285,
];

/** A scripted draw source: raw for `rand()`, scaled for `mtRand`, matching RandomService. */
function draws(seq: number[]) {
  let i = 0;
  const next = () => seq[i++ % seq.length] ?? 0;
  return {
    rand: () => next(),
    mtRand: (min: number, max: number) => (max > min ? min + (next() % (max - min + 1)) : min),
  };
}

function deps(rules: Respond[], seq: number[] = []): { d: CheckSodierDeps; db: FakeDb } {
  const db = new FakeDb(rules);
  const scope = db.scope;
  const query = async (q: ReturnType<typeof sql<Row>>) => (await q.execute(scope.db)).rows;
  const { rand, mtRand } = draws(seq);
  const added: { cid: number; soldiers: Map<number, number>; add: boolean }[] = [];
  const d: CheckSodierDeps = {
    db: scope.db,
    query,
    one: async (q) => (await query(q))[0] ?? false,
    cell: async (q) => {
      const row = (await query(q))[0];
      return row ? Object.values(row)[0] : undefined;
    },
    soldierValue: () => SOLDIER_VALUE,
    addCitySoldiers: async (cid, soldiers, add) => {
      added.push({ cid, soldiers, add });
    },
    rand,
    mtRand,
  };
  (d as unknown as { _added: typeof added })._added = added;
  return { d, db };
}

const NO = (match: RegExp): Respond => ({ match, rows: [] });

describe('createmapSoldier', () => {
  it('splits an npcValue across <6 soldier types by raw rand() percentages', () => {
    // soldierType '13,14,15,16,17' (5 types, <6 regime): rand() % (100-totalRnd) per sid.
    // draws [40,30,20,10,50]: 40, 30, 20, then span=10 and 10%10=0 → sid 16 skipped (pct 0),
    // total 90<100 so sid 17 would draw next but 90+ (50%10=0) → also 0. So three types land.
    const { d } = deps([], [40, 30, 20, 10, 50]);
    const m = createmapSoldier(d, 100000, '13,14,15,16,17', 4);
    // each count = floor(100000 * pct * 0.0078 / soldiervalue[sid]); ksorted.
    expect([...m.keys()]).toEqual([13, 14, 15]);
    expect(m.get(13)).toBe(Math.floor((100000 * 40 * 0.0078) / 31));
    expect(m.get(15)).toBe(Math.floor((100000 * 20 * 0.0078) / 135));
    expect(m.has(16)).toBe(false);
  });

  it('returns a [0=>0] marker when no type gets a positive count', () => {
    const { d } = deps([], [0, 0, 0, 0, 0]);
    const m = createmapSoldier(d, 100000, '13,14,15,16,17', 4);
    expect([...m.entries()]).toEqual([[0, 0]]);
  });
});

describe('array2troop', () => {
  it('serialises a sid→count map as `num,sid,cnt,` with a trailing comma', () => {
    expect(
      array2troop(
        new Map([
          [13, 50],
          [14, 7],
        ]),
      ),
    ).toBe('2,13,50,14,7,');
  });
  it('returns the scalar 0 for an empty map', () => {
    expect(array2troop(new Map())).toBe('0');
  });
});

describe('v2r', () => {
  it('a wild-field respawn (type 0 in v2r) yields no resources', () => {
    const { d } = deps([]);
    expect(v2r(d, 5000, 0)).toBe('0,0,0,0,0,');
  });
  it('a type-4 (grass) field puts the value into food', () => {
    const { d } = deps([]);
    // type 4 → temp 1 → food = floor(value/10).
    expect(v2r(d, 5000, 4)).toBe('0,500,0,0,0,');
  });
});

describe('checkSodier (wild field respawn)', () => {
  it('spawns a fresh NPC troop with createmapSoldier soldiers and the mt_rand uid', async () => {
    // field: type 4 (grass), level 3, uid 0 (<1000), province 10 (<14 → default NPC types).
    const field: Row = { wid: 14, type: 4, level: 3, uid: 0 };
    const rules: Respond[] = [
      // choseHero: no city heroes at this NPC field cid → hid 0.
      NO(/select hid from sys_city_hero where cid = \? and state = 7/i),
      NO(/select hid from sys_city_hero where cid = \? and state = 1/i),
      NO(/select hid from sys_city_hero where cid = \? order by rand/i),
      // province
      { match: /select province from mem_world where wid = \?/i, rows: [{ province: 10 }] },
      // time since last respawn → none → clamps to 1.
      NO(/select \(unix_timestamp\(\) - last_create_npc\)/i),
      // cfg_field_npcvalue[3] = 5000.
      {
        match: /select npcvalue from cfg_field_npcvalue where level = \?/i,
        rows: [{ npcvalue: 5000 }],
      },
      // no NPC hero on the field cid.
      NO(/select cid from sys_city_hero where npcid <> 0/i),
      // no existing NPC troop on the field cid.
      NO(/select \* from sys_troops where cid = \? and uid < 1000 order by id asc/i),
      // the delete + insert + schedule upsert all no-op in the fake.
      NO(/.*/),
    ];
    // seq: mt_rand(0,5) pick, then 5 raw rand() for createmapSoldier.
    const { d, db } = deps(rules, [0, 40, 30, 20, 10, 50]);
    const ret = await checkSodier(d, field);
    expect(ret).toBeUndefined();
    // it inserts a sys_troops row (task 5, state 4) with the respawned soldiers.
    const insert = db.executed.find((q) => /insert into sys_troops/i.test(q.sql));
    expect(insert).toBeTruthy();
    // uid = mt_rand(0,5) with draw 0 → 0 (default NPC type '13,14,15,16,17').
    expect(insert!.parameters).toContain(0);
    // soldiers param is the array2troop string. npcValue 5000*1.1 → three types get a count:
    // 13→55, 14→14, 15→6 (percentages 40/30/20; 16/17 round to 0).
    const soldiers = insert!.parameters.find(
      (p) => typeof p === 'string' && p === '3,13,55,14,14,15,6,',
    );
    expect(soldiers).toBe('3,13,55,14,14,15,6,');
    // and the schedule is stamped.
    expect(db.executed.some((q) => /insert into mem_world_schedule/i.test(q.sql))).toBe(true);
  });

  it('is a no-op for a player-owned field (uid >= 1000)', async () => {
    const field: Row = { wid: 14, type: 4, level: 3, uid: 1002 };
    const { d, db } = deps(
      [
        NO(/select hid from sys_city_hero where cid = \? and state = 7/i),
        NO(/select hid from sys_city_hero where cid = \? and state = 1/i),
        NO(/select hid from sys_city_hero where cid = \? order by rand/i),
        { match: /select province from mem_world where wid = \?/i, rows: [{ province: 10 }] },
        NO(/.*/),
      ],
      [0],
    );
    const ret = await checkSodier(d, field);
    expect(ret).toBeUndefined();
    expect(db.executed.some((q) => /insert into sys_troops/i.test(q.sql))).toBe(false);
  });
});

describe('createCityDefence', () => {
  it('seeds the per-level defence rows for an NPC city (type 0, uid<1000)', async () => {
    const field: Row = { wid: 20, type: 0, level: 2, uid: 894 };
    const { d, db } = deps([NO(/select \(unix_timestamp\(\) - last_create_defence\)/i), NO(/.*/)]);
    await createCityDefence(d, field);
    const inserts = db.executed.filter((q) => /insert into sys_city_defence/i.test(q.sql));
    // level 2 → two defence rows (did 1 and 2).
    expect(inserts.length).toBe(2);
    expect(db.executed.some((q) => /insert into mem_world_schedule/i.test(q.sql))).toBe(true);
  });

  it('builds nothing at level 1 (the original undefined-count no-op)', async () => {
    const field: Row = { wid: 20, type: 0, level: 1, uid: 894 };
    const { d, db } = deps([NO(/select \(unix_timestamp\(\) - last_create_defence\)/i)]);
    await createCityDefence(d, field);
    expect(db.executed.some((q) => /insert into sys_city_defence/i.test(q.sql))).toBe(false);
  });

  it('is a no-op for a field (type != 0)', async () => {
    const field: Row = { wid: 14, type: 4, level: 3, uid: 0 };
    const { d, db } = deps([]);
    await createCityDefence(d, field);
    expect(db.executed.length).toBe(0);
  });
});
