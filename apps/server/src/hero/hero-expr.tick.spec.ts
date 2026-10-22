import { beforeEach, describe, expect, it } from 'vitest';
import { LangService } from '../common/lang.service';
import { GoodsRules } from '../core/goods-rules.service';
import { RandomService } from '../core/random.service';
import { ReportService } from '../core/report.service';
import { HeroExprTick } from './hero-expr.tick';
import { FakeDb, type Respond } from './fake-db.testutil';

/** A RandomService that yields queued values, so every roll in the tick is deterministic. */
class ScriptedRandom extends RandomService {
  private queue: number[] = [];
  push(...values: number[]): this {
    this.queue.push(...values);
    return this;
  }
  override mtRand(): number {
    return this.queue.shift() ?? 0;
  }
  override randRange(): number {
    return this.queue.shift() ?? 0;
  }
  override rand(): number {
    return this.queue.shift() ?? 0;
  }
}

const lang = new LangService({
  heroExpr: {
    type_name: '禀明主公，末将%s完毕',
    experience: '末将%s%s%s小时获得经验%s',
    nothings: '什么都没有',
  },
  report: { moranchtitle: '【%s】', title_body: '%s x%s', title_end: '==' },
});

function build(rules: Respond[], random: ScriptedRandom) {
  const db = new FakeDb(rules);
  const goods = { addGoods: async () => {} } as unknown as GoodsRules;
  const reports: { title: number; content: string }[] = [];
  const report = {
    sendReport: async (_u: number, title: number, _o: number, _h: number, content: string) => {
      reports.push({ title, content });
    },
  } as unknown as ReportService;
  const tick = new HeroExprTick(db.scope, lang, goods, report, random);
  return { tick, db, reports };
}

const NOW = /unix_timestamp/i;
const no = (match: RegExp): Respond => ({ match, rows: [] });

describe('HeroExprTick.checkHeroExpr', () => {
  let random: ScriptedRandom;
  beforeEach(() => {
    random = new ScriptedRandom();
  });

  it('finishes a normal 修身养性 expr with base experience and no 奇遇', async () => {
    // getHeroBaseExp(type=1, level=2, hours=3) = 3*2*600 + mt_rand(1,1000)
    random.push(500); // base exp bonus
    random.push(100); // baseEvents chance roll -> no event (>= threshold)
    random.push(100); // heroFightEvents 30% roll -> >30 no event
    random.push(100, 1); // commonExprEvents rolls -> no event
    const rules: Respond[] = [
      {
        match: /from sys_hero_expr\s+where endtime/i,
        rows: [{ id: 7, uid: 1001, cid: 209355, hid: 80213, type: 1, hours: 3, state: 0 }],
      },
      { match: /from sys_king_expr/i, rows: [] },
      { match: /from sys_city_hero where hid/i, rows: [{ level: 2, name: '张三', loyalty: 50 }] },
      { match: /from cfg_hero_expr_types[\s\S]*type =/i, rows: [{ name: '修身养性' }] },
      no(/.*/),
    ];
    const { tick, db, reports } = build(rules, random);
    await tick.checkHeroExpr();

    // base exp 3*2*600 + 500 = 4100 written to the hero
    const expUpdate = db.executed.find((q) => /set exp = exp \+/i.test(q.sql));
    expect(expUpdate?.parameters).toContain(4100);
    // the expr row is deleted and the hero freed
    expect(db.executed.some((q) => /delete from sys_hero_expr where id/i.test(q.sql))).toBe(true);
    expect(db.executed.some((q) => /set state = 0 where hid/i.test(q.sql))).toBe(true);
    // one 历练结束 report (title 46)
    expect(reports).toHaveLength(1);
    expect(reports[0]!.title).toBe(46);
    expect(reports[0]!.content).toContain('修身养性');
  });

  it('refunds carried gold and adds the cancelled-expr experience bonus for state 1', async () => {
    random.push(2); // randRange(hours=2, 2*hours) -> 2
    const rules: Respond[] = [
      {
        match: /from sys_hero_expr\s+where endtime/i,
        rows: [
          {
            id: 9,
            uid: 1001,
            cid: 209355,
            hid: 80213,
            type: 1,
            hours: 2,
            state: 1,
            carrymoney: 30,
            exp_add: 100,
          },
        ],
      },
      { match: /from sys_king_expr/i, rows: [] },
      { match: NOW, rows: [{ 'unix_timestamp()': 1_000_000 }] },
      no(/.*/),
    ];
    const { tick, db, reports } = build(rules, random);
    await tick.checkHeroExpr();

    // carried 30 元宝 refunded (reason 121)
    const money = db.executed.find((q) => /insert into log_money/i.test(q.sql));
    expect(money?.parameters).toEqual(expect.arrayContaining([1001, 30, 121]));
    // exp_add 100 + 10*randRange(2,4)=2 -> 120
    const expUpdate = db.executed.find((q) => /set exp = exp \+ /i.test(q.sql));
    expect(expUpdate?.parameters).toContain(120);
    // a cancelled expr produces no report
    expect(reports).toHaveLength(0);
  });

  it('getHeroBaseExp follows the per-type formula', () => {
    const r = new ScriptedRandom().push(0, 0);
    const { tick } = build([no(/.*/)], r);
    const base = (
      tick as unknown as { getHeroBaseExp(t: number, l: number, h: number): number }
    ).getHeroBaseExp.bind(tick);
    expect(base(1, 5, 2)).toBe(2 * 5 * 600); // + mt_rand(1,1000)=0 here
    expect(base(2, 5, 2)).toBe(2 * 5 * 1200);
    expect(base(9, 5, 2)).toBe(0);
  });

  it('getRandWin clamps the rate by expr type before rolling', () => {
    const r = new ScriptedRandom();
    const { tick } = build([no(/.*/)], r);
    const win = (
      tick as unknown as { getRandWin(rate: number, type: number): number }
    ).getRandWin.bind(tick);
    // type 1 clamps to [25,75]; a roll of 24 (<25) wins, 80 (>=75) loses
    r.push(24);
    expect(win(999, 1)).toBe(1); // clamped to 75, roll 24 < 75
    r.push(80);
    expect(win(999, 1)).toBe(0); // clamped to 75, roll 80 !< 75
    // type 2 clamps to [40,80]
    r.push(39);
    expect(win(0, 2)).toBe(1); // clamped to 40, roll 39 < 40
  });

  it('pickReward draws by cumulative rate weight', async () => {
    const r = new ScriptedRandom().push(7); // mt_rand(1, sumRate)
    const { tick } = build(
      [
        {
          match: /select \* from cfg_hero_expr_reward/i,
          rows: [
            { id: 1, rate: 5, sort: 1 },
            { id: 2, rate: 5, sort: 2 },
          ],
        },
        { match: /select sum\(rate\)/i, rows: [{ 'sum(rate)': 10 }] },
      ],
      r,
    );
    const pick = (
      tick as unknown as {
        pickReward(a: unknown, b: unknown): Promise<Record<string, unknown> | null>;
      }
    ).pickReward.bind(tick);
    // roll 7: 7-5=2 (>0) skips id 1, 2-5=-3 (<=0) picks id 2
    const reward = await pick(
      // these are kysely RawBuilders in production; the fake matches on compiled SQL only
      (await import('kysely')).sql`select * from cfg_hero_expr_reward where type = 4`,
      (await import('kysely')).sql`select sum(rate) from cfg_hero_expr_reward where type = 4`,
    );
    expect(reward?.id).toBe(2);
  });
});
