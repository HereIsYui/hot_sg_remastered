import { i18n } from '../i18n';

/** `Utils.wid2cid`: a world id packs 10x10 blocks as `YYXXyx`; a city id is `y * 1000 + x`. */
export function wid2cid(wid: number): number {
  const y = Math.floor(wid / 10000) * 10 + Math.floor((wid % 100) / 10);
  const x = Math.floor((wid % 10000) / 100) * 10 + (wid % 10);
  return y * 1000 + x;
}

/** `Define.WORLD_TYPE_NAME`: 城池, 平地, then the six wild terrains. */
export function worldTypeName(type: number): string {
  return type >= 0 && type <= 7 ? i18n(`_Define_${type + 1}`) : '';
}

/** `FieldDetailDialog.setField`: the title line `地形:(x,y)` for a field's world id. */
export function fieldTitle(type: number, wid: number): string {
  const cid = wid2cid(wid);
  return `${worldTypeName(type)}:(${cid % 1000},${Math.floor(cid / 1000)})`;
}

/** `FieldDetailDialog.setField`: 筑城 is offered on 平地 only (`mCanCreateCity = type == 1`). */
export function canCreateCityOnField(type: number): boolean {
  return type === 1;
}

/** Per terrain: the bonus at level 0 < level, and per level (CityFunc.php::updateFieldResourceAdd). */
const BONUS: Record<number, [base: number, per: number]> = {
  2: [3, 2],
  3: [3, 2],
  4: [2, 1],
  5: [3, 2],
  6: [5, 3],
  7: [3, 2],
};

/**
 * `FieldDetailDialog.getFieldDescription`: the production bonus in percent; operators 60 and
 * 55555555 add a quarter in province 1.
 */
export function fieldDescription(
  type: number,
  level: number,
  province: number,
  yysType: number,
): string {
  const t = (n: number) => i18n(`Government_FieldDetailDialog_${n}_1`);
  if (level === 0 && type > 1) return t(18);
  if (type === 1) return t(19);
  const bonus = BONUS[type];
  if (!bonus) return '';
  const rate = (yysType === 60 || yysType === 55555555) && province === 1 ? 1.25 : 1;
  const percent = Math.trunc(((level > 0 ? bonus[0] : 0) + bonus[1] * level) * rate);
  const first = 20 + (type - 2) * 2;
  return t(first) + percent + t(first + 1);
}
