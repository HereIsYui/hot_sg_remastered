import { describe, expect, it } from 'vitest';
import {
  beginExprArgs,
  exprDescription,
  exprMoneyCost,
  finishCommonExprArgs,
  parseExprHeros,
  parseExprType,
  startableHeros,
  type ExprHero,
  type ExprType,
} from './heroExpr';

const xiushen: ExprType = parseExprType({
  type: '1',
  name: '修身养性',
  intro: '闭门修炼，每小时消耗黄金 0，获得经验 0。',
  hour_expr: '600',
  hour_gold: '10',
  hour_money: '0',
  min_hour: '1',
  max_hour: '8',
  min_carraymoney: '0',
  max_carraymoney: '100',
});

describe('parseExprHeros', () => {
  it('drops the 君主将 and computes elapsed / remaining time', () => {
    const now = 1000;
    const reply = [
      String(now),
      [
        {
          hid: '1',
          cid: '9',
          heroname: '甲',
          state: '10',
          herotype: '0',
          hero_health: '0',
          level: '5',
          exprname: '修身养性',
          starttime: '400',
          endtime: '1600',
        },
        {
          hid: '2',
          cid: '9',
          heroname: '君主',
          state: '0',
          herotype: '1000',
          hero_health: '0',
          level: '9',
          exprname: null,
          starttime: null,
          endtime: null,
        },
        {
          hid: '3',
          cid: '9',
          heroname: '乙',
          state: '0',
          herotype: '0',
          hero_health: '0',
          level: '3',
          exprname: null,
          starttime: null,
          endtime: null,
        },
      ],
      [
        {
          type: '1',
          name: '修身养性',
          intro: '',
          hour_expr: '600',
          hour_gold: '10',
          hour_money: '0',
          min_hour: '1',
          max_hour: '8',
          min_carraymoney: '0',
          max_carraymoney: '100',
        },
      ],
    ];
    const { now: n, heros, types } = parseExprHeros(reply);
    expect(n).toBe(1000);
    expect(heros.map((h) => h.hid)).toEqual([1, 3]); // 君主将 excluded
    const running = heros[0]!;
    expect(running.leftTime).toBe(1600 - 1000); // 600 left
    expect(running.onTime).toBe(1000 - 400); // 600 elapsed
    const idle = heros[1]!;
    expect(idle.leftTime).toBe(0);
    expect(idle.onTime).toBe(0);
    expect(types[0]!.name).toBe('修身养性');
  });

  it('caps elapsed time at the end time once an expr has finished', () => {
    const { heros } = parseExprHeros([
      '2000',
      [
        {
          hid: '1',
          cid: '9',
          heroname: '甲',
          state: '10',
          herotype: '0',
          hero_health: '0',
          level: '5',
          exprname: '修身养性',
          starttime: '400',
          endtime: '1600',
        },
      ],
      [],
    ]);
    expect(heros[0]!.onTime).toBe(1600 - 400); // not 2000 - 400
    expect(heros[0]!.leftTime).toBe(-400);
  });
});

describe('startableHeros', () => {
  it('keeps only idle heroes', () => {
    const heros = [
      { hid: 1, state: 0 },
      { hid: 2, state: 10 },
      { hid: 3, state: 11 },
    ] as ExprHero[];
    expect(startableHeros(heros).map((h) => h.hid)).toEqual([1]);
  });
});

describe('exprDescription', () => {
  it('substitutes the level-scaled gold and experience', () => {
    expect(exprDescription(xiushen, 5)).toBe('闭门修炼，每小时消耗黄金50，获得经验3000。');
  });
});

describe('beginExprArgs', () => {
  it('builds the beginExprHero tuple', () => {
    const hero = { hid: 900101, cid: 209355 } as ExprHero;
    expect(beginExprArgs(hero, xiushen, 3, 20)).toEqual([900101, 209355, 1, 3, 20]);
  });
});

describe('exprMoneyCost', () => {
  it('sums hourly money and carried gold; 修身养性 is free of hourly cost', () => {
    expect(exprMoneyCost(xiushen, 3, 0)).toBe(0);
    expect(exprMoneyCost(xiushen, 3, 50)).toBe(50);
    const chuang = { ...xiushen, hour_money: 100 };
    expect(exprMoneyCost(chuang, 3, 50)).toBe(350);
  });
});

describe('finishCommonExprArgs', () => {
  it('wraps the reward id', () => {
    expect(finishCommonExprArgs(42)).toEqual([42]);
  });
});
