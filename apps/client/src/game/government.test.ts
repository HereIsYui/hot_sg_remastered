import { describe, expect, it } from 'vitest';
import type { BuildingState } from '../stores/city';
import { levyPreview, pacifyOptions, pacifyPreview, upgradingRows } from './government';

const key = (k: string) => `[${k}]`;

function building(over: Partial<BuildingState>): BuildingState {
  return {
    bid: 1,
    bname: '民居',
    description: '',
    inner: 1,
    x: 0,
    y: 0,
    level: 3,
    state: 0,
    state_starttime: 0,
    state_endtime: 0,
    state_timeleft: 0,
    ...over,
  };
}

describe('government', () => {
  it('previews a levy with the resource rate', () => {
    expect(levyPreview(0, 12345, key)).toBe(
      '[Government_LevyResourceDialog_12_1]1234[Government_LevyResourceDialog_13]',
    );
    expect(levyPreview(3, 12345, key)).toBe(
      '[Government_LevyResourceDialog_18_1]6172[Government_LevyResourceDialog_19]',
    );
    expect(levyPreview(5, 12345, key)).toBe('');
  });

  it('previews the four pacify actions', () => {
    expect(pacifyOptions(key)).toHaveLength(4);
    expect(pacifyPreview(0, 1000, key)).toBe(
      '[Government_PacifyPeopleDialog_10_1]1000[Government_PacifyPeopleDialog_11_1]',
    );
    expect(pacifyPreview(2, 1005, key)).toBe(
      '[Government_PacifyPeopleDialog_14_1]1005[Government_PacifyPeopleDialog_15_1]100' +
        '[Government_PacifyPeopleDialog_16_1]',
    );
    expect(pacifyPreview(3, 1005, key)).toBe(
      '[Government_PacifyPeopleDialog_17_1]5025[Government_PacifyPeopleDialog_18_1]50' +
        '[Government_PacifyPeopleDialog_19_1]',
    );
  });

  it('lists buildings under construction or demolition', () => {
    const rows = upgradingRows(
      [
        building({ state: 0 }),
        building({ bid: 2, level: 0, state: 1, state_endtime: 1000 }),
        building({ bid: 3, level: 4, state: 1, state_endtime: 1065 }),
        building({ bid: 4, level: 4, state: 2, state_endtime: 990 }),
      ],
      1000,
      key,
    );
    expect(rows.map((r) => [r.building.bid, r.task, r.nextlevel])).toEqual([
      [2, '[Government_GovernmentPanelSrc_2]', 1],
      [3, '[Government_GovernmentPanelSrc_3]', 5],
      [4, '[Government_GovernmentPanelSrc_1]', 3],
    ]);
    expect(rows[0]!.timeleft).toBe('00[_Utils_7]');
    expect(rows[1]!.timeleft).toBe('01[_Utils_6]05[_Utils_7]');
    expect(rows[2]!.timeleft).toBe('[_Utils_4]');
  });
});
