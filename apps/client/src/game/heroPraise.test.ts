import { describe, expect, it } from 'vitest';
import {
  commonExprRewardId,
  parseHeroPraiseGoods,
  parseKingTactic,
  praiseConfirmationKey,
  praiseHeroArgs,
} from './heroPraise';

describe('hero praise protocol', () => {
  it('preserves the function-name prefix and the city/hero/gid order', () => {
    expect(praiseHeroArgs(200, 300, 26)).toEqual(['praiseHero', 200, 300, 26]);
  });
  it('keeps the original asymmetric conflict warnings', () => {
    expect(praiseConfirmationKey(160041)).toBe('Hero_PraiseDialog_Praise_hufu2');
    expect(praiseConfirmationKey(160042)).toBe('Hero_PraiseDialog_Praise_hufu1');
    expect(praiseConfirmationKey(160040)).toBeNull();
    expect(praiseConfirmationKey(10152)).toBeNull();
  });
  it('accepts string ids and ignores malformed catalog rows', () => {
    expect(
      parseHeroPraiseGoods([
        null,
        [],
        { gid: '26', name: '虎符', description: '说明' },
        { gid: 'bad' },
      ]),
    ).toEqual([{ gid: 26, name: '虎符', description: '说明' }]);
  });
});
describe('king tactic reply', () => {
  it('parses the goods, null inventory count, rank and outcome message', () => {
    expect(
      parseKingTactic([{ gid: '10961', name: '孙子兵法', count: null }, '3', '学习成功']),
    ).toMatchObject({
      count: 0,
      level: 3,
      message: '学习成功',
      book: { gid: 10961, name: '孙子兵法' },
    });
    expect(parseKingTactic(null)).toMatchObject({ count: 0, level: 0 });
  });
});
describe('public experience reward links', () => {
  it('accepts only positive safe integer reward ids', () => {
    expect(commonExprRewardId('42')).toBe(42);
    for (const bad of [
      'yes,42',
      'no,42',
      '42,1',
      '42bad',
      '-1',
      '0',
      '1.2',
      '',
      '9007199254740992',
    ])
      expect(commonExprRewardId(bad)).toBeNull();
  });
});
