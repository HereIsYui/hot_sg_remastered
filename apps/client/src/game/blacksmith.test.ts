import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  BLACKSMITH_TABS,
  PORTED_TABS,
  canMergeBook,
  couldSynthStuff,
  dismantleNeedCount,
  parseBestQuality,
  parseEmbedHoles,
  parseEmbedPearls,
  parseStuffRecipe,
  strongBlockReason,
  strongResultText,
} from './blacksmith';

beforeAll(() => {
  setStrings({
    BlackSmith_StrongSucc: '强化成功',
    BlackSmith_StrongFailure1: '强化失败，装备强化等级归零',
    BlackSmith_StrongFailure2: '强化失败，装备强化等级降一级',
    BlackSmith_StrongFailure3: '强化失败，装备无损失',
  });
});

describe('parseEmbedHoles', () => {
  it('maps a hole string to codes, defaulting an empty piece to all-no-hole', () => {
    expect(parseEmbedHoles('0,1,2,3,4')).toEqual([0, 1, 2, 3, 4]);
    expect(parseEmbedHoles('')).toEqual([3, 3, 3, 3, 3]);
    expect(parseEmbedHoles(null)).toEqual([3, 3, 3, 3, 3]);
  });
});

describe('parseEmbedPearls', () => {
  it('pads to five slots and zero-fills empty holes', () => {
    expect(parseEmbedPearls('325,0,0')).toEqual([325, 0, 0, 0, 0]);
    expect(parseEmbedPearls('')).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('dismantleNeedCount', () => {
  it('reads the 化石粉 cost by pearl tier', () => {
    expect(dismantleNeedCount(300)).toBe(1); // 1级
    expect(dismantleNeedCount(309)).toBe(60); // 10级
    expect(dismantleNeedCount(17500)).toBe(120); // 11级
    expect(dismantleNeedCount(17539)).toBe(2000); // 15级
    expect(dismantleNeedCount(10830)).toBe(15); // 聚魂珠 1级
    expect(dismantleNeedCount(999)).toBe(1); // out of range
  });
});

describe('strongBlockReason', () => {
  it('refuses with no armor selected', () => {
    expect(strongBlockReason(null, 1, 1)).toBe('BlackSmith_NoArmor');
    expect(strongBlockReason({ sid: 0 }, 1, 1)).toBe('BlackSmith_NoArmor');
  });
  it('refuses a maxed piece', () => {
    expect(strongBlockReason({ sid: 1, strong_level: 15 }, 1, 1)).toBe('BlackSmith_Remind_3');
  });
  it('needs a 强化宝珠 below level 10 and a 高级强化宝珠 at 10+', () => {
    expect(strongBlockReason({ sid: 1, strong_level: 5 }, 0, 9)).toBe('BlackSmith_NoStrongPearl');
    expect(strongBlockReason({ sid: 1, strong_level: 11 }, 9, 0)).toBe(
      'BlackSmith_NoHighStrongPearl',
    );
  });
  it('needs 熔炼 3 for a 蓝装 past level 10', () => {
    expect(strongBlockReason({ sid: 1, strong_level: 10, type: 4, combine_level: 2 }, 1, 1)).toBe(
      'BlackSmith_BlueStrongLimit',
    );
    expect(
      strongBlockReason({ sid: 1, strong_level: 10, type: 4, combine_level: 3 }, 1, 1),
    ).toBeNull();
  });
  it('allows an ordinary strengthen', () => {
    expect(
      strongBlockReason({ sid: 1, strong_level: 3, type: 5, combine_level: 0 }, 1, 1),
    ).toBeNull();
  });
});

describe('couldSynthStuff', () => {
  it('needs the lower tier for a non-1 pearl, free for a tier-boundary one', () => {
    expect(couldSynthStuff(302, 0)).toBe(false);
    expect(couldSynthStuff(302, 5)).toBe(true);
    expect(couldSynthStuff(310, 0)).toBe(true); // 310 % 10 === 0
  });
});

describe('parseStuffRecipe', () => {
  it('reads a flat gid,count list into a map', () => {
    const dict = parseStuffRecipe('30,1,35,2');
    expect(dict.get(30)).toBe(1);
    expect(dict.get(35)).toBe(2);
    expect(dict.size).toBe(2);
  });
});

describe('parseBestQuality', () => {
  it('formats the 极品 tooltip, empty when none', () => {
    expect(parseBestQuality('5,1,12,祝融,攻击')).toBe('祝融攻击+12%');
    expect(parseBestQuality('')).toBe('');
  });
});

describe('strongResultText', () => {
  it('renders success with an optional event bonus and each failure branch', () => {
    expect(strongResultText(0, '')).toBe('强化成功');
    expect(strongResultText(0, '，恭喜获得奖励')).toBe('强化成功，恭喜获得奖励');
    expect(strongResultText(1, '')).toBe('强化失败，装备强化等级归零');
    expect(strongResultText(2, '')).toBe('强化失败，装备强化等级降一级');
    expect(strongResultText(3, '')).toBe('强化失败，装备无损失');
  });
});

describe('canMergeBook', () => {
  it('merges three same-level books below level 10', () => {
    expect(canMergeBook(1, 3)).toBe(true);
    expect(canMergeBook(9, 3)).toBe(true);
    expect(canMergeBook(10, 3)).toBe(false);
    expect(canMergeBook(1, 2)).toBe(false);
  });
});

describe('tab metadata', () => {
  it('ports 强化/镶嵌/合成/技能书 and leaves 洗练/熔炼/装备升级 out', () => {
    expect(PORTED_TABS.has(BLACKSMITH_TABS.Strong)).toBe(true);
    expect(PORTED_TABS.has(BLACKSMITH_TABS.SkillBook)).toBe(true);
    expect(PORTED_TABS.has(BLACKSMITH_TABS.Xilian)).toBe(false);
    expect(PORTED_TABS.has(BLACKSMITH_TABS.Fusion)).toBe(false);
    expect(PORTED_TABS.has(BLACKSMITH_TABS.UpgradeArmor)).toBe(false);
  });
});
