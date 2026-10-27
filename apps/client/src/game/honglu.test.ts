import { describe, expect, it } from 'vitest';
import { parseHongluBuildingInfo } from './honglu';

describe('parseHongluBuildingInfo', () => {
  it('parses union troops and all three permission flags', () => {
    const info = parseHongluBuildingInfo([
      {},
      {},
      ['联盟', [{ id: 7, uid: 1002, cid: 3005, hid: 8, hero: '将领', herolevel: 20 }]],
      1,
      0,
      1,
    ]);
    expect(info.unionName).toBe('联盟');
    expect(info.troops[0]).toMatchObject({ id: 7, hero: '将领', herolevel: 20 });
    expect(info.allowUnionTroop).toBe(true);
    expect(info.allowAntiPlunder).toBe(false);
    expect(info.allowAntiInvade).toBe(true);
  });

  it('tolerates a missing payload', () => {
    expect(parseHongluBuildingInfo(null)).toEqual({
      unionName: '',
      troops: [],
      allowUnionTroop: false,
      allowAntiPlunder: false,
      allowAntiInvade: false,
    });
  });
});
