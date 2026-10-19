import { i18n } from '../i18n';

/** Provinces selectable at role creation (`Global.PROVINCE_NAME[1..13]`). */
export const PROVINCE_COUNT = 13;

/** `Global.PROVINCE_NAME`: index 0 is the empty placeholder `_Global_1`. */
export function provinceName(index: number): string {
  return i18n(`_Global_${index + 1}`);
}

/** CreateRoleDialog.loadProvince: "random" followed by the 13 provinces. */
export function provinceOptions(): string[] {
  return [
    i18n('Login_CreateRoleDialogSrc_1'),
    ...Array.from({ length: PROVINCE_COUNT }, (_, i) => provinceName(i + 1)),
  ];
}

export interface ProvinceCounts {
  users: readonly number[];
  cities: readonly number[];
  lands: readonly number[];
}

/** `Global.getProvinceInfo`: Flex htmlText describing a province's population and crowding. */
export function provinceInfo(index: number, counts: ProvinceCounts): string {
  if (counts.cities.length === 0) return '';
  if (index === 0) return i18n('_Global_2298');
  const i = index - 1;
  const crowd = Math.floor((100 * (counts.cities[i] ?? 0)) / (counts.lands[i] ?? 0));
  const level = crowd < 40 ? '_Global_2301' : crowd < 80 ? '_Global_2302' : '_Global_2303';
  return (
    `<font size='16'>${provinceName(index)}${i18n('_Global_2299')}${counts.users[i] ?? 0}\n` +
    `${i18n('_Global_2300')}${counts.cities[i] ?? 0}\n` +
    `${i18n(level)}${crowd}%</font>`
  );
}
