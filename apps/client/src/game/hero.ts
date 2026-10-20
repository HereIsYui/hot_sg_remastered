import { i18n } from '../i18n';
import { playerFace } from '../stores/user';
import { HERO_TYPE_KING } from './units';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** `HeroDetailDialog.isBigHero`: famous heroes that reach level 125. */
const BIG_HEROES = new Set([
  36, 102, 107, 114, 118, 177, 186, 241, 255, 285, 320, 321, 340, 347, 357, 360, 362, 381, 382, 409,
  456, 484, 518, 541, 562, 580, 620, 677, 699, 725, 780, 801, 861, 870, 894,
]);

/** `mKingType` / `Utils.getNewKingName`: the lord's name colour by 君主 level. */
export function kingLevelColor(kingLevel: number): number {
  if (kingLevel <= 2) return 0xffffff;
  if (kingLevel <= 4) return 0x33a800;
  if (kingLevel <= 5) return 0x0090ff;
  if (kingLevel <= 7) return 0x9933ff;
  if (kingLevel <= 8) return 0xff9900;
  if (kingLevel <= 9) return 0xff0033;
  return 0xffcc00;
}

/** `HeroDetailDialog.isHeroInCity`: free, city chief, general or adviser (and states below 5). */
export function isHeroInCity(state: number): boolean {
  return state < 5 || state === 7 || state === 8;
}

/** `HeroDetailDialog.getMaxHeroLevel`: 125 for some famous heroes and a level 10 lord. */
export function maxHeroLevel(npcid: number, herotype: number, kingLevel: number): number {
  if (BIG_HEROES.has(npcid)) return 125;
  if (herotype === HERO_TYPE_KING && kingLevel === 10) return 125;
  return 120;
}

export interface HeroDetailContext {
  upgradeExp: Record<number, number>;
  totalExp: Record<number, number>;
  lordSex: number;
  lordFace: number;
  /** `infoPanel.mKingLevel`: the 君主 level. */
  kingLevel: number;
  /** Server time, for the buffers. */
  now: number;
}

/** Points added in the dialog and not saved yet. */
export interface PendingPoints {
  affairs: number;
  bravery: number;
  wisdom: number;
}

export const NO_POINTS: PendingPoints = { affairs: 0, bravery: 0, wisdom: 0 };

/** What `HeroDetailDialog.updateHero` / `regenAttribute` show of a hero. */
export interface HeroDetail {
  hid: number;
  name: string;
  level: number;
  herotype: number;
  npcid: number;
  state: number;
  king: boolean;
  famous: boolean;
  /** `isOk`: not badly injured. */
  healthy: boolean;
  image: string;
  nameColor: number;
  affairs: number;
  bravery: number;
  wisdom: number;
  pointleft: number;
  currentExp: number;
  upgradeExp: number;
  expText: string;
  goldNeed: number;
  loyalty: string;
  commandText: string;
  affairsText: string;
  braveryText: string;
  wisdomText: string;
  forceText: string;
  energyText: string;
  speedText: string;
  attackText: string;
  defenceText: string;
  /** `addExpBtn.enabled` before the lord's override. */
  canAddExp: boolean;
}

/** `updateHero` + `regenAttribute` for a hero row of the city's list. */
export function heroDetail(
  h: Row,
  ctx: HeroDetailContext,
  pending: PendingPoints = NO_POINTS,
): HeroDetail {
  const level = int(h.level);
  const herotype = int(h.herotype);
  const npcid = int(h.npcid);
  const king = herotype === HERO_TYPE_KING;
  const kingLevel = int(h.kingLevel);
  const affairs = int(h.affairs_base) + int(h.affairs_add) + pending.affairs;
  const bravery = int(h.bravery_base) + int(h.bravery_add) + pending.bravery;
  const wisdom = int(h.wisdom_base) + int(h.wisdom_add) + pending.wisdom;
  const goldNeed =
    level * 20 +
    (Math.max(int(h.affairs_base) + int(h.affairs_add) - 90, 0) +
      Math.max(int(h.bravery_base) + int(h.bravery_add) - 90, 0) +
      Math.max(int(h.wisdom_base) + int(h.wisdom_add) - 90, 0)) *
      50;

  const currentExp = int(h.exp) - (ctx.totalExp[level] ?? 0);
  let upgradeExp = ctx.upgradeExp[level + 1] ?? 0;
  let expText = `${currentExp}/${upgradeExp}`;
  if (level >= 120 && level >= maxHeroLevel(npcid, herotype, ctx.kingLevel)) {
    upgradeExp = 10000000000000;
    expText = i18n('Hero_HeroDetailDialogSrc_9');
  }

  const adds = int(h.affairs_add) + int(h.bravery_add) + int(h.wisdom_add);
  let pointleft = king ? (level - 1) * 3 - adds : level - adds;
  if (king && kingLevel >= 8) pointleft += 50;
  pointleft = Math.max(pointleft, 0) - pending.affairs - pending.bravery - pending.wisdom;

  const buffed = (value: number, buf: number, rate: number) =>
    int(h[`buf${buf}`]) > ctx.now ? Math.floor(value * rate) : value;
  const command = buffed(level + int(h.command_base), 1, 1.5) + int(h.command_add_on);
  const affairsText = buffed(affairs, 2, 1.25) + int(h.affairs_add_on);
  const braveryText = buffed(bravery, 3, 1.25) + int(h.bravery_add_on);
  const wisdomText = buffed(wisdom, 4, 1.25) + int(h.wisdom_add_on);

  return {
    hid: int(h.hid),
    name: str(h.name),
    level,
    herotype,
    npcid,
    state: int(h.state),
    king,
    famous: npcid > 0,
    healthy: int(h.hero_health) === 0,
    image: king
      ? playerFace(ctx.lordSex, ctx.lordFace)
      : `images/hero/hero_${int(h.sex) === 0 ? 'girl' : 'boy'}_${str(h.face)}.jpg`,
    nameColor: king ? kingLevelColor(kingLevel) : 0xffffff,
    affairs,
    bravery,
    wisdom,
    pointleft,
    currentExp,
    upgradeExp,
    expText,
    goldNeed,
    loyalty: str(h.loyalty),
    commandText: String(command),
    affairsText: String(affairsText),
    braveryText: String(braveryText),
    wisdomText: String(wisdomText),
    forceText: `${str(h.force)}/${str(h.force_max)}`,
    energyText: `${str(h.energy)}/${str(h.energy_max)}`,
    speedText: str(h.speed_add_on),
    attackText: String(braveryText * 10 + int(h.attack_add_on)),
    defenceText: String(wisdomText * 10 + int(h.defence_add_on)),
    canAddExp: level < (npcid > 0 ? maxHeroLevel(npcid, 0, 0) : 120),
  };
}

/** `LargessDialog.onLargessChange`: what the chosen reward does. */
export function largessText(typeidx: number, goldNeed: number, loyalty: number): string {
  const t = (n: number) => i18n(`Hero_LargessDialog_${n}_1`);
  if (typeidx > 0) return t(14 + typeidx);
  const gold = String(goldNeed * 5);
  if (goldNeed < 3500) return t(8) + gold + t(9);
  if (goldNeed < 6500) return t(10) + gold + t(11);
  if (loyalty < 30) return t(12) + gold + t(13);
  return t(14);
}
