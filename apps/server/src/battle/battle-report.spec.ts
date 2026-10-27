import { describe, expect, it } from 'vitest';
import { getContentBattleHero, getContentHero, type BattleResultDeps } from './battle-result';

function deps(hero?: Record<string, unknown>): BattleResultDeps {
  return {
    query: async () => (hero ? [hero] : []),
    lang: {
      report: (key: string) => (key === 'empty' ? 'empty' : `${key}:%s/%s/%s/%s`),
    },
  } as unknown as BattleResultDeps;
}

describe('battle report hero cards', () => {
  it('formats hero and heroname cards with sex, face, name and level', async () => {
    const hero = { name: '测试将', face: 2, sex: 1, level: 12 };
    await expect(getContentHero(deps(hero), 7)).resolves.toBe('heroname:boy_2/测试将/测试将/12');
    await expect(getContentBattleHero(deps(hero), 7)).resolves.toBe('hero:boy_2/测试将/测试将/12');
  });

  it('uses the empty text when the hero no longer exists', async () => {
    await expect(getContentHero(deps(), 7)).resolves.toBe('empty');
    await expect(getContentBattleHero(deps(), 7)).resolves.toBe('empty');
  });
});
