import { describe, expect, it } from 'vitest';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import { LangService } from '../common/lang.service';
import { StatCommands } from './stat.commands';

const lang = new LangService({
  sys: { wan: '万' },
  heroState: [
    '空闲',
    '城守',
    '出征',
    '战斗',
    '驻守',
    '俘虏',
    '投奔',
    '主将',
    '军师',
    '流亡',
    '历练',
    '历练返回',
  ],
});

const ctx = { uid: 1001, cid: 209355, ip: 0, sip: '' };
const NO = (match: RegExp): Respond => ({ match, rows: [] });

function build(rules: Respond[]) {
  const db = new FakeDb(rules);
  const cmd = new StatCommands(db.scope, lang);
  return { cmd, db };
}

describe('StatCommands.getStats', () => {
  it('returns error for an unknown type', async () => {
    const { cmd } = build([NO(/.*/)]);
    expect(await cmd.getStats(ctx, [9])).toBe('error');
  });

  it('city stats: merges the upgrade/draft/defence queue counts and renders (x,y)', async () => {
    const { cmd } = build([
      {
        match: /from sys_city c left join mem_city_resource r/i,
        rows: [{ cid: 209355, name: '长乐宫', people: 100, morale: 90, complaint: 5, tax: 10 }],
      },
      { match: /from sys_building/i, rows: [{ cid: 209355, cnt: 3 }] },
      { match: /from mem_technic_upgrading/i, rows: [] },
      { match: /from mem_city_draft/i, rows: [{ cid: 209355, cnt: 2 }] },
      { match: /from mem_city_reinforce/i, rows: [] },
      NO(/.*/),
    ]);
    const res = (await cmd.getStats(ctx, [0])) as unknown[];
    expect(res[0]).toEqual([]);
    expect(res[1]).toBe(0);
    expect(res[2]).toEqual({
      cid: '(355,209)',
      name: '长乐宫',
      people: 100,
      morale: 90,
      complaint: 5,
      tax: 10,
      buildingCount: 3,
      draftCount: 2,
    });
  });

  it('resource stats: floored stocks', async () => {
    const { cmd } = build([
      {
        match: /floor\(r\.gold\) as gold/i,
        rows: [{ cid: 200351, name: '新城', gold: 100, food: 2, wood: 3, rock: 4, iron: 5 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getStats(ctx, [1])) as unknown[];
    expect(res[1]).toBe(1);
    expect(res[2]).toMatchObject({ cid: '(351,200)', gold: 100, food: 2 });
  });

  it('product stats: the tax tech multiplies gold and the hero fee is deducted', async () => {
    const { cmd } = build([
      {
        match: /floor\(r\.people \* r\.tax/i,
        rows: [
          {
            cid: 209355,
            name: '长乐宫',
            gold_add: 1000,
            hero_fee: 50,
            food_add: 100,
            wood_add: 1,
            rock_add: 1,
            iron_add: 1,
          },
        ],
      },
      { match: /sys_city_technic/i, rows: [{ v: 10 }] },
      NO(/.*/),
    ]);
    const res = (await cmd.getStats(ctx, [2])) as unknown[];
    // 1000 * (10*0.05+1) = 1500, minus hero_fee 50 → 1450
    expect(res[2]).toMatchObject({ cid: '(355,209)', gold_add: 1450 });
  });

  it('hero stats: computed attributes and the state name from the heroState table', async () => {
    const { cmd } = build([
      {
        match: /from sys_city_hero h/i,
        rows: [
          {
            cid: 209355,
            name: '长乐宫',
            hero: '君主',
            level: 10,
            command: 60,
            affairs: 70,
            bravery: 80,
            wisdom: 90,
            loyalty: 100,
            state: 2,
            herotype: 1000,
          },
        ],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getStats(ctx, [3])) as unknown[];
    expect(res[2]).toMatchObject({ cid: '(355,209)', hero: '君主', state: '出征' });
  });

  it('army stats: per-soldier keys, 万 for counts over 100000', async () => {
    const { cmd } = build([
      {
        match: /group_concat\(s\.sid\) as sids/i,
        rows: [{ cid: 209355, name: '长乐宫', sids: '1,3', counts: '500,200000' }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getStats(ctx, [4])) as unknown[];
    expect(res[2]).toMatchObject({
      cid: '(355,209)',
      name: '长乐宫',
      minfuCount: 500,
      chihouCount: '20万',
      'group_concat(s.sid)': '1,3',
      'group_concat(s.count)': '500,200000',
    });
  });

  it('defence stats: the free wall area subtracts the built defences', async () => {
    const { cmd } = build([
      {
        match: /group_concat\(s\.did\) as dids/i,
        rows: [{ cid: 209355, name: '长乐宫', dids: '1,2', counts: '10,20', level: 15 }],
      },
      NO(/.*/),
    ]);
    const res = (await cmd.getStats(ctx, [5])) as unknown[];
    // area = 15*10000 - (1*10 + 2*20) = 149950
    expect(res[2]).toMatchObject({
      cid: '(355,209)',
      xianjingCount: 10,
      jumaCount: 20,
      area: 149950,
      'group_concat(s.did)': '1,2',
      'group_concat(s.count)': '10,20',
      level: 15,
    });
  });
});
