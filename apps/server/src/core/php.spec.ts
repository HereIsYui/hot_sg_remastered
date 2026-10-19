import { describe, expect, it } from 'vitest';
import { cid2wid, wid2cid } from './city-rules.service';
import { isActHero, isCardHero } from './hero-rules.service';
import {
  addslashes,
  isPhpNumeric,
  mbStrlen,
  phpEmpty,
  phpFloatString,
  phpIntval,
  phpLooseEquals,
  phpNum,
  phpString,
  phpTrim,
  stripcslashes,
} from './php';
import { phpDate, phpMktime } from './php-time';

describe('php scalars', () => {
  it('converts like PHP', () => {
    expect(phpString(null)).toBe('');
    expect(phpString(false)).toBe('');
    expect(phpString(12)).toBe('12');
    expect(phpTrim('  名字\t\n')).toBe('名字');
    expect(phpTrim('\u3000名字')).toBe('\u3000名字');
    expect(phpIntval(' 12abc')).toBe(12);
    expect(phpIntval('abc')).toBe(0);
    expect(phpIntval(3.9)).toBe(3);
    expect(phpIntval(null)).toBe(0);
  });

  it('treats "0", 0, "" and null as empty', () => {
    for (const v of ['0', 0, '', null, undefined, false, []]) expect(phpEmpty(v)).toBe(true);
    for (const v of ['00', ' ', 'a', 1, [0]]) expect(phpEmpty(v)).toBe(false);
  });

  it('compares loosely', () => {
    expect(phpLooseEquals('1121', 1121)).toBe(true);
    expect(phpLooseEquals('1121', '1121.0')).toBe(true);
    expect(phpLooseEquals('abc', 0)).toBe(true);
    expect(phpLooseEquals('abc', 'ABC')).toBe(false);
    expect(phpLooseEquals(false, 0)).toBe(true);
    expect(phpLooseEquals(null, '')).toBe(true);
    expect(phpLooseEquals(null, '0')).toBe(false);
    expect(phpLooseEquals(undefined, 0)).toBe(true);
    expect(isPhpNumeric('1e3')).toBe(true);
    expect(isPhpNumeric('12 ')).toBe(false);
  });

  it('prints floats with precision 14', () => {
    expect(phpFloatString(0.1 + 0.2)).toBe('0.3');
    expect(phpFloatString(25)).toBe('25');
    expect(phpFloatString(1 / 3)).toBe('0.33333333333333');
    expect(phpFloatString(123456.78901234567)).toBe('123456.78901235');
    expect(phpFloatString(0.00001)).toBe('1.0E-5');
    expect(phpFloatString(1.5e20)).toBe('1.5E+20');
    expect(phpFloatString(-2.5)).toBe('-2.5');
    expect(phpNum('1.5000')).toBe(1.5);
    expect(phpNum(false)).toBe(0);
    expect(phpNum(null)).toBe(0);
  });

  it('counts code points and escapes like mb_strlen / addslashes / stripcslashes', () => {
    expect(mbStrlen('热血三国')).toBe(4);
    expect(addslashes(`a'b"c\\`)).toBe(`a\\'b\\"c\\\\`);
    expect(stripcslashes('a\\r\\nb\\x41\\101\\q\\\\')).toBe('a\r\nbAAq\\');
  });
});

describe('php time (Asia/Shanghai)', () => {
  it('formats and builds timestamps in UTC+8', () => {
    expect(phpDate('Y-m-d H:i:s', 0)).toBe('1970-01-01 08:00:00');
    expect(phpDate('n/j N', 1387090800)).toBe('12/15 7');
    expect(phpMktime(16, 0, 0, 4, 10, 2011)).toBe(1302422400);
    expect(phpMktime(16, 0, 0, 12, 15 + 20, 2013)).toBe(phpMktime(16, 0, 0, 1, 4, 2014));
  });
});

describe('world coordinates', () => {
  it('maps wid and cid both ways', () => {
    expect(wid2cid(244527)).toBe(242457);
    expect(cid2wid(242457)).toBe(244527);
    expect(wid2cid(false)).toBe(0);
  });
});

describe('hero types', () => {
  it('classifies event and card heroes', () => {
    expect(isActHero(1000)).toBe(true);
    expect(isActHero(100)).toBe(false);
    expect(isActHero(undefined)).toBe(false);
    expect(isCardHero(21250)).toBe(true);
  });
});
