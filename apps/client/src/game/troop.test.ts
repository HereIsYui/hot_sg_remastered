import { describe, expect, it } from 'vitest';
import {
  buildTroopResourceString,
  buildTroopSoldiersString,
  campaignFoodUse,
  campaignPathTime,
  campaignSoldiers,
  campaignTotalCarry,
  makeTimeLeftString,
  parseStayTroops,
  parseTroopDetail,
  parseTroopMaxTime,
  parseTroopRow,
  parseTroopScheme,
  targetFromCid,
  troopDisplay,
  type CampaignResource,
  type CampaignSoldier,
} from './troop';

describe('makeTimeLeftString', () => {
  it('pads hours/minutes/seconds and clamps negatives', () => {
    expect(makeTimeLeftString(3661)).toBe('01:01:01');
    expect(makeTimeLeftString(59)).toBe('00:00:59');
    expect(makeTimeLeftString(0)).toBe('00:00:00');
    expect(makeTimeLeftString(-10)).toBe('00:00:00');
  });
});

describe('parseTroopScheme', () => {
  it('parses a saved scheme row and tolerates an empty reply', () => {
    expect(parseTroopScheme([{ type: '2', soldiers: '2,1,100,7,30,' }])).toEqual({
      type: 2,
      soldiers: '2,1,100,7,30,',
    });
    expect(parseTroopScheme([])).toBeNull();
    expect(parseTroopScheme(null)).toBeNull();
  });
});

describe('parseTroopRows', () => {
  it('maps a sys_troops row (userid falls back to uid)', () => {
    const row = parseTroopRow({
      id: '5',
      uid: '42',
      cid: '101205',
      hid: '3',
      targetcid: '110210',
      task: '4',
      state: '0',
      wtype: '2',
      endtime: '2000',
      starttime: '1000',
      pathtime: '1000',
      fromcity: '洛阳',
    });
    expect(row.id).toBe(5);
    expect(row.userid).toBe(42);
    expect(row.task).toBe(4);
    expect(row.fromcityName).toBe('洛阳');
    expect(row.targetcityName).toBe('');
  });
});

describe('troopDisplay', () => {
  it('labels an occupying troop on the move with a live countdown', () => {
    const row = parseTroopRow({
      id: 1,
      uid: 7,
      cid: 205101,
      targetcid: 210110,
      task: 4,
      state: 0,
      wtype: 0,
      endtime: 1600,
      targetcity: '敌城',
      fromcity: '主城',
    });
    const d = troopDisplay(row, 1000);
    expect(d.taskName).toBe('占领');
    expect(d.stateName).toBe('前进');
    expect(d.fromLabel).toBe('主城');
    expect(d.targetLabel).toBe('敌城');
    expect(d.timeLeft).toBe('00:10:00');
  });

  it('hides coordinates for a 派遣 troop and shows 战斗中 for a fighting one', () => {
    const dispatch = parseTroopRow({
      id: 2,
      cid: 1000001,
      targetcid: 5,
      task: 7,
      state: 0,
      endtime: 100,
    });
    const dd = troopDisplay(dispatch, 0);
    expect(dd.targetLabel).toBe('[ -- ]');
    expect(dd.fromLabel).toBe('[ -- ]');

    const fighting = parseTroopRow({
      id: 3,
      cid: 101101,
      targetcid: 110110,
      task: 4,
      state: 3,
      endtime: 100,
    });
    const fd = troopDisplay(fighting, 0);
    expect(fd.timeLeft).toBe('--');
    expect(fd.stateName).toBe('战斗');
  });

  it('falls back to [x,y] labels and the terrain name when no city name is given', () => {
    const row = parseTroopRow({
      id: 4,
      cid: 205101,
      targetcid: 210110,
      task: 2,
      state: 0,
      wtype: 3,
      endtime: 10,
    });
    const d = troopDisplay(row, 0);
    expect(d.fromLabel).toBe('[101,205]');
    expect(d.targetLabel).toBe('石山');
  });
});

describe('parseStayTroops', () => {
  it('reads [allowAutoDiscard, troops]', () => {
    const stay = parseStayTroops([1, [{ id: 9, targetcid: 110110, state: 4 }]]);
    expect(stay.allowAutoDiscard).toBe(true);
    expect(stay.troops).toHaveLength(1);
    expect(stay.troops[0]?.id).toBe(9);
    expect(parseStayTroops([0, []]).allowAutoDiscard).toBe(false);
    expect(parseStayTroops([]).troops).toEqual([]);
  });
});

describe('parseTroopDetail', () => {
  const soldierNames = { 1: '刀兵', 7: '弓兵' };
  const technicNames = { 11: '辎重', 12: '急行军' };

  it('parses own troop detail (exact soldier counts, resources, technics)', () => {
    const detail = parseTroopDetail(
      [
        {
          troopowner: '张三',
          troopunion: '盟',
          hero: { name: '关羽', level: 12 },
          viewLevel: 0,
          troop: { soldiers: '2,1,100,7,30,', resource: '500,0,200,0,0' },
          technic: [{ tid: 11, level: 3 }],
        },
      ],
      soldierNames,
      technicNames,
    );
    expect(detail.owner).toBe('张三');
    expect(detail.heroName).toBe('关羽');
    expect(detail.heroLevel).toBe('12');
    expect(detail.soldiers).toEqual([
      { soldier: '刀兵', count: '100' },
      { soldier: '弓兵', count: '30' },
    ]);
    expect(detail.resource).toEqual([
      { resource: '黄金', count: '500' },
      { resource: '木材', count: '200' },
    ]);
    expect(detail.technic).toEqual([{ name: '辎重', level: 3 }]);
  });

  it('fogs enemy counts by view level', () => {
    const base = {
      troop: { soldiers: '2,1,100,7,30,', resource: '' },
      hero: null,
    };
    const exact = parseTroopDetail([{ ...base, viewLevel: 8 }], soldierNames, technicNames, {
      showEnemy: true,
    });
    expect(exact.soldiers).toEqual([
      { soldier: '刀兵', count: '100' },
      { soldier: '弓兵', count: '30' },
    ]);

    const bucketed = parseTroopDetail([{ ...base, viewLevel: 7 }], soldierNames, technicNames, {
      showEnemy: true,
      countDesc: [
        { count: 100, desc: '大量' },
        { count: 1, desc: '少量' },
      ],
    });
    expect(bucketed.soldiers).toEqual([
      { soldier: '刀兵', count: '大量' },
      { soldier: '弓兵', count: '少量' },
    ]);

    const fogged = parseTroopDetail([{ ...base, viewLevel: 5 }], soldierNames, technicNames, {
      showEnemy: true,
    });
    expect(fogged.soldiers).toEqual([
      { soldier: '--', count: '' },
      { soldier: '--', count: '' },
    ]);
  });
});

describe('parseTroopMaxTime', () => {
  it('reads a number from either a bare value or a wrapped array', () => {
    expect(parseTroopMaxTime(900)).toBe(900);
    expect(parseTroopMaxTime([900])).toBe(900);
    expect(parseTroopMaxTime(0)).toBe(0);
  });
});

describe('campaign soldier picker', () => {
  const config = [
    { sid: 1, name: '刀兵', speed: 30, carry: 50, food_use: 2 },
    { sid: 7, name: '弓兵', speed: 20, carry: 40, food_use: 3 },
    { sid: 9, name: '骑兵', speed: 60, carry: 30, food_use: 4 },
  ];

  it('joins city counts with cfg_soldier stats, skipping absent types', () => {
    const list = campaignSoldiers({ 1: 100, 7: 0, 9: 50 }, config);
    expect(list.map((s) => s.sid)).toEqual([1, 9]);
    expect(list[0]).toMatchObject({ name: '刀兵', count: 100, carry: 50, speed: 30, food_use: 2 });
  });
});

describe('campaign arithmetic', () => {
  const soldiers: CampaignSoldier[] = [
    { sid: 1, name: '刀兵', count: 100, speed: 30, carry: 50, food_use: 2, takecount: 100 },
    { sid: 9, name: '骑兵', count: 50, speed: 60, carry: 30, food_use: 4, takecount: 10 },
  ];

  it('getTotalCarry scales carry by the 辎重 tech level', () => {
    // factor = 1 + 2*0.1 = 1.2 -> (50*1.2)*100 + (30*1.2)*10 = 6000 + 360 = 6360
    expect(campaignTotalCarry(soldiers, 2)).toBe(6360);
  });

  it('getFoodUse spends food over the round trip', () => {
    // use = 2*100 + 4*10 = 240 ; ceil(240*2*1800/3600) = 240
    expect(campaignFoodUse(soldiers, 1800)).toBe(240);
  });

  it('pathTime uses the slowest taken soldier and the GRID_DISTANCE scale', () => {
    // distance between (265,215) and (268,219) = 5 cells; min speed = 30 (刀兵)
    const t = campaignPathTime({
      fromX: 265,
      fromY: 215,
      targetX: 268,
      targetY: 219,
      soldiers,
      soldierSpeed: (s) => s.speed,
      taskIndex: 2,
      speedAddRate: 1,
      addSeconds: 0,
      maxTime: 0,
      beaconHalf: false,
    });
    // ceil(5 * 100 / 30) = 17
    expect(t).toBe(17);
  });

  it('pathTime applies the add delay, the maxTime cap and the beacon halving', () => {
    const base = {
      fromX: 1,
      fromY: 1,
      targetX: 100,
      targetY: 1,
      soldiers,
      soldierSpeed: (s: CampaignSoldier) => s.speed,
      taskIndex: 2,
      speedAddRate: 1,
      addSeconds: 60,
      maxTime: 0,
      beaconHalf: false,
    };
    // distance 99 cells, min speed 30 -> ceil(9900/30)=330, +60 = 390
    expect(campaignPathTime(base)).toBe(390);
    // cap the travel (before the add) at 100s -> 100 + 60 = 160
    expect(campaignPathTime({ ...base, maxTime: 100 })).toBe(160);
    // beacon halves the whole thing -> ceil(390*0.5)=195
    expect(campaignPathTime({ ...base, beaconHalf: true })).toBe(195);
  });

  it('pathTime returns 0 when nothing is taken', () => {
    const none = soldiers.map((s) => ({ ...s, takecount: 0 }));
    expect(
      campaignPathTime({
        fromX: 1,
        fromY: 1,
        targetX: 5,
        targetY: 5,
        soldiers: none,
        soldierSpeed: (s) => s.speed,
        taskIndex: 2,
        speedAddRate: 1,
        addSeconds: 0,
        maxTime: 0,
        beaconHalf: false,
      }),
    ).toBe(0);
  });
});

describe('StartTroop command strings', () => {
  it('builds the soldiers string and returns null when nothing is taken', () => {
    const soldiers: CampaignSoldier[] = [
      { sid: 1, name: '刀兵', count: 100, speed: 30, carry: 50, food_use: 2, takecount: 100 },
      { sid: 7, name: '弓兵', count: 30, speed: 20, carry: 40, food_use: 3, takecount: 0 },
      { sid: 9, name: '骑兵', count: 50, speed: 60, carry: 30, food_use: 4, takecount: 10 },
    ];
    expect(buildTroopSoldiersString(soldiers)).toBe('2,1,100,9,10,');
    expect(buildTroopSoldiersString(soldiers.map((s) => ({ ...s, takecount: 0 })))).toBeNull();
  });

  it('builds the resource string in gold/food/wood/rock/iron order', () => {
    const resources: CampaignResource[] = [
      { name: '黄金', count: 500, takecount: 100 },
      { name: '粮食', count: 0, takecount: 0 },
      { name: '木材', count: 200, takecount: 50 },
      { name: '石料', count: 0, takecount: 0 },
      { name: '铁矿', count: 0, takecount: 0 },
    ];
    expect(buildTroopResourceString(resources)).toBe('100,0,50,0,0,');
  });
});

describe('targetFromCid', () => {
  it('decodes a cid and flags the 洛阳 fixed target', () => {
    expect(targetFromCid(215265)).toEqual({ x: 265, y: 215, isLuoyang: true });
    expect(targetFromCid(110210)).toEqual({ x: 210, y: 110, isLuoyang: false });
  });
});
