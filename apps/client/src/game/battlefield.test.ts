import { describe, expect, it } from 'vitest';
import {
  battleGridPos,
  buildFiledViewRows,
  callArmyPreview,
  campaignFoodUse,
  campaignSoldierBlocked,
  joinBattleStateText,
  maxCampaignSoldierLimit,
  parseBattleFieldState,
  parseCallArmyReply,
  parseEnterBattle,
  parseFieldSnapshot,
  parseHallReply,
  parsePVPBattleInfo,
  parseRefreshUserBattleState,
  parseSoldierPairs,
  parseUserBattleState,
  quitResultText,
  reinforceAvailable,
  soldiersString,
  soldierPeopleOf,
  startBattleTroopArgs,
} from './battlefield';

describe('battlefield layout', () => {
  it('places the iso grid cells like BattlePanel.createGrid', () => {
    // xy 0: j=0,i=0 → x = 370 - 27, y = -80 - 12
    expect(battleGridPos(0)).toEqual({ x: 343, y: -92 });
    // xy 31: j=1,i=1 → x = 370 + 0 - 27, y = -80 + 2*13 - 12
    expect(battleGridPos(31)).toEqual({ x: 343, y: -66 });
    // xy 2: j=2,i=0 → x = 370 + 2*27 - 27, y = -80 + 2*13 - 12
    expect(battleGridPos(2)).toEqual({ x: 397, y: -66 });
  });
});

describe('soldiers strings', () => {
  it('parses the leading count and drops zero rows (parseSoldier)', () => {
    expect(parseSoldierPairs('2,1,100,3,5')).toEqual([
      { sid: 1, count: 100 },
      { sid: 3, count: 5 },
    ]);
    expect(parseSoldierPairs('3,1,100,0,0,3,5')).toEqual([
      { sid: 1, count: 100 },
      { sid: 3, count: 5 },
    ]);
    expect(parseSoldierPairs('1,7,0')).toEqual([]);
    expect(parseSoldierPairs('')).toEqual([]);
    expect(parseSoldierPairs(null)).toEqual([]);
  });

  it('counts heads (getSoldierPeople)', () => {
    expect(soldierPeopleOf('2,1,100,3,50')).toBe(150);
    expect(soldierPeopleOf('')).toBe(0);
  });

  it('builds the N-prefixed startBattleTroop payload (startTroop)', () => {
    expect(
      soldiersString([
        { sid: 1, takecount: 100 },
        { sid: 2, takecount: 0 },
        { sid: 3, takecount: 5 },
      ]),
    ).toBe('2,1,100,3,5');
    expect(soldiersString([{ sid: 1, takecount: 0 }])).toBe('0');
  });

  it('assembles the startBattleTroop args', () => {
    expect(startBattleTroopArgs(209355, 80213, [{ sid: 9, takecount: 2 }], true, 407)).toEqual([
      209355,
      80213,
      '1,9,2',
      true,
      407,
    ]);
  });
});

describe('state snapshots', () => {
  it('reads the hall reply of getBattleInfo', () => {
    const parsed = parseHallReply(['7', 0, [{ id: 1001, type: '0' }], 0, 0, 2, 5]);
    expect(parsed).toEqual({
      version: 7,
      flag: 0,
      battles: [{ id: 1001, type: 0, state: 0, hasBattleAct: false, canCreate: false }],
      todayWarCount: 2,
    });
  });

  it('reads the hall shape of getUserBattleState with the tail fields', () => {
    const parsed = parseUserBattleState(['7', 0, [], 0, 0, 0, 5, 1, 0]);
    expect(parsed).toEqual({
      kind: 'hall',
      hasBattle: 0,
      state: { version: 7, flag: 0, battles: [], todayWarCount: 0, netLevel: 1, waitingBid: 0 },
    });
  });

  it('reads the field shape of getUserBattleState', () => {
    const battle = {
      bid: 1001,
      battlefieldid: 3,
      unionid: 1,
      state: '0',
      endtime: 900,
      honour: 5,
      level: '1',
      name: '黄巾之乱',
    };
    const parsed = parseUserBattleState([
      '7',
      1,
      0,
      battle,
      [{ cid: 1, xy: 2, flag: 5, flagchar: '' }],
      [{ id: 11, cid: 1, targetcid: 2, state: 4 }],
      [{ xy: 407, name: '起点' }],
      1,
    ]);
    expect(parsed.kind).toBe('field');
    if (parsed.kind === 'field') {
      expect(parsed.state.battle.bid).toBe(1001);
      expect(parsed.state.battle.level).toBe(1);
      expect(parsed.state.cities).toHaveLength(1);
      expect(parsed.state.troops[0]?.id).toBe(11);
      expect(parsed.state.startCityInfo).toEqual([{ xy: 407, name: '起点' }]);
    }
  });

  it('parses the field snapshot with the winpoint tail when the bid carries one', () => {
    const parsed = parseFieldSnapshot(
      [{ bid: 2001 }, [], [], [], [{ point: 100, pointname: '军粮', totalpoint: 1000 }]],
      true,
    );
    expect(parsed.winpoints).toEqual([{ point: 100, pointname: '军粮', totalpoint: 1000 }]);
  });

  it('reads refreshUserBattleState in and out of battle', () => {
    expect(parseRefreshUserBattleState([0])).toEqual({ kind: 'out' });
    const parsed = parseRefreshUserBattleState([1, { bid: 3001 }, [], [], []]);
    expect(parsed.kind).toBe('field');
  });

  it('reads the enter-battle reply with the 2001/7001 winpoint tail', () => {
    const plain = parseEnterBattle([{ bid: 1001 }, [], [], []]);
    expect(plain.winpoints).toBeNull();
    const win = parseEnterBattle([{ bid: 7001 }, [], [], [], [{ point: 1 }]]);
    expect(win.winpoints).toEqual([{ point: 1 }]);
  });

  it('parses getBattleFieldState', () => {
    const parsed = parseBattleFieldState([
      '虎牢关',
      367,
      [{ id: 5 }],
      [{ cid: 367, xy: 8, flag: 3, flagchar: '', name: '虎牢关', image: 1 }],
      [{ id: 9 }],
      1,
      true,
      false,
    ]);
    expect(parsed.cityname).toBe('虎牢关');
    expect(parsed.cid).toBe(367);
    expect(parsed.troops).toEqual([{ id: 5 }]);
    expect(parsed.cities[0]?.cid).toBe(367);
    expect(parsed.myTroops[0]?.id).toBe(9);
    expect(parsed.canAddArmy).toBe(true);
    expect(parsed.canQuest).toBe(true);
    expect(parsed.enableQuest).toBe(false);
  });
});

describe('BattleFiledViewDialog.resetData', () => {
  const info = [
    { battleunionid: 1, can_chat: '1', enable_chat: '1', no_attack: '0', name: '队友' },
    { battleunionid: 2, can_chat: '0', enable_chat: '0', no_attack: '0', name: '敌军' },
    { battleunionid: 2, can_chat: '0', enable_chat: '0', no_attack: '1', name: '不可攻击' },
  ];

  it('gates the row ops by union and the selected troop position', () => {
    const { rows, canSend } = buildFiledViewRows(info, 1, 367, 367);
    expect(rows[0]).toMatchObject({
      canAttack: false,
      canChat: true,
      canView: true,
      canPatrol: false,
    });
    // standing on the 据点 itself: 详情 opens for every row there (AS3 `cid == currentTroopCid`)
    expect(rows[1]).toMatchObject({
      canAttack: true,
      canChat: false,
      canView: true,
      canPatrol: false,
    });
    expect(rows[2]).toMatchObject({ canAttack: false, canView: true });
    expect(canSend).toBe(false);
  });

  it('allows 巡逻 when the selected troop stands elsewhere', () => {
    const { rows } = buildFiledViewRows(info, 1, 367, 100);
    expect(rows[1]?.canPatrol).toBe(true);
    // 详情 opens for the own camp's rows even from afar; enemy rows stay shut
    expect(rows[0]?.canView).toBe(true);
    expect(rows[1]?.canView).toBe(false);
  });
});

describe('出征配兵', () => {
  it('caps by 校场 and battlefield level (getMaxSoldierLimit)', () => {
    // 校场 1 → 10000 heads; level 5 cap 10000; no flags
    expect(maxCampaignSoldierLimit(1, false, 0, { bid: 1001, level: 5 })).toBe(10000);
    // 校场 1 + 军旗 25% → 12500, level 5 cap 10000*1.25 = 12500
    expect(maxCampaignSoldierLimit(1, true, 0, { bid: 1001, level: 5 })).toBe(12500);
    // 名城 type 4 +100%: 20000 vs level-5 cap 10000 → 10000
    expect(maxCampaignSoldierLimit(1, false, 4, { bid: 1001, level: 5 })).toBe(10000);
    // 千里走单骑 level 1: cap 1000-2 = 998
    expect(maxCampaignSoldierLimit(5, false, 0, { bid: 5001, level: 1 })).toBe(998);
  });

  it('blocks sid 9 only in 千里走单骑', () => {
    expect(campaignSoldierBlocked(5001, 9)).toBe(true);
    expect(campaignSoldierBlocked(1001, 9)).toBe(false);
    expect(campaignSoldierBlocked(5001, 1)).toBe(false);
  });

  it('scales the food use to the battle hours (getFoodUse)', () => {
    // 90 minutes ceil to two whole hours
    expect(campaignFoodUse([{ food_use: 2, takecount: 10 }], 90 * 60)).toBe(40);
    // under one hour counts as one
    expect(campaignFoodUse([{ food_use: 2, takecount: 10 }], 100)).toBe(20);
  });
});

describe('调遣援军 (CallArmyDialog)', () => {
  it('caps the call by honour and the battlefield headroom', () => {
    // sid 1 (people 1): honour 1000 → 1000*100/1, headroom 500 → maxCall 500
    expect(callArmyPreview(0, 9999, 1000, 500).maxCall).toBe(500);
    // honour limits first: sid 11 (index 10, people 10) honour 100 → 100*100/10 = 1000
    expect(callArmyPreview(10, 9999, 100, 5000).maxCall).toBe(1000);
  });

  it('figures the honour cost and the 援军令 tier', () => {
    // 10 heads of sid 1 → people 10 → 1 honour; value 22.5*10 = 225 → tier 1
    expect(callArmyPreview(0, 10, 1000, 100)).toMatchObject({ needHonour: 1, yuanjun: 1 });
    // 200 heads of sid 10 (index 9, people 5, value 1000) → 1000 people, 10 honour, value 2e5 → tier 2
    expect(callArmyPreview(9, 200, 10000, 1000)).toMatchObject({ needHonour: 10, yuanjun: 2 });
    // 10000 heads of sid 12 (index 11, people 8, value 2900) → 80000 people, 800 honour, value 2.9e7 → tier 4
    expect(callArmyPreview(11, 10000, 999999, 999999)).toMatchObject({
      needHonour: 800,
      yuanjun: 4,
    });
  });

  it('parses the callArmy reply', () => {
    expect(parseCallArmyReply([1, 7, '1,9,2', 990, 'succ'])).toEqual({
      ok: true,
      troopid: 7,
      soldiers: '1,9,2',
      honour: 990,
      message: 'succ',
    });
    expect(parseCallArmyReply([0, 'fail'])).toMatchObject({ ok: false, message: 'fail' });
  });

  it('computes the reinforce headroom (getReinforceAvailable)', () => {
    expect(reinforceAvailable({ level: 1 }, '1,1,600,3,300')).toBe(100);
    expect(reinforceAvailable({ level: 10 }, '1,1,600,3,300')).toBe(99100);
  });
});

describe('加入场', () => {
  it('parses getPVPBattleInfo with and without the camp list', () => {
    expect(parsePVPBattleInfo([[{ id: 3 }], [{ unionid: 1 }]])).toEqual({
      battles: [{ id: 3 }],
      unions: [{ unionid: 1 }],
    });
    expect(parsePVPBattleInfo([[{ id: 3 }]]).unions).toEqual([]);
  });

  it('maps the instance state text', () => {
    const i18n = (k: string) => `#${k}`;
    expect(joinBattleStateText(0, i18n)).toBe('#Battle_JoinBattleDialogSrc_2');
    expect(joinBattleStateText(3, i18n)).toBe('#Battle_JoinBattleDialogSrc_5');
    expect(joinBattleStateText(9, i18n)).toBe('');
  });
});

describe('退出战场', () => {
  it('formats the getQuitResult texts', () => {
    const i18n = (k: string) => `#${k}`;
    expect(quitResultText(-1, 3, i18n)).toBe('#Battle_BattlePanelSrc_6180#Battle_BattlePanelSrc_7');
    expect(quitResultText(2, 1, i18n)).toBe('#Battle_BattlePanelSrc_8');
    expect(quitResultText(1, 1, i18n)).toBe('#Battle_BattlePanelSrc_9');
    expect(quitResultText(0, 1, i18n)).toBe('#Battle_BattlePanelSrc_10');
  });
});
