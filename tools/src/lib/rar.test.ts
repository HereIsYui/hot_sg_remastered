import { describe, expect, it } from 'vitest';
import { findRarOffset, isWantedEntry } from './rar.ts';

describe('findRarOffset', () => {
  it('finds a RAR4 signature after an SFX stub', () => {
    const buf = Buffer.concat([
      Buffer.alloc(100, 0x4d),
      Buffer.from('Rar!\x1a\x07\x00', 'latin1'),
      Buffer.alloc(10),
    ]);
    expect(findRarOffset(buf)).toBe(100);
  });

  it('finds a RAR5 signature', () => {
    const buf = Buffer.concat([Buffer.alloc(7), Buffer.from('Rar!\x1a\x07\x01\x00', 'latin1')]);
    expect(findRarOffset(buf)).toBe(7);
  });

  it('returns -1 when absent', () => {
    expect(findRarOffset(Buffer.from('MZ just an exe'))).toBe(-1);
  });
});

describe('isWantedEntry', () => {
  it.each([
    ['APMServ5.2.6/www/htdocs/BloodWar.swf', true],
    ['APMServ5.2.6\\www\\htdocs\\server\\lang.php', true],
    ['APMServ5.2.6/MySQL5.1/data/bloodwar/sys_user.MYD', true],
    ['APMServ5.2.6/[2]热血三国后台5.04.12.exe', true],
    ['APMServ5.2.6/config.ini', true],
    ['APMServ5.2.6/Apache/bin/httpd.exe', false],
    ['APMServ5.2.6/www/phpMyAdmin/index.php', false],
    ['APMServ5.2.6', false],
    ['other/file.txt', false],
  ])('%s -> %s', (name, expected) => {
    expect(isWantedEntry(name)).toBe(expected);
  });
});
