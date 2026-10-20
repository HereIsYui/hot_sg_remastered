import { i18n } from '../i18n';
import type { GoodsTip } from '../ui/tooltip';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** `MySkillDialog.makeSkillImageName` */
export function skillImage(id: unknown, level: unknown): string {
  return `images/heroskill/skill_${int(id)}_${int(level)}.png`;
}

/** `HeroSkillTooltip.createTooltip`: the skill's name over its level and effect. */
export function skillTip(row: Row): GoodsTip {
  const value = str(row.attr) + (int(row.attr_type) === 1 ? '%' : '');
  return {
    title: str(row.name),
    text:
      `${i18n('Hero_Skilltip_2')}：${str(row.level)}${i18n('Hero_Skilltip_1')}\n` +
      `${i18n('Hero_Skilltip_3')}：${str(row.description)}${value}`,
  };
}

/** A book on the shelf (`MySkillDialog.onLoadUserBooks`): `xid` is the user's book. */
export interface SkillBook {
  xid: number;
  bid: number;
  level: number;
  image: string;
  row: Row;
}

/** `MySkillDialog.onLoadUserBooks`: `loadUserValidSkillBook` rows. */
export function parseSkillBooks(rows: unknown): SkillBook[] {
  return (Array.isArray(rows) ? (rows as Row[]) : []).map((row) => ({
    xid: int(row.xid),
    bid: int(row.bid),
    level: int(row.level),
    image: skillImage(row.bid, row.level),
    row,
  }));
}

/** What `getHeroSkill` says of a hero: its skill and the book worn for it. */
export interface HeroSkillState {
  skillId: number;
  name: string;
  description: string;
  /** `mBookNum`: the worn book's id, 0 without one. */
  bookId: number;
  /** The worn book shown in the skill slot. */
  worn: Row | null;
}

export const NO_SKILL: HeroSkillState = {
  skillId: 0,
  name: '',
  description: '',
  bookId: 0,
  worn: null,
};

/** `HeroDetailDialog.onCommand("getHeroSkill")` after the hid: `[1, rows, bookId?, 0]` or `[0]`. */
export function parseHeroSkill(rest: unknown[]): HeroSkillState {
  if (int(rest[0]) !== 1) return NO_SKILL;
  const rows = Array.isArray(rest[1]) ? (rest[1] as Row[]) : [];
  const skill = rows[0] ?? {};
  const bookId = int(rest[2]);
  return {
    skillId: int(skill.skill),
    name: str(skill.name),
    description: str(skill.description),
    bookId,
    worn: bookId !== 0 ? skill : null,
  };
}
