import { describe, expect, it } from 'vitest';
import {
  activityPage,
  announcementOpenCommands,
  openAnnouncement,
  parseActivities,
  parseLoginInfo,
  parseProgress,
  parseSignState,
  PROGRESS_COMMANDS,
  safeActivityLink,
  signCalendar,
} from './loginActivity';

describe('login announcement and sign calendar', () => {
  it('reads the legacy announcement plus sign tuple without mutating the reply', () => {
    const payload = [
      { newestreport: '1', maxname: '英雄' },
      [['26', '11', '07', '6'], [{ day: '1106', state: '3' }]],
    ];
    const snapshot = structuredClone(payload);
    const info = parseLoginInfo(payload);
    expect(info.announcement.maxname).toBe('英雄');
    expect(info.sign).toEqual({
      year: 2026,
      month: 11,
      day: 7,
      weekday: 6,
      history: [{ day: '1106', state: 3 }],
    });
    expect(payload).toEqual(snapshot);
  });
  it('does not invent rewards or dates for null/partial responses', () => {
    expect(parseLoginInfo(null)).toEqual({ announcement: {}, sign: null });
    expect(parseSignState([[], []])).toBeNull();
    expect(parseSignState([['26', '02', '30', '1'], []])).toBeNull();
    expect(parseSignState([['26', '13', '01', '1'], []])).toBeNull();
    for (const fields of [
      ['bad', '11', '07', '6'],
      ['26', '11', '07', 'bad'],
      ['26', '11', '07', null],
      ['26', '11', '07', ''],
      ['26', '11', '07', '1.5'],
      ['26', '11', '7.5', '6'],
      ['-1', '11', '07', '6'],
      ['26', '11', '07'],
    ])
      expect(parseSignState([fields, []])).toBeNull();
  });
  it('uses the server date, rolls over the year, and only allows signing today', () => {
    const sign = parseSignState([['27', '01', '01', '5'], [{ day: '1231', state: '7' }]])!;
    const days = signCalendar(sign);
    expect(days).toHaveLength(35);
    expect(days[26]).toMatchObject({ key: '20270101', today: true, state: 99 });
    expect(days[25]).toMatchObject({ key: '20261231', currentMonth: false, state: 7 });
    expect(days.filter((day) => day.state === 99)).toHaveLength(1);
    expect(days[27]?.state).toBe(-1);
  });
  it('keeps leap day and a signed today, without matching another month by day alone', () => {
    const sign = parseSignState([
      ['24', '03', '01', '5'],
      [
        { day: '0301', state: '2' },
        { day: '0229', state: '5' },
        { day: '0202', state: '6' },
      ],
    ])!;
    const days = signCalendar(sign);
    expect(days[25]).toMatchObject({ key: '20240229', state: 5 });
    expect(days[26]).toMatchObject({ key: '20240301', state: 2 });
    expect(days[27]).toMatchObject({ key: '20240302', state: -1 });
    expect(days.filter((day) => day.state === 99)).toHaveLength(0);
  });
});

describe('activity ticker', () => {
  it('validates links and normalizes missing or invalid intervals', () => {
    expect(
      parseActivities([
        { content: '<活动>', link: 'javascript:alert(1)', interval: '-1' },
        { content: '官网', link: ' https://example.org/a?q=1 ', interval: '15' },
      ]),
    ).toEqual([
      { content: '<活动>', link: '', interval: 1 },
      { content: '官网', link: 'https://example.org/a?q=1', interval: 15 },
    ]);
    expect(safeActivityLink('data:text/html,test')).toBe('');
    expect(safeActivityLink('//example.org')).toBe('');
    expect(parseActivities(null)).toEqual([]);
  });
  it('cycles six-entry pages and uses the last entry interval', () => {
    const rows = parseActivities(
      Array.from({ length: 8 }, (_, i) => ({ content: String(i), interval: i + 1 })),
    );
    expect(activityPage(rows, 0).map((row) => row.content)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(activityPage(rows, 1).map((row) => row.content)).toEqual(['6', '7', '0', '1', '2', '3']);
    expect(activityPage(rows, 1).at(-1)?.interval).toBe(4);
    expect(activityPage([], 1)).toEqual([]);
    expect(activityPage(rows.slice(0, 2), 3)).toHaveLength(2);
  });
});

describe('epic progress', () => {
  it('preserves server counters and computes percentage from numeric strings', () => {
    expect(
      parseProgress([
        { tid: '11001', name: '黄巾', maxvalue: '300', curvalue: '100', remainvalue: '200' },
      ])[0],
    ).toEqual({
      tid: 11001,
      name: '黄巾',
      maxvalue: 300,
      curvalue: 100,
      remainvalue: 200,
      percent: '33.33%',
    });
  });
  it('handles empty progress and zero targets without NaN or Infinity', () => {
    expect(parseProgress(null)).toEqual([]);
    expect(parseProgress([{ maxvalue: '0', curvalue: '0' }])[0]?.percent).toBe('0.00%');
    expect(parseProgress([{ maxvalue: '2', curvalue: '3' }])[0]).toMatchObject({
      remainvalue: -1,
      percent: '150.00%',
    });
  });
  it('matches original rank action names and zero-based group counts', () => {
    expect(PROGRESS_COMMANDS.huangjin.action).toBe('rank3');
    expect(PROGRESS_COMMANDS.huangjin.command).toBe('getHuangJinProgress');
    expect(PROGRESS_COMMANDS.huangjin.tabs).toHaveLength(4);
    expect(PROGRESS_COMMANDS.dongzhuo.action).toBe('rank4');
    expect(PROGRESS_COMMANDS.dongzhuo.command).toBe('getDongZhuoProgress');
    expect(PROGRESS_COMMANDS.dongzhuo.tabs).toHaveLength(6);
  });
});

describe('announcement lifecycle compatibility', () => {
  it('auto-opens for an existing role, skips first-time roles, and honors explicit host suppression', () => {
    expect(openAnnouncement(true, false)).toBe(true);
    expect(openAnnouncement(true, true)).toBe(false);
    expect(openAnnouncement(false, false)).toBe(false);
  });
  it('completes task 292 on manual entry, while automatic open/close never does', () => {
    expect(announcementOpenCommands(true)).toEqual(['getLoginInfo', 'finishOpenAnnounce']);
    expect(announcementOpenCommands(false)).toEqual(['getLoginInfo']);
  });
});
