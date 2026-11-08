import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  battleInviteChatMessage,
  makeInviteTime,
  memberCountStr,
  parseBattleFieldUsers,
  parseBattleInviteRows,
  parseCancelBattleInviteReply,
  parseInviteBattleUserReply,
} from './battleInvite';

setStrings({
  _Utils_1: '年',
  _Utils_2: '月',
  _Utils_3: '日 ',
  Battle_BattlePanelSrc_3: '我邀请你参加 ',
  Battle_BattlePanelSrc_4: ' 战场，编号 ',
  Battle_BattlePanelSrc_5: '，请到战场邀请里查看。',
});

describe('getBattleFieldUsers', () => {
  it('maps the member and invite rows with the creator flag', () => {
    const { rows, count, isCreator } = parseBattleFieldUsers([
      [
        {
          uid: 1001,
          name: '甲',
          camp: '袁绍',
          herocount: 2,
          state: '已加入',
          cancel: false,
          honour: 120,
        },
        { id: 9, toname: '乙', name: '乙', herocount: 0, state: '邀请中', cancel: true, honour: 0 },
      ],
      1,
      true,
    ]);
    expect(count).toBe(1);
    expect(isCreator).toBe(true);
    expect(rows).toEqual([
      {
        id: 1001,
        name: '甲',
        camp: '袁绍',
        state: '已加入',
        herocount: 2,
        honour: 120,
        cancel: false,
      },
      { id: 9, name: '乙', camp: '', state: '邀请中', herocount: 0, honour: 0, cancel: true },
    ]);
  });
});

describe('memberCountStr', () => {
  it('doubles the cap for the two-side 官渡 field', () => {
    expect(memberCountStr(3, 50, 2001)).toBe('3/100');
    expect(memberCountStr(3, 50, 4001)).toBe('3/50');
  });
});

describe('inviteBattleUser reply', () => {
  it('maps the invited row onto the member grid shape', () => {
    const parsed = parseInviteBattleUserReply([
      1,
      '成功',
      3,
      { id: 9, touid: 1002, name: '乙', herocount: 0, honour: 30, cancel: true, state: '邀请中' },
    ]);
    expect(parsed).toEqual({
      flag: 1,
      message: '成功',
      count: 3,
      row: {
        id: 9,
        name: '乙',
        camp: '',
        state: '邀请中',
        herocount: 0,
        honour: 30,
        cancel: true,
      },
    });
  });

  it('drops the row on failure', () => {
    expect(parseInviteBattleUserReply([0, '失败', 2])).toEqual({
      flag: 0,
      message: '失败',
      count: 2,
      row: null,
    });
  });

  it('builds the private-chat invite line', () => {
    expect(battleInviteChatMessage('官渡之战', 77)).toBe(
      '我邀请你参加 官渡之战 战场，编号 77，请到战场邀请里查看。',
    );
  });
});

describe('cancelBattleInvite reply', () => {
  it('returns the message and the removed id', () => {
    expect(parseCancelBattleInviteReply(['已取消', 9])).toEqual({ message: '已取消', id: 9 });
  });
});

describe('getBattleInvite rows', () => {
  it('maps the invite list and tolerates a missing list', () => {
    const rows = parseBattleInviteRows([
      [{ id: 5, battlename: '官渡之战', fromname: '甲', level: '5', battlefieldid: 77, time: 0 }],
    ]);
    expect(rows).toEqual([
      {
        id: 5,
        battlename: '官渡之战',
        name: '甲',
        level: '5',
        battlefieldid: 77,
        time: makeInviteTime(0),
      },
    ]);
    expect(parseBattleInviteRows([null])).toEqual([]);
    expect(parseBattleInviteRows([])).toEqual([]);
  });
});
