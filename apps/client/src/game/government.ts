import { endTimeText, timeLeftText } from '../core/clock';
import type { BuildingState } from '../stores/city';

type Lang = (key: string) => string;

/** The 官府 pop-ups: 调整税率, 安抚百姓, 征收物资, 城池改名 and 将领历练. */
export type GovernmentAction = 'tax' | 'pacify' | 'levy' | 'rename' | 'heroExpr';

/** `Define.GAME_SPEED_RATE`. */
const GAME_SPEED_RATE = 1;
/** `Define.GLOBAL_*_RATE` for gold, food, wood, rock and iron: one person's levy share. */
const LEVY_RATES = [1, 10, 10, 5, 4] as const;

/** `LevyResourceDialog.mResourceSelect`. */
export function levyOptions(i18n: Lang): string[] {
  return [7, 8, 9, 10, 11].map((n) => i18n(`Government_LevyResourceDialog_${n}_1`));
}

/** `LevyResourceDialog.onChange`: what levying resource `index` yields now. */
export function levyPreview(index: number, peopleAll: number, i18n: Lang): string {
  const rate = LEVY_RATES[index];
  if (rate === undefined) return '';
  const t = (n: number, suffix = '') => i18n(`Government_LevyResourceDialog_${n}${suffix}`);
  const amount = Math.floor(rate * GAME_SPEED_RATE * peopleAll * 0.1);
  return `${t(12 + index * 2, '_1')}${amount}${t(13 + index * 2)}`;
}

/** `PacifyPeopleDialog.mActionSelect`. */
export function pacifyOptions(i18n: Lang): string[] {
  return [6, 7, 8, 9].map((n) => i18n(`Government_PacifyPeopleDialog_${n}_1`));
}

/** `PacifyPeopleDialog.onChange`: the cost and effect of action `index`. */
export function pacifyPreview(index: number, peopleMax: number, i18n: Lang): string {
  const t = (n: number) => i18n(`Government_PacifyPeopleDialog_${n}_1`);
  const cap = peopleMax * GAME_SPEED_RATE;
  if (index === 0) return `${t(10)}${cap}${t(11)}`;
  if (index === 1) return `${t(12)}${cap}${t(13)}`;
  if (index === 2) return `${t(14)}${cap}${t(15)}${Math.floor(cap * 0.1)}${t(16)}`;
  if (index === 3) return `${t(17)}${cap * 5}${t(18)}${Math.floor(cap * 0.05)}${t(19)}`;
  return '';
}

export interface UpgradingRow {
  building: BuildingState;
  bname: string;
  task: string;
  level: number;
  nextlevel: number;
  timeleft: string;
  endtime: string;
}

/** `GovernmentPanel.updateUpgradingBuildingList` / `onTimer`: buildings being built or razed. */
export function upgradingRows(
  buildings: readonly BuildingState[],
  now: number,
  i18n: Lang,
): UpgradingRow[] {
  const task = (b: BuildingState) => {
    if (b.state === 2) return i18n('Government_GovernmentPanelSrc_1');
    if (b.state !== 1) return '';
    return i18n(`Government_GovernmentPanelSrc_${b.level === 0 ? 2 : 3}`);
  };
  return buildings
    .filter((b) => b.state > 0)
    .map((b) => ({
      building: b,
      bname: b.bname,
      task: task(b),
      level: b.level,
      nextlevel: b.state === 1 ? b.level + 1 : b.level - 1,
      timeleft: timeLeftText(b.state_endtime - now, i18n),
      endtime: endTimeText(b.state_endtime),
    }));
}
