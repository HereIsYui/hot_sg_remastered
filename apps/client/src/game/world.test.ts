import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  blockOf,
  blocksForWindow,
  cellToScreen,
  cid2wid,
  cidToXY,
  cityDistance,
  GRID_OFFSET_X,
  GRID_OFFSET_Y,
  inRange,
  LOADRANGE,
  makeCid,
  parseActionField,
  parseBlockData,
  parseFavouritesList,
  parseMapCity,
  parseUserFields,
  parseWorldCityInfo,
  parseWorldFieldInfo,
  provinceName,
  screenToCell,
  wid2cid,
  worldStateName,
  worldTypeName,
  xyToCid,
} from './world';

beforeAll(() => {
  setStrings({
    _Define_1: '城池',
    _Define_2: '平地',
    _Define_6: '草原',
    _Define_9: '平静',
    _Define_10: '战乱',
    _Define_11: '废墟',
    _Global_1: '司隶',
    _Global_5: '荆州',
  });
});

describe('coordinate packing', () => {
  it('round-trips wid <-> cid', () => {
    // wid 11 => block 0, offset 11 => (x=1,y=1) => cid 1001.
    expect(wid2cid(11)).toBe(1001);
    expect(cid2wid(1001)).toBe(11);
    // a cell deeper in the grid
    expect(wid2cid(123456)).toBe(125346);
    expect(cid2wid(125346)).toBe(123456);
  });

  it('decodes and encodes xy', () => {
    expect(cidToXY(125346)).toEqual({ x: 346, y: 125 });
    expect(xyToCid(346, 125)).toBe(125346);
    expect(makeCid(125346)).toBe('[346,125]');
  });

  it('maps a coordinate to its 10x10 block', () => {
    expect(blockOf(1, 1)).toBe(0);
    expect(blockOf(15, 23)).toBe(201); // blockY=2, blockX=1
    expect(blockOf(500, 500)).toBe(5050);
  });

  it('measures distance between cities', () => {
    expect(cityDistance(xyToCid(0, 0), xyToCid(3, 4))).toBe(5);
  });
});

describe('block window', () => {
  it('lists the covered blocks, clamped to 0..50', () => {
    expect(blocksForWindow(1, 20, 1, 10)).toEqual([0, 1, 2, 100, 101, 102]);
  });

  it('clamps negative and past-edge windows', () => {
    const blocks = blocksForWindow(-30, 5, 495, 540);
    // bx 0..0, by 49..50
    expect(blocks).toEqual([4900, 5000]);
  });
});

describe('isometric conversion', () => {
  it('round-trips a point inside a cell back to that cell', () => {
    // cellToScreen gives a cell's top-left; the hit-test (screenToCell) anchors at the cell
    // centre (image is ~2*OFFX wide), so feed a point well inside the diamond to round-trip.
    const centre = { x: 250, y: 250 };
    for (const cell of [
      { x: 250, y: 250 },
      { x: 252, y: 249 },
      { x: 248, y: 253 },
    ]) {
      const tl = cellToScreen(cell.x, cell.y, centre.x, centre.y);
      const mid = { x: tl.x + GRID_OFFSET_X, y: tl.y + GRID_OFFSET_Y };
      expect(screenToCell(mid.x, mid.y, centre.x, centre.y)).toEqual(cell);
    }
  });

  it('moves one cell east on +x', () => {
    const centre = { x: 100, y: 100 };
    const a = cellToScreen(100, 100, centre.x, centre.y);
    const b = cellToScreen(101, 100, centre.x, centre.y);
    expect(b.x - a.x).toBe(54); // GRID_OFFSET_X
    expect(b.y - a.y).toBe(27); // GRID_OFFSET_Y
  });
});

describe('range', () => {
  it('bounds the playable square to 1..500', () => {
    expect(inRange(1, 1)).toBe(true);
    expect(inRange(500, 500)).toBe(true);
    expect(inRange(0, 250)).toBe(false);
    expect(inRange(250, 501)).toBe(false);
  });
});

describe('names', () => {
  it('names terrain, state and province', () => {
    expect(worldTypeName(0)).toBe('城池');
    expect(worldTypeName(5)).toBe('草原');
    expect(worldTypeName(9)).toBe('');
    expect(worldStateName(0)).toBe('平静');
    expect(worldStateName(1)).toBe('战乱');
    expect(worldStateName(3)).toBe('');
    expect(provinceName(1)).toBe('司隶');
    expect(provinceName(0)).toBe('');
  });
});

describe('parseBlockData', () => {
  // group_concat shape: "offset:type:ownercid:state:level:province:jun,..."
  const fixture = [
    [
      // block 0 (wids 0..99): a city at offset 11 and a flatland at offset 12
      [0, '11:0:1001:1:3:1:0,12:1:1001:0:0:1:0'],
      // block 101 (blockY=1, blockX=1, start 10100): a wild terrain
      [10100, '55:6:0:0:2:5:0'],
    ],
    // union marks
    [{ cid: 1001, type: 2 }],
  ];

  it('parses cells, keys by cid and applies marks', () => {
    const centre = { x: 1, y: 1 };
    const result = parseBlockData(fixture, centre);
    expect(result.cells.size).toBe(3);

    const city = result.cells.get(wid2cid(11));
    expect(city).toMatchObject({
      wid: 11,
      cid: 1001,
      type: 0,
      ownercid: 1001,
      state: 1,
      level: 3,
      provinceid: 1,
      junid: 0,
      marktype: 2, // mark applied
    });

    const flat = result.cells.get(wid2cid(12));
    expect(flat?.type).toBe(1);

    const wild = result.cells.get(wid2cid(10155));
    expect(wild).toMatchObject({ type: 6, level: 2, provinceid: 5 });

    expect(result.marks).toEqual([{ cid: 1001, type: 2 }]);
  });

  it('collects only type-0 cities within LOADRANGE of the centre', () => {
    const near = parseBlockData(fixture, { x: 1, y: 1 });
    expect(near.cityIdsToLoad).toEqual([1001]);

    // far centre: the city at (1,1) is outside LOADRANGE
    const far = parseBlockData(fixture, { x: 1 + LOADRANGE + 5, y: 1 });
    expect(far.cityIdsToLoad).toEqual([]);
  });

  it('tolerates empty blocks and missing marks', () => {
    const result = parseBlockData([[[0, null]], null], { x: 1, y: 1 });
    expect(result.cells.size).toBe(0);
    expect(result.marks).toEqual([]);
  });
});

describe('parseWorldCityInfo', () => {
  it('maps the detailed city rows with the relationship flag', () => {
    const rows = [
      {
        cid: 1001,
        citytype: 2,
        is_special: 0,
        provinceId: 1,
        cityname: '洛阳',
        uid: 5000,
        username: '玩家A',
        flagchar: 'A',
        union_id: 7,
        unionname: '盟',
        prestige: 120,
        userstate: 0,
        userface: 1,
        usersex: 1,
        flag: 4,
      },
    ];
    const [c] = parseWorldCityInfo(rows);
    expect(c).toMatchObject({
      cid: 1001,
      citytype: 2,
      cityname: '洛阳',
      username: '玩家A',
      unionId: 7,
      unionname: '盟',
      flag: 4,
    });
  });

  it('keeps a null unionname blank', () => {
    const [c] = parseWorldCityInfo([{ cid: 1, unionname: null }]);
    expect(c?.unionname).toBe('');
  });
});

describe('parseWorldFieldInfo', () => {
  it('parses a field row', () => {
    const data = [
      {
        wid: 11,
        type: 6,
        ownercid: 1001,
        province: 1,
        level: 2,
        uid: 5000,
        cityname: '据点',
        username: '玩家A',
        prestige: 50,
        union_id: 7,
        unionname: '盟',
      },
    ];
    expect(parseWorldFieldInfo(data)).toMatchObject({
      wid: 11,
      type: 6,
      level: 2,
      username: '玩家A',
      unionId: 7,
    });
  });

  it('returns null for empty flatland', () => {
    expect(parseWorldFieldInfo([null])).toBeNull();
    expect(parseWorldFieldInfo([])).toBeNull();
  });
});

describe('parseMapCity', () => {
  it('maps the famous-city overview rows', () => {
    const rows = [
      { name: '洛阳', cid: 215265, type: 4, ownername: '盟主', union_name: '天下盟' },
      { name: '许昌', cid: 100100, type: 3, ownername: null, union_name: null },
    ];
    const cities = parseMapCity(rows);
    expect(cities[0]).toEqual({
      cid: 215265,
      name: '洛阳',
      type: 4,
      ownername: '盟主',
      unionName: '天下盟',
    });
    expect(cities[1]?.ownername).toBe('');
    expect(cities[1]?.unionName).toBe('');
  });
});

describe('parseActionField', () => {
  it('drops -1 wids and converts the rest to cids', () => {
    const { type, cids } = parseActionField([1, [-1, 11, -1, 12]]);
    expect(type).toBe(1);
    expect(cids).toEqual([wid2cid(11), wid2cid(12)]);
  });

  it('handles the no-event sentinel', () => {
    expect(parseActionField([0, [-1]])).toEqual({ type: 0, cids: [] });
  });
});

describe('parseUserFields', () => {
  it('converts the player field wids to cids', () => {
    expect(parseUserFields([[{ wid: 11 }, { wid: 12 }]])).toEqual([wid2cid(11), wid2cid(12)]);
  });

  it('is empty when the player owns no fields', () => {
    expect(parseUserFields([[]])).toEqual([]);
  });
});

describe('parseFavouritesList', () => {
  it('parses cities and favourites with [x,y] labels', () => {
    const data = [
      [{ cid: 1001, name: '主城' }],
      [{ id: 3, cid: 215265, name: '洛阳', comments: '主攻目标' }],
    ];
    const { cities, targets } = parseFavouritesList(data);
    expect(cities[0]).toEqual({ cid: 1001, name: '主城', location: '[1,1]' });
    expect(targets[0]).toEqual({
      id: 3,
      cid: 215265,
      name: '洛阳',
      comments: '主攻目标',
      location: makeCid(215265),
    });
  });

  it('defaults a missing comments field to blank', () => {
    const { targets } = parseFavouritesList([[], [{ id: 1, cid: 1001, name: 'x' }]]);
    expect(targets[0]?.comments).toBe('');
  });
});
