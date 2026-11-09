import { beforeEach, describe, expect, it } from 'vitest';
import {
  addInform,
  dispatchInform,
  INFORM_COLOR_YELLOW,
  informBarState,
  InformType,
  parseGMSpeek,
  parseInformFrame,
  triggleNext,
} from './informBar';

beforeEach(() => {
  informBarState.queue = [];
  informBarState.current = null;
  informBarState.play = 0;
});

describe('InformBar queue', () => {
  it('plays the first message at once and queues the rest (InformBar.addInform)', () => {
    addInform('一');
    expect(informBarState.current?.str).toBe('一');
    expect(informBarState.current?.scrollTimes).toBe(1);
    expect(informBarState.current?.color).toBe(INFORM_COLOR_YELLOW);
    addInform('二', 3, 65535);
    expect(informBarState.current?.str).toBe('一');
    expect(informBarState.queue).toEqual([{ str: '二', scrollTimes: 3, color: 65535 }]);
  });

  it('keeps a message with an invalid pass count on one pass', () => {
    addInform('x', -5);
    expect(informBarState.current?.scrollTimes).toBe(1);
  });

  it('keeps 0 passes as the Flex repeatCount "forever"', () => {
    addInform('x', 0);
    expect(informBarState.current?.scrollTimes).toBe(0);
  });

  it('ignores empty messages', () => {
    addInform('');
    expect(informBarState.current).toBeNull();
    expect(informBarState.queue).toEqual([]);
  });

  it('triggleNext shifts the queue and hides the empty bar (InformBar.triggleNext)', () => {
    addInform('一');
    addInform('二');
    triggleNext();
    expect(informBarState.current?.str).toBe('二');
    expect(informBarState.play).toBe(2);
    triggleNext();
    expect(informBarState.current).toBeNull();
    expect(informBarState.play).toBe(3);
  });
});

describe('parseInformFrame', () => {
  it('reads the proc 15 item list (objects)', () => {
    expect(
      parseInformFrame([
        { id: 7, type: 1, scrollTimes: 2, color: 65535, msg: '公告' },
        { id: 8, type: 0, msg: '提示' },
      ]),
    ).toEqual([
      { id: 7, type: 1, scrollTimes: 2, color: 65535, msg: '公告' },
      { id: 8, type: 0, scrollTimes: 1, color: 0, msg: '提示' },
    ]);
  });

  it('reads the legacy positional layout [id][type][times][color][len][msg]', () => {
    expect(parseInformFrame([[7, 1, 2, 65535, 6, '公告']])).toEqual([
      { id: 7, type: 1, scrollTimes: 2, color: 65535, msg: '公告' },
    ]);
    expect(parseInformFrame([[7, 1, 2, 65535, '公告']])).toEqual([
      { id: 7, type: 1, scrollTimes: 2, color: 65535, msg: '公告' },
    ]);
  });

  it('unwraps a count / list envelope and reads one bare item', () => {
    const item = { id: 1, type: 1, scrollTimes: 1, color: 16776960, msg: 'hi' };
    expect(parseInformFrame({ informs: [item] })).toEqual([item]);
    expect(parseInformFrame({ items: [item] })).toEqual([item]);
    expect(parseInformFrame(item)).toEqual([item]);
  });

  it('drops junk entries', () => {
    expect(parseInformFrame(null)).toEqual([]);
    expect(parseInformFrame('x')).toEqual([]);
    expect(parseInformFrame([null, 3, {}, { type: 2, msg: '弹窗' }])).toEqual([
      { id: 0, type: 2, scrollTimes: 1, color: 0, msg: '弹窗' },
    ]);
  });
});

describe('parseGMSpeek', () => {
  it('reads the proc 14 row (gm.commands.speak payload)', () => {
    expect(
      parseGMSpeek({ type: 3, fromuid: 0, fromuser: '管理员', touid: 0, touser: '', msg: 'hello' }),
    ).toEqual({
      type: 3,
      fromuid: 0,
      fromuser: '管理员',
      touid: 0,
      touser: '',
      msg: 'hello',
    });
  });

  it('keeps optional scrollTimes / color of a bare sys_inform', () => {
    expect(parseGMSpeek({ type: 1, msg: '公告', scrollTimes: 2, color: 65535 })).toEqual({
      type: 1,
      fromuid: 0,
      fromuser: '',
      touid: 0,
      touser: '',
      msg: '公告',
      scrollTimes: 2,
      color: 65535,
    });
  });

  it('rejects frames without a message', () => {
    expect(parseGMSpeek(null)).toBeNull();
    expect(parseGMSpeek({ type: 3 })).toBeNull();
    expect(parseGMSpeek('nope')).toBeNull();
  });
});

describe('dispatchInform', () => {
  const sink = (seen: string[]) => ({
    scroll: (str: string) => seen.push(`scroll:${str}`),
    popup: (msg: string) => seen.push(`popup:${msg}`),
    tip: (msg: string) => seen.push(`tip:${msg}`),
  });

  it('routes type 1 to the bar, 2 to a popup, 0 to the chat tip', () => {
    const seen: string[] = [];
    dispatchInform(
      { id: 1, type: InformType.Scroll, scrollTimes: 3, color: 1, msg: 'a' },
      sink(seen),
    );
    dispatchInform(
      { id: 2, type: InformType.Popup, scrollTimes: 1, color: 1, msg: 'b' },
      sink(seen),
    );
    dispatchInform(
      { id: 3, type: InformType.Chat, scrollTimes: 1, color: 1, msg: 'c' },
      sink(seen),
    );
    expect(seen).toEqual(['scroll:a', 'popup:b', 'tip:c']);
  });

  it('drops unknown types like the original if/else chain', () => {
    const seen: string[] = [];
    dispatchInform({ id: 4, type: 9, scrollTimes: 1, color: 1, msg: 'd' }, sink(seen));
    expect(seen).toEqual([]);
  });
});
