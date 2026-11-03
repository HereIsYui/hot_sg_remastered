import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { FakeDb, type Respond } from '../hero/fake-db.testutil';
import {
  applyBattlefieldWinPoint,
  battleid2cid,
  checkBattleResult,
  createSoldier,
  resetBattleFieldUid,
} from './battle-field-uid';

const NO = (match: RegExp): Respond => ({ match, rows: [] });

/** resetBattleFieldUid's {db, query} deps against a FakeDb. */
function fdeps(db: FakeDb) {
  return {
    db: db.scope.db,
    query: async (q: ReturnType<typeof sql<Record<string, unknown>>>) =>
      (await q.execute(db.scope.db)).rows,
  };
}

/** The sys_battle_city row the stronghold starts with (黄巾之乱 虎牢关-style row). */
const CITY_ROW = { uid: 0, unionid: 2 };

function army(rows: Record<string, unknown>[]): Respond[] {
  return [
    {
      match:
        /select \* from sys_troops where cid = \?\s*and \(\(state = 4 or state = 3\) or targetcid = \?\)/i,
      rows,
    },
    { match: /select uid, unionid from sys_battle_city where cid = \?/i, rows: [CITY_ROW] },
    NO(/.*/),
  ];
}

describe('resetBattleFieldUid 四态', () => {
  it('状态 0 — 没有据点行：返回全 0 结果，不写库', async () => {
    const db = new FakeDb([
      {
        match: /select \* from sys_troops where cid = \?/i,
        rows: [{ id: 1, uid: 1001, battleunionid: 1, state: 4 }],
      },
      NO(/select uid, unionid from sys_battle_city/i),
      NO(/.*/),
    ]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    expect(r).toEqual({ oriuid: 0, oriunionid: 0, uid: 0, unionid: 0 });
    expect(db.executed.some((e) => /update sys_battle_city/i.test(e.sql))).toBe(false);
  });

  it('状态 1 — 空白据点：uid=-1 / unionid=-1 / hasuser=0', async () => {
    const db = new FakeDb([...army([]), NO(/.*/)]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    expect(r).toMatchObject({ oriuid: 0, oriunionid: 2, uid: -1, unionid: -1 });
    const upd = db.executed.find((e) => /update sys_battle_city/i.test(e.sql))!;
    expect(upd.sql).toMatch(/set uid = -1, unionid = -1, hasuser = 0/i);
    expect(upd.parameters[0]).toBe(630367);
  });

  it('状态 2 — 争夺中（两阵营混驻）：uid=0 / unionid=0，并按原样 return 0', async () => {
    const db = new FakeDb([
      ...army([
        { id: 1, uid: 1001, battleunionid: 1, state: 4 },
        { id: 2, uid: 1002, battleunionid: 2, state: 4 },
      ]),
      NO(/.*/),
    ]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    expect(r).toBe(0); // the literal `return 0;`
    const upd = db.executed.find((e) => /update sys_battle_city/i.test(e.sql))!;
    expect(upd.sql).toMatch(/set uid = 0, unionid = 0 where cid = \?/i);
    // 争夺分支不写 hasuser
    expect(upd.sql).not.toMatch(/hasuser/i);
  });

  it('状态 3 — 同阵营同人：uid 保留，ownerunionid/unionid 同写，hasuser=1', async () => {
    const db = new FakeDb([
      ...army([
        { id: 1, uid: 1001, battleunionid: 1, state: 4 },
        { id: 2, uid: 1001, battleunionid: 1, state: 4 },
      ]),
      NO(/.*/),
    ]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    expect(r).toMatchObject({ uid: 1001, unionid: 1 });
    const upd = db.executed.find((e) => /update sys_battle_city/i.test(e.sql))!;
    expect(upd.sql).toMatch(
      /set uid = \?,\s*ownerunionid = \?,\s*unionid = \?,\s*hasuser = \? where cid = \?/i,
    );
    expect(upd.parameters).toEqual([1001, 1, 1, 1, 630367]);
  });

  it('状态 3 变体 — 同阵营同人但只有 NPC（uid=0）：hasuser=0', async () => {
    const db = new FakeDb([...army([{ id: 1, uid: 0, battleunionid: 2, state: 4 }]), NO(/.*/)]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    expect(r).toMatchObject({ uid: 0, unionid: 2 });
    const upd = db.executed.find((e) => /update sys_battle_city/i.test(e.sql))!;
    expect(upd.parameters).toEqual([0, 2, 2, 0, 630367]);
  });

  it('状态 4 — 同阵营异人（都是玩家）：uid 归 0，unionid 保留', async () => {
    const db = new FakeDb([
      ...army([
        { id: 1, uid: 1001, battleunionid: 1, state: 4 },
        { id: 2, uid: 1002, battleunionid: 1, state: 3 },
      ]),
      NO(/.*/),
    ]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    expect(r).toMatchObject({ uid: 0, unionid: 1 });
    const upd = db.executed.find((e) => /update sys_battle_city/i.test(e.sql))!;
    expect(upd.sql).toMatch(/set uid = 0,\s*unionid = \?,\s*hasuser = \? where cid = \?/i);
    expect(upd.parameters).toEqual([1, 1, 630367]);
  });

  it('状态 4 变体 — 玩家 + 同阵营 NPC：算同人，uid 取最后一支部队的 0', async () => {
    const db = new FakeDb([
      ...army([
        { id: 1, uid: 1001, battleunionid: 1, state: 4 },
        { id: 2, uid: 0, battleunionid: 1, state: 4 },
      ]),
      NO(/.*/),
    ]);
    const r = await resetBattleFieldUid(fdeps(db), 630367);
    // sameUid stays true (NPC uid 0), but $uid ends as the LAST troop's 0 — 原样复刻.
    expect(r).toMatchObject({ uid: 0, unionid: 1 });
    const upd = db.executed.find((e) => /update sys_battle_city/i.test(e.sql))!;
    expect(upd.sql).toMatch(/ownerunionid/i);
    expect(upd.parameters).toEqual([0, 1, 1, 1, 630367]);
  });
});

describe('checkBattleResult / check1001', () => {
  it('非 1001 战场直接判 0', async () => {
    const db = new FakeDb([NO(/.*/)]);
    expect(await checkBattleResult(fdeps(db), 3001, 777)).toBe(0);
    expect(db.executed).toHaveLength(0);
  });

  it('1001：张角三兄弟（hid 1001/1002/1005）还在 → 2', async () => {
    const db = new FakeDb([
      {
        match:
          /select \* from sys_troops where uid = 0\s+and battlefieldid = \? and hid in \(1001, 1002, 1005\)/i,
        rows: [{ id: 9, hid: 1001 }],
      },
      NO(/.*/),
    ]);
    expect(await checkBattleResult(fdeps(db), 1001, 30)).toBe(2);
  });

  it('1001：三兄弟已清空 → 1', async () => {
    const db = new FakeDb([{ match: /hid in \(\?, \?, \?\)/i, rows: [] }, NO(/.*/)]);
    expect(await checkBattleResult(fdeps(db), 1001, 30)).toBe(1);
  });
});

describe('applyBattlefieldWinPoint（忠实死代码）', () => {
  it('reset 返回数组（正常归属）时不更新 winpoint —— PHP 数组 != 整数', async () => {
    const db = new FakeDb([...army([{ id: 1, uid: 1001, battleunionid: 1, state: 4 }]), NO(/.*/)]);
    await applyBattlefieldWinPoint(fdeps(db), 630367, 30, 1);
    expect(db.executed.some((e) => /update sys_battle_winpoint/i.test(e.sql))).toBe(false);
    // 只有 resetBattleFieldUid 自己的据点归属 UPDATE 跑了。
    expect(db.executed.some((e) => /update sys_battle_city/i.test(e.sql))).toBe(true);
  });

  it('reset 返回 0（争夺中）且 battleunionid 非零时同样不更新', async () => {
    const db = new FakeDb([
      ...army([
        { id: 1, uid: 1001, battleunionid: 1, state: 4 },
        { id: 2, uid: 1002, battleunionid: 2, state: 4 },
      ]),
      NO(/.*/),
    ]);
    await applyBattlefieldWinPoint(fdeps(db), 630367, 30, 1);
    expect(db.executed.some((e) => /update sys_battle_winpoint/i.test(e.sql))).toBe(false);
  });

  it('唯一的触发窗口：battleunionid=0 的部队撞上争夺分支（0==0），LEAST/GREATEST 原样生效', async () => {
    const db = new FakeDb([
      // (放在 army() 的兜底 NO 之前 —— FakeDb 按顺序取第一条命中规则)
      {
        match: /select winpoint, losepoint from sys_battle_city/i,
        rows: [{ winpoint: 5, losepoint: 3 }],
      },
      ...army([
        { id: 1, uid: 1001, battleunionid: 1, state: 4 },
        { id: 2, uid: 1002, battleunionid: 2, state: 4 },
      ]),
      NO(/.*/),
    ]);
    await applyBattlefieldWinPoint(fdeps(db), 630367, 30, 0);
    const ups = db.executed.filter((e) => /update sys_battle_winpoint/i.test(e.sql));
    expect(ups).toHaveLength(2);
    expect(ups[0]!.sql).toMatch(/point = LEAST\(10000, point \+ \?\)/i);
    expect(ups[0]!.parameters).toEqual([5, 30, 0]);
    expect(ups[1]!.sql).toMatch(/point = GREATEST\(0, point - \?\)/i);
    expect(ups[1]!.parameters).toEqual([3, 30, 3]); // $unionid==3 ? 4 : 3 → 3
  });
});

describe('battleid2cid / createSoldier', () => {
  it('battleid2cid: (battleid+600)*1000+xy', () => {
    expect(battleid2cid(30, 367)).toBe(630367);
  });

  it('createSoldier: 固定 rand 序列产出确定兵力，保留尾逗号', () => {
    // draws: 4, 3, 2 → shares 4/3/2 (total 10 → break)
    let i = 0;
    const seq = [4, 3, 2];
    const out = createSoldier(10000, '20,21,22', 3, () => seq[i++ % seq.length]!);
    // npcValue = 10000 * 2^3 = 80000；soldiervalue 表 20→127, 21→128, 22→263
    // shares: 20: ceil(32000/127)=252, 21: ceil(24000/128)=188, 22: ceil(16000/263)=61
    expect(out).toBe('3,20,252,21,188,22,61,');
  });

  it('createSoldier: 总量逼近 10 点后剩余 sid 全部落空（mod 基数只剩 1）', () => {
    let i = 0;
    const seq = [9, 9, 9]; // 18: 9%10=9 → totalRnd 9；19/20: 9%1=0 → 跳过
    const out = createSoldier(100, '18,19,20', 0, () => seq[i++ % seq.length]!);
    expect(out).toBe('1,18,4,'); // 18→26: ceil(100*9*0.1/26) = ceil(3.46) = 4
  });
});
