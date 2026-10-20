type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));

/** `Global.ACT_MSG_TIP`: the head of an event message the 客栈 reply ends with. */
const ACT_MSG_TIP = 'MSG_ACTTIP';

/** `HeroRecruit` (doGetRecruitHero): a hero the 客栈 offers. */
export interface HeroRecruit {
  id: number;
  hname: string;
  sex: number;
  face: number;
  level: number;
  affairs_base: number;
  bravery_base: number;
  wisdom_base: number;
  command_base: number;
  affairs_add: number;
  bravery_add: number;
  wisdom_add: number;
  command_add: number;
  loyalty: number;
  gold_need: number;
  isActHero: boolean;
}

export function parseHeroRecruit(row: Row): HeroRecruit {
  return {
    id: int(row.id),
    hname: str(row.hname),
    sex: int(row.sex),
    face: int(row.face),
    level: int(row.level),
    affairs_base: int(row.affairs_base),
    bravery_base: int(row.bravery_base),
    wisdom_base: int(row.wisdom_base),
    command_base: int(row.command_base),
    affairs_add: int(row.affairs_add),
    bravery_add: int(row.bravery_add),
    wisdom_add: int(row.wisdom_add),
    command_add: int(row.command_add),
    loyalty: int(row.loyalty),
    gold_need: int(row.gold_need),
    isActHero: Boolean(row.isActHero),
  };
}

/** The 客栈 part of a building info reply, after the two levels. */
export interface HotelInfo {
  recruits: HeroRecruit[];
  /** `mOfficeValidPosition`: free 招贤馆 slots. */
  validPosition: number;
  /** `mGuanJueLevel`: the lord may befriend famous heroes. */
  guanJue: boolean;
}

export function parseHotelInfo(extra: unknown[]): HotelInfo {
  const list = Array.isArray(extra[0]) ? (extra[0] as unknown[]) : [];
  return {
    recruits: list.filter((r): r is Row => !!r && typeof r === 'object').map(parseHeroRecruit),
    validPosition: int(extra[1]),
    guanJue: Boolean(extra[2]),
  };
}

/** `HotelDialog.onBuildingInfo`: the text of a trailing `MSG_ACTTIP|text`, or null. */
export function actMessage(reply: unknown[]): string | null {
  const last = reply[reply.length - 1];
  if (typeof last !== 'string') return null;
  const [head, text] = last.split('|');
  return head === ACT_MSG_TIP ? str(text) : null;
}

/** `HotelRecruitPanel_inlineComponent1`: the name's colour by base points; event heroes green. */
export function recruitNameColor(r: HeroRecruit): number {
  if (r.isActHero) return 0x008000;
  const total = r.bravery_base + r.wisdom_base + r.affairs_base;
  if (total < 110) return 0xffffff;
  if (total < 150) return 0xffcc33;
  if (total < 170) return 0xcc3333;
  return 0xcc00ff;
}

/** `getCommandLabel`: 统率 counts the level. */
export function recruitCommand(r: HeroRecruit): number {
  return r.command_base + r.command_add + r.level;
}

/** `HeroRecruitDialog.setHeroRecruit`. */
export function recruitFace(r: HeroRecruit): string {
  return `images/hero/hero_${r.sex === 0 ? 'girl' : 'boy'}_${r.face}.jpg`;
}
