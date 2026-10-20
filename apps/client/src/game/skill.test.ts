import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { NO_SKILL, parseHeroSkill, parseSkillBooks, skillImage, skillTip } from './skill';

beforeAll(() => {
  setStrings({ Hero_Skilltip_1: '级', Hero_Skilltip_2: '技能等级', Hero_Skilltip_3: '技能描述' });
});

describe('skillImage', () => {
  it('names the picture after the skill and level', () => {
    expect(skillImage('4', 2)).toBe('images/heroskill/skill_4_2.png');
  });
});

describe('skillTip', () => {
  it('appends % to a percentage bonus', () => {
    expect(
      skillTip({
        name: '锐不可当',
        level: '3',
        description: '攻击增加',
        attr: '6',
        attr_type: '1',
      }),
    ).toEqual({ title: '锐不可当', text: '技能等级：3级\n技能描述：攻击增加6%' });
  });

  it('leaves a flat bonus bare', () => {
    expect(skillTip({ name: 'a', level: 1, description: 'b', attr: 5, attr_type: 0 }).text).toBe(
      '技能等级：1级\n技能描述：b5',
    );
  });
});

describe('parseSkillBooks', () => {
  it('reads the shelf rows', () => {
    const [book] = parseSkillBooks([{ xid: '7', bid: '9', level: '2', id: '9', name: 'x' }]);
    expect(book).toMatchObject({
      xid: 7,
      bid: 9,
      level: 2,
      image: 'images/heroskill/skill_9_2.png',
    });
  });

  it('takes anything else as an empty shelf', () => {
    expect(parseSkillBooks(null)).toEqual([]);
  });
});

describe('parseHeroSkill', () => {
  const row = { skill: '4', name: '锐不可当', description: 'd', level: '2' };

  it('has no skill on 0', () => {
    expect(parseHeroSkill([0])).toBe(NO_SKILL);
  });

  it('reads a learnt skill without a book', () => {
    expect(parseHeroSkill([1, [row], 0])).toEqual({
      skillId: 4,
      name: '锐不可当',
      description: 'd',
      bookId: 0,
      worn: null,
    });
  });

  it('keeps the worn book', () => {
    const state = parseHeroSkill([1, [row], '12', 0]);
    expect(state.bookId).toBe(12);
    expect(state.worn).toBe(row);
  });
});
