import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { playerFace } from '../stores/user';
import { heroDetail, isHeroInCity, kingLevelColor, largessText, maxHeroLevel } from './hero';

beforeAll(() => {
  setStrings({
    Hero_HeroDetailDialogSrc_9: '－－ / －－',
    Hero_LargessDialog_8_1: '赏赐黄金需要',
    Hero_LargessDialog_9_1: '黄金，可提高将领1~20点忠诚度。',
    Hero_LargessDialog_14_1: '黄金已经无法打动该将领，你需要赏赐他更贵重的珍宝。',
    Hero_LargessDialog_15_1: '赏赐珍珠，可提高将领忠诚5。',
  });
});

const ctx = {
  upgradeExp: { 2: 100, 3: 400, 31: 30000 },
  totalExp: { 1: 0, 2: 100, 30: 800000 },
  lordSex: 1,
  lordFace: 2,
  kingLevel: 3,
  now: 1000,
};

const hero = {
  hid: '90001',
  name: '甲乙',
  level: '30',
  exp: '815000',
  herotype: '0',
  npcid: '0',
  sex: '1',
  face: '10',
  state: '0',
  hero_health: '0',
  command_base: '20',
  affairs_base: '40',
  bravery_base: '95',
  wisdom_base: '50',
  affairs_add: '5',
  bravery_add: '3',
  wisdom_add: '2',
  command_add_on: '4',
  affairs_add_on: '1',
  bravery_add_on: '2',
  wisdom_add_on: '3',
  attack_add_on: '7',
  defence_add_on: '8',
  speed_add_on: '6',
  force: '90',
  force_max: '130',
  energy: '80',
  energy_max: '120',
  loyalty: '70',
};

describe('heroDetail', () => {
  it('derives the shown attributes, experience, pay and potential', () => {
    const d = heroDetail(hero, ctx);
    expect(d.image).toBe('images/hero/hero_boy_10.jpg');
    expect(d.expText).toBe('15000/30000');
    expect(d.goldNeed).toBe(30 * 20 + 8 * 50);
    expect(d.pointleft).toBe(20);
    expect(d.commandText).toBe('54');
    expect(d.braveryText).toBe('100');
    expect(d.attackText).toBe('1007');
    expect(d.defenceText).toBe('558');
    expect(d.forceText).toBe('90/130');
  });

  it('counts unsaved points and active buffers', () => {
    const d = heroDetail({ ...hero, buf1: '2000', buf3: '999' }, ctx, {
      affairs: 1,
      bravery: 2,
      wisdom: 0,
    });
    expect(d.pointleft).toBe(17);
    expect(d.affairsText).toBe('47');
    expect(d.commandText).toBe(String(Math.floor(50 * 1.5) + 4));
    expect(d.braveryText).toBe('102');
  });

  it('gives the lord three points a level, his portrait and colour', () => {
    const lord = { ...hero, herotype: '1000', level: '2', exp: '100', kingLevel: '8' };
    const d = heroDetail({ ...lord, affairs_add: '1', bravery_add: '0', wisdom_add: '0' }, ctx);
    expect(d.king).toBe(true);
    expect(d.pointleft).toBe(3 - 1 + 50);
    expect(d.image).toBe(playerFace(1, 2));
    expect(d.nameColor).toBe(kingLevelColor(8));
  });

  it('shows no experience goal at the top level', () => {
    expect(heroDetail({ ...hero, level: '120' }, ctx).expText).toBe('－－ / －－');
    expect(maxHeroLevel(36, 0, 0)).toBe(125);
    expect(maxHeroLevel(0, 1000, 10)).toBe(125);
  });
});

describe('hero helpers', () => {
  it('knows which states are in the city', () => {
    expect([0, 1, 4, 5, 6, 7, 8, 9].map(isHeroInCity)).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it('describes the rewards', () => {
    expect(largessText(0, 600, 70)).toBe('赏赐黄金需要3000黄金，可提高将领1~20点忠诚度。');
    expect(largessText(0, 7000, 70)).toBe('黄金已经无法打动该将领，你需要赏赐他更贵重的珍宝。');
    expect(largessText(1, 600, 70)).toBe('赏赐珍珠，可提高将领忠诚5。');
  });
});
