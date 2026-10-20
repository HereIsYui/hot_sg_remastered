import { reactive } from 'vue';
import { i18n } from '../i18n';
import { armorImage } from './goods';

type Row = Record<string, unknown>;

const int = (v: unknown) => parseInt(String(v), 10) || 0;
const str = (v: unknown) => (v == null ? '' : String(v));
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const asRow = (v: unknown): Row | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null;

/** `HeroArmorPanel.ARMOR_PART`: the 16 gear slots by `spart` (part * 10 + index), then the book. */
export const ARMOR_SPARTS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 91, 100, 101, 110, 111, 112, 120];
export const SKILL_SPART = 130;

/** `ArmorItemSmall.EMPTY_ARMOR` */
export const EMPTY_ARMOR_IMAGE = 'images/armorslot_null.png';

/** `ArmorTooltip.ARM_NAME_COLOR` by armor type (1-7). */
const ARM_NAME_COLOR = [
  '#707070',
  '#ffffff',
  '#33a800',
  '#0090ff',
  '#9900CC',
  '#ffff00',
  '#e70303',
];
/** `ArmorTooltip.generateStrongValueTip`: attribute points gained at each strengthening level. */
const STRONG_LEVEL_VALUES = [0, 2, 2, 2, 2, 2, 2, 3, 3, 3, 6, 3, 3, 5, 5, 7];
const PART_NAME_KEYS = [
  ...Array.from({ length: 12 }, (_, i) => `Tooltip_ArmorTooltip_${i + 1}_1`),
  'Tooltip_ArmorTooltip_12_2',
];

/** `ArmorTooltip.ARMOR_PART_NAME[part - 1]` */
export function armorPartName(part: number): string {
  const key = PART_NAME_KEYS[part - 1];
  return key ? i18n(key) : '';
}

/** `ArmorTooltip.ARMOR_ATT_NAME[type - 1]` */
function attName(type: unknown): string {
  return i18n(`Tooltip_ArmorTooltip_${int(type) + 12}_1`);
}

/** A worn or owned piece as the panels keep it: durability in whole points. */
export interface Armor {
  sid: number;
  hp: number;
  hpMax: number;
  oriHpMax: number;
  heroLevel: number;
  imageName: string;
  row: Row;
}

/** `HeroArmorPanel.onLoadData` / `ChangeArmorDialog.onLoadUserPartArmor` per row. */
export function parseArmor(row: Row): Armor {
  return {
    sid: int(row.sid),
    hp: Math.ceil(int(row.hp) / 10),
    hpMax: int(row.hp_max),
    oriHpMax: int(row.ori_hp_max),
    heroLevel: int(row.hero_level),
    imageName: armorImage(row),
    row,
  };
}

/** The row the tooltip reads: `mArmor` after `onLoadData` and later repairs. */
export function armorTipRow(a: Armor): Row {
  return { ...a.row, sid: a.sid, hp: a.hp, hp_max: a.hpMax, ori_hp_max: a.oriHpMax };
}

/** 黄金 to repair (`onClickRepair`): 100 per missing point. */
export function repairCost(a: Armor): number {
  return (a.hpMax - a.hp) * 100;
}

/** 元宝 / 礼金 to renovate (`onClickRenovate`). */
export function renovateCost(a: Armor): number {
  return a.oriHpMax - a.hpMax + Math.ceil((a.hpMax - a.hp) / 10);
}

export function needsRepair(a: Armor): boolean {
  return a.hp < a.hpMax;
}

export function needsRenovate(a: Armor): boolean {
  return a.hpMax < a.oriHpMax || a.hp < a.hpMax;
}

/** The tables `Global.dealWithOtherInfoOfArmor` caches for tooltips, shared by every dialog. */
export interface ArmorInfo {
  /** cfg_armor_attribute rows by armor id. */
  attributes: Record<number, Row[]>;
  /** The `attr` of each embeddable gem by gid. */
  embedGoodsAttr: Record<number, string>;
  /** cfg_tie rows by set id, with `armed`: the pieces worn. */
  tieInfo: Record<number, Row>;
  /** The set bonuses by set id, one per required count. */
  tieAttributes: Record<number, Row[]>;
  /** 炼化 attributes by sid. */
  deify: Record<number, Row[]>;
  /** 熔炼 data by sid: `[level, count, type, value, ...]` rows or the empty `[0, 1, 0, 0]`. */
  fusion: Record<number, unknown[]>;
}

export function emptyArmorInfo(): ArmorInfo {
  return {
    attributes: {},
    embedGoodsAttr: {},
    tieInfo: {},
    tieAttributes: {},
    deify: {},
    fusion: {},
  };
}

export const armorInfo = reactive<ArmorInfo>(emptyArmorInfo());

/** `Global.dealWithOtherInfoOfArmor`: consumes the six tables after an armor list. */
export function dealWithOtherInfoOfArmor(info: ArmorInfo, rest: unknown[]): void {
  const pairs = (list: unknown) => {
    const a = Array.isArray(list) ? list : [];
    const out: [number, unknown][] = [];
    for (let i = 0; i + 1 < a.length; i += 2) out.push([int(a[i]), a[i + 1]]);
    return out;
  };
  for (const [id, rows] of pairs(rest.shift())) {
    const list = rowsOf(rows);
    if (list.length > 0) info.attributes[id] = list;
  }
  for (const goods of rowsOf(rest.shift())) info.embedGoodsAttr[int(goods.gid)] = str(goods.attr);
  for (const tie of Object.values(info.tieInfo)) tie.armed = 0;
  for (const tie of rowsOf(rest.shift())) info.tieInfo[int(tie.tieid)] = tie;
  for (const attr of rowsOf(rest.shift())) {
    const list = (info.tieAttributes[int(attr.tieid)] ??= []);
    if (!list.some((a) => a.precond === attr.precond)) list.push(attr);
  }
  for (const [sid, rows] of pairs(rest.shift())) info.deify[sid] = rowsOf(rows);
  const fusion = Array.isArray(rest[0]) ? (rest.shift() as unknown[]) : [];
  for (let i = 0; i + 2 < fusion.length; i += 3) {
    const rows = fusion[i + 2];
    info.fusion[int(fusion[i + 1])] = Array.isArray(rows) ? rows : [];
  }
}

/** `ArmorTooltip.sortArmorAttr`: the attribute types of `n,type,value,...` by value, largest first. */
export function sortArmorAttr(attribute: string): number[] {
  const parts = attribute.split(',');
  const n = int(parts[0]);
  if (parts.length === 0 || n * 2 + 1 !== parts.length) return [];
  const types: number[] = [];
  const values: number[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    types.push(int(parts[i]));
    values.push(int(parts[i + 1]));
  }
  for (let i = 0; i < types.length; i++) {
    for (let j = types.length - 2; j >= i; j--) {
      if (values[j + 1]! > values[j]!) {
        [types[j], types[j + 1]] = [types[j + 1]!, types[j]!];
        [values[j], values[j + 1]] = [values[j + 1]!, values[j]!];
      }
    }
  }
  return types;
}

/** `ArmorTooltip.generateStrongValueTip`: the strengthening points spread over the attributes. */
function strongValueTip(row: Row): string {
  const gained = new Array<number>(20).fill(0);
  const order = sortArmorAttr(str(row.attribute));
  const level = int(row.strong_level);
  for (let l = 1; l <= level; l++) {
    let points = l <= 15 ? STRONG_LEVEL_VALUES[l]! : 0;
    while (points > 0 && order.length > 0) {
      for (const type of order) {
        if (points <= 0) break;
        gained[type] = (gained[type] ?? 0) + 1;
        points--;
      }
    }
  }
  let tip = '<font color="#00ff00">';
  for (const type of order) {
    if ((gained[type] ?? 0) > 0) tip += ` +${gained[type]}${attName(type)}`;
  }
  return `${tip}</font>`;
}

/** `ArmorTooltip.parseEmbedHole`: `[holes, filled, empty, can be opened]`. */
function parseEmbedHole(row: Row): [number, number, number, number] {
  const holes = str(row.embed_holes).split(',');
  const pearls = str(row.embed_pearls).split(',');
  let all = 0;
  let filled = 0;
  let empty = 0;
  let openable = 0;
  holes.forEach((hole, i) => {
    const pearl = pearls[i];
    if (i < pearls.length && pearl !== '0' && pearl !== '') filled++;
    if (int(hole) === 0 && int(pearl) === 0) empty++;
    if (int(hole) !== 3) all++;
    if ([1, 2, 4].includes(int(hole))) openable++;
  });
  return [all, filled, empty, openable];
}

/** `Global.getArmorEmbedAttr`: the `attr` of each embedded gem. */
function embedAttrs(info: ArmorInfo, pearls: string): string[] {
  return pearls
    .split(',')
    .filter((gid) => int(gid) !== 0 && info.embedGoodsAttr[int(gid)] !== undefined)
    .map((gid) => info.embedGoodsAttr[int(gid)]!);
}

/** `ArmorTooltip.getTieAttrDesc` */
function tieAttrDesc(info: ArmorInfo, row: Row, armed: number): string {
  const tie = info.tieInfo[int(row.tieid)]!;
  const shown = Math.min(armed, int(tie.count));
  let tip = `\n${str(tie.name)}(${shown}/${str(tie.count)})\n`;
  for (const attr of info.tieAttributes[int(row.tieid)] ?? []) {
    const value = int(attr.value);
    const bonus = value >= 0 ? `+${value}${str(attr.name)}` : `${value}${str(attr.name)}`;
    const head = `${str(attr.precond)}${i18n('Tie_Attribute_Part1')} `;
    tip +=
      armed >= int(attr.precond)
        ? `\n${head}<font color="#00ff00">${bonus}</font>`
        : `\n<font color="#666666">${head}${bonus}</font>`;
  }
  return `${tip}\n`;
}

const substitute = (text: string, value: unknown) => text.replace('{0}', str(value));

/** `ArmorTooltip.generateTipText`: the htmlText under the title. */
export function armorTipText(info: ArmorInfo, row: Row, fusion: unknown[] = [0, 1, 0, 0]): string {
  let tip = armorPartName(int(row.part));
  const parts = str(row.attribute).split(',');
  const types = parts.filter((_, i) => i % 2 === 1);
  const fusionCount = int(fusion[1]);
  const added = (k: number) =>
    `<font color='#ff0000' fontWeight='bold'>${i18n('Tooltip_ArmorTooltip_add')}${str(fusion[k * 2 + 3])}</font>`;
  if (parts.length > 0) {
    for (let i = 0; i < int(parts[0]); i++) {
      const type = int(parts[i * 2 + 1]);
      const line = `\n+${parts[i * 2 + 2] ?? ''} ${attName(type)}`;
      const k = Array.from({ length: fusionCount }, (_, j) => j).find(
        (j) => int(fusion[j * 2 + 2]) === type,
      );
      tip += k === undefined ? line : `${line}         ${added(k)}`;
    }
    for (let k = 0; k < fusionCount; k++) {
      const type = str(fusion[k * 2 + 2]);
      if (types.length > 0 && !types.includes(type) && int(type) !== 0) {
        tip += `\n${attName(type)}              ${added(k)}`;
      }
    }
  }
  for (const attr of info.attributes[int(row.id)] ?? []) {
    tip += `\n+${str(attr.value)} ${str(attr.name)}`;
  }
  if (row.hp != null) {
    let hp = int(row.hp);
    const hpMax = int(row.hp_max);
    if (hp > hpMax) hp /= 10;
    const key =
      hp === 0
        ? 'Tooltip_ArmorTooltip_25_1'
        : hpMax < int(row.ori_hp_max)
          ? 'Tooltip_ArmorTooltip_26_1'
          : 'Tooltip_ArmorTooltip_27_1';
    tip += `\n${i18n(key)}${hp}/${hpMax}${key === 'Tooltip_ArmorTooltip_27_1' ? '' : '</font>'}`;
    tip += `\n${i18n('Tooltip_ArmorTooltip_28_1')}${str(row.hero_level)}`;
  }
  if (row.strong_level != null && int(row.strong_value) !== 0) {
    tip += `\n${i18n('Tooltip_ArmorTooltip_30_1')} ${strongValueTip(row)}`;
  }
  const isHorse = int(row.part) === 12;
  const pearls = str(row.embed_pearls);
  if (str(row.embed_holes) !== '') {
    const [all, filled, empty, openable] = parseEmbedHole(row);
    if (!isHorse) {
      tip += `\n${i18n('BlackSmith_ArmorHoleTip')}   ${filled}/${all}`;
      if (pearls !== '' && pearls !== '0,0,0,0,0') {
        tip += '<font color="#00ff00">';
        for (const attr of embedAttrs(info, pearls)) {
          const a = attr.split(',');
          for (let j = 0; j < a.length; j += 2) tip += `\n+${a[j + 1] ?? ''} ${attName(a[j])}`;
        }
        tip += '</font>';
      }
      tip += `\n${i18n('BlackSmith_ArmorHoleTip1')}  *${empty}`;
      tip += `\n${i18n('BlackSmith_ArmorHoleTip2')}  *${openable}`;
    } else {
      tip += `\n${i18n('BlackSmith_ZuojiHoleTip')}   ${filled}/${all}`;
      if (pearls !== '') {
        const attrs = embedAttrs(info, pearls);
        let next = 0;
        pearls.split(',').forEach((gid, i) => {
          tip += `\n${i18n(`BlackSmith_ZuojiHole${i}`)}   `;
          if (int(gid) === 0) {
            tip += i18n('BlackSmith_ZuojiNoAttr');
            return;
          }
          tip += '<font color="#00ff00">';
          const a = (attrs[next++] ?? '').split(',');
          for (let j = 0; j + 1 < a.length; j += 2) tip += ` +${a[j + 1]} ${attName(a[j])}`;
          tip += '</font>';
        });
      }
    }
  } else {
    const key = isHorse ? 'BlackSmith_UnActiveTip_horse' : 'BlackSmith_UnActiveTip';
    tip += `\n${i18n('BlackSmith_ArmorHoleTip')}   <font color="#ff0000">${i18n(key)}</font>`;
  }
  const best = str(row.best_quality);
  if (best !== '') {
    const q = best.split(',');
    tip += `\n${i18n('xilian_tip')}   <font color="#00ff00">${q[3] ?? ''}${q[4] ?? ''}+${q[2] ?? ''}%</font>`;
  }
  const special = str(row.special);
  if (special.length > 0) {
    const title = i18n('Armor_UserArmorItem_5_1');
    if (int(row.active_special) !== 0) {
      let text = special;
      if (row.specialAttid !== undefined) {
        const attid = int(row.specialAttid);
        const desc: Record<number, string> = {
          10008: 'Armor_ActiveSpecial_desc_3',
          10009: 'Armor_ActiveSpecial_desc_4',
          11: 'Armor_ActiveSpecial_desc_5',
          10: 'Armor_ActiveSpecial_desc_6',
        };
        text = desc[attid]
          ? substitute(i18n(desc[attid]), row.specialValue)
          : attid === -1 || attid === -2
            ? str(row.specialValue)
            : '';
      }
      tip += `\n${title}   <font color="#00ff00">${text}</font>`;
    } else {
      tip += `\n${title}   <font color="#666666">${special}   <font color="#ff0000">${i18n('BlackSmith_UnActiveTip')}</font>`;
    }
  }
  const description = str(row.description);
  if (description.length > 0) tip += `\n<font color="#ffc600">${description}</font>`;
  const tie = info.tieInfo[int(row.tieid)];
  if (int(row.tieid) > 0 && tie) tip += `\n${tieAttrDesc(info, row, int(tie.armed))}`;
  const deify = info.deify[int(row.sid)]?.[0];
  if (deify) {
    tip += `\n${i18n(isHorse ? 'Tie_Deify_2' : 'Tie_Deify_1')} `;
    tip += `<font color="#00ff00">+${str(deify.value)} ${str(deify.name)}</font>`;
  }
  return `${tip}\n\n`;
}

/** What `ArmorTooltip.createTooltip` shows: a coloured title, star or moon marks, the text. */
export interface ArmorTip {
  title: string;
  color: string;
  stars: string[];
  text: string;
}

const QUALITY_KEYS = Array.from({ length: 7 }, (_, i) => `BlackSmith_ArmorQuailtyDesc_${i + 1}`);

/** `ArmorTooltip.createTooltip` */
export function armorTip(info: ArmorInfo, row: Row): ArmorTip {
  let fusion: unknown[] = [0, 1, 0, 0];
  let quality = 0;
  if (row.sid !== undefined) {
    const cached = info.fusion[int(row.sid)] ?? [0, 1, 0, 0];
    if (cached.length > 1) {
      fusion = cached;
      quality = int(cached[0]);
    } else {
      fusion = str(asRow(cached[0])?.combineAttr).split(',');
      quality = int(fusion[0]);
    }
  }
  let title = quality !== 0 ? i18n(QUALITY_KEYS[quality - 1] ?? '') : '';
  const stars: string[] = [];
  if (row.strong_level != null) {
    const level = int(row.strong_level);
    title += `${str(row.name)}  (LV. ${level})`;
    const image =
      level >= 0 && level <= 10
        ? 'images/small_star.png'
        : level <= 15
          ? 'images/small_moon.png'
          : null;
    if (image) for (let i = 0; i < Math.min(level, 15); i++) stars.push(image);
  } else {
    title += str(row.name);
  }
  return {
    title,
    color: ARM_NAME_COLOR[int(row.type) - 1] ?? '#ffffff',
    stars,
    text: armorTipText(info, row, fusion),
  };
}
