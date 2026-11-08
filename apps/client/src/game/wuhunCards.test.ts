import { describe, expect, it } from 'vitest';
import {
  availableCards,
  wuhunUseArgs,
  multiUseCardArgs,
  mixCardArgs,
  correctAnswer,
  isFragment,
  isPortrait,
  isWuhun,
  parseQuestion,
  wuhunHeroes,
} from './wuhunCards';
import { parseUserGoods } from './goods';

const cards = parseUserGoods([
  [
    { gid: 220001, count: 2, group: 6 },
    { gid: 220002, count: 1, group: 6 },
    { gid: 230001, count: 5, group: 6 },
    { gid: 210001, count: 1, group: 6 },
  ],
  [],
]).goods;
describe('W5 legacy item boundaries', () => {
  it('keeps portraits, fragments and usable souls separate at the exact boundaries', () => {
    expect([20000, 20001, 21026, 21027].map(isPortrait)).toEqual([false, true, true, false]);
    expect([100000, 100001, 109999, 110000].map(isFragment)).toEqual([false, true, true, false]);
    expect([110000, 110001, 159999, 160000].map(isWuhun)).toEqual([false, true, true, false]);
  });
  it('reserves the main card and each material copy while allowing replacement of a slot', () => {
    const slots = [cards[0]!, cards[0]!, null];
    expect(availableCards(cards, slots, 2).map((c) => c.gid)).toEqual([220002]);
    expect(availableCards(cards, slots, 1).map((c) => c.gid)).toEqual([220001, 220002]);
    expect(availableCards(cards, slots, 0).map((c) => c.gid)).toEqual([220001, 220002, 230001]);
    expect(availableCards(cards, [null], 1)).toEqual([]);
    expect(cards[0]!.count).toBe(2);
  });
  it('offers only idle, healthy city heroes, accepting PHP numeric strings', () => {
    expect(
      wuhunHeroes([
        { hid: 1, state: '0', hero_health: '0' },
        { hid: 2, state: 1, hero_health: 0 },
        { hid: 3, state: 0, hero_health: 1 },
      ]).map((h) => h.hid),
    ).toEqual([1]);
  });
  it('parses kind-6 question payloads without changing the announcement and rejects no selection', () => {
    const question = parseQuestion({
      question: '题目',
      option1: '甲',
      option2: '乙',
      answer: '2',
      info: "公告 '原文'\n下一行",
    })!;
    expect(question.options).toEqual(['甲', '乙', '', '']);
    expect(question.info).toBe("公告 '原文'\n下一行");
    expect(correctAnswer(question, 0)).toBe(false);
    expect(correctAnswer(question, 1)).toBe(false);
    expect(correctAnswer(question, 2)).toBe(true);
    expect(parseQuestion(null)).toBeNull();
    expect(parseQuestion([])).toBeNull();
  });
});

describe('W5 PHP command arguments', () => {
  it('puts a fixed count before hid, including ids beyond the useGoods count limit', () => {
    expect(wuhunUseArgs(110123, 876543)).toEqual([110123, 1, 876543]);
  });
  it('leaves batch card count to the server rather than sending gid or count', () => {
    expect(multiUseCardArgs()).toEqual([]);
  });
  it('keeps the original first, omits holes and retains repeated material copies', () => {
    expect(mixCardArgs([cards[0]!, null, cards[1]!, null, cards[0]!])).toEqual([
      220001, 220002, 220001,
    ]);
    expect(mixCardArgs([cards[0]!, ...Array(6).fill(cards[1]!)])).toHaveLength(7);
    expect(mixCardArgs([null, cards[1]!, cards[0]!])).toBeNull();
    expect(mixCardArgs([cards[0]!, null])).toBeNull();
    expect(mixCardArgs([cards[0]!, ...Array(7).fill(cards[1]!)])).toBeNull();
  });
});
