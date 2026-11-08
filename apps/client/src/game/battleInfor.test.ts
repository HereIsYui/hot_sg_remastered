import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  makeNewsTime,
  parseBattleInforReply,
  parseBattleNewsReply,
  parseBattleTaskRows,
} from './battleInfor';

setStrings({ _Utils_1: '年', _Utils_2: '月', _Utils_3: '日 ' });

describe('getBattleInfor reply', () => {
  it('shows a min~max people range and the bid image', () => {
    const state = parseBattleInforReply(['官渡之战', 5, 50, 5, '内容', 12, '胜', '败'], 2001);
    expect(state).toEqual({
      name: '官渡之战',
      image: 'images/2001_battle_info.jpg',
      content: '内容',
      difficulty: '5',
      people: '5~50',
      attend: '12',
      winCondition: '胜',
      loseCondition: '败',
    });
  });

  it('shows the bare max when maxpeople equals the level (loose ==)', () => {
    expect(parseBattleInforReply(['a', 1, 1, 1, 'c', 0, 'w', 'l'], 9001).people).toBe('1');
    expect(parseBattleInforReply(['a', 1, 3, 2, 'c', 0, 'w', 'l'], 9001).people).toBe('1~3');
  });
});

describe('getBattleNews reply', () => {
  it('builds the pager rows with own-camp colouring', () => {
    const { items, pageCount } = parseBattleNewsReply(
      [
        2,
        [
          { log_time: 0, content: '开战', unionid: 7 },
          { log_time: 86400, content: '结束', unionid: 8 },
        ],
      ],
      7,
    );
    expect(items).toEqual([
      { time: makeNewsTime(0), evtContent: '开战', color: 8161263 },
      { time: makeNewsTime(86400), evtContent: '结束', color: 16451364 },
    ]);
    expect(pageCount).toBe(1);
  });

  it('rounds the page count up past one full page', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ log_time: i, content: '', unionid: 0 }));
    expect(parseBattleNewsReply([11, rows], 0).pageCount).toBe(2);
  });

  it('formats a unix time as yy年mm月dd日 hh:mm', () => {
    const d = new Date(2026, 10, 8, 9, 7);
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    expect(makeNewsTime(Math.floor(d.getTime() / 1000))).toBe(
      `${pad(2026 - 2000)}年${pad(11)}月${pad(8)}日 ${pad(9)}:${pad(7)}`,
    );
  });
});

describe('getLastMainTask rows', () => {
  it('labels the progress from the goal counts, ---- when uncounted', () => {
    expect(
      parseBattleTaskRows([[{ name: '初战', todo: '攻下据点', count: 3, type: 1, sort: 0 }]]),
    ).toEqual([{ name: '初战', todo: '攻下据点', oklabel: '0/3' }]);
    expect(parseBattleTaskRows([[{ name: 'x', todo: 'y', count: 0 }]])).toEqual([
      { name: 'x', todo: 'y', oklabel: '----' },
    ]);
  });
});
