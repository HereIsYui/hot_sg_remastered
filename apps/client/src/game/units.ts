import { i18n } from '../i18n';
import { playerFace } from '../stores/user';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

export const HERO_TYPE_KING = 1000;

/** `BloodWar.HERO_STATE_ARRAY` (sys_city_hero.state). */
const HERO_STATES = [
  '_BloodWarSrc_1',
  '_BloodWarSrc_2',
  '_BloodWarSrc_3',
  '_BloodWarSrc_4',
  '_BloodWarSrc_5',
  '_BloodWarSrc_6',
  '_BloodWarSrc_7',
  '_BloodWarSrc_8',
  '_BloodWarSrc_9',
  '_BloodWarSrc_23',
  '_BloodWarSrc_24',
  '_BloodWarSrc_25',
];
/** `BloodWar.HERO_HEALTH_ARRAY`. */
const HERO_HEALTH = ['_HeroHealth_1', '_HeroHealth_3', '_HeroHealth_2'];
const HERO_SEX = ['girl', 'boy'];

/** `statename` of `onLoadHeroList`: an injury overrides the duty. */
export function heroStateName(h: Row): string {
  const health = int(h.hero_health);
  const key = health !== 0 ? HERO_HEALTH[health] : HERO_STATES[int(h.state)];
  return key ? i18n(key) : '';
}

/** `InfoHeroItem.init`: the king shows the lord's portrait. */
export function heroFace(h: Row, lordSex: number, lordFace: number): string {
  if (int(h.herotype) === HERO_TYPE_KING) return playerFace(lordSex, lordFace);
  return `images/herox/hero_${HERO_SEX[int(h.sex)] ?? HERO_SEX[0]}_${str(h.face)}.jpg`;
}

const sum = (h: Row, attr: string) =>
  int(h[`${attr}_base`]) + int(h[`${attr}_add`]) + int(h[`${attr}_add_on`]);

/** `InfoHeroItem.createHeroTip` (title, then the description). */
export function heroTip(h: Row): string {
  const king = int(h.herotype) === HERO_TYPE_KING;
  const command = int(h.level) + int(h.command_base) + int(h.command_add_on);
  return (
    `${str(h.name)}\n ` +
    `${i18n('Hero_Info_1_1')}${str(h.level)}` +
    `${i18n('Hero_Info_8_1')}${command}` +
    `${i18n('Hero_Info_5_1')}${sum(h, 'affairs')}` +
    `${i18n('Hero_Info_6_1')}${sum(h, 'bravery')}` +
    `${i18n('Hero_Info_7_1')}${sum(h, 'wisdom')}` +
    `${i18n('Hero_Info_2_1')}${str(h.force)}` +
    `${i18n('Hero_Info_3_1')}${str(h.energy)}` +
    `${i18n('Hero_Info_4_1')}${king ? '--' : str(h.loyalty)}` +
    `${i18n('Hero_Info_9_1')}${str(h.speed_add_on)}`
  );
}

/** `InfoSoldierItem.createSoldierTip` (cfg_soldier row). */
export function soldierTip(s: Row): string {
  const fields = ['hp', 'ap', 'dp', 'range', 'speed', 'carry', 'food_use', 'people_need'];
  return (
    `${str(s.name)}\n${str(s.description)}\n` +
    fields.map((f, i) => `${i18n(`Ground_CampaignSoldierItem_${i + 1}_1`)}${str(s[f])}`).join('')
  );
}

/** `InfoDefenceItem.createDefenceTip` (cfg_defence row). */
export function defenceTip(d: Row): string {
  const fields = ['hp', 'ap', 'dp', 'range', 'area_need'];
  return (
    `${str(d.name)}\n${str(d.description)}\n` +
    fields.map((f, i) => `${i18n(`Wall_WallDefenceItemSrc_${18 + i}`)}${str(d[f])}`).join('')
  );
}
