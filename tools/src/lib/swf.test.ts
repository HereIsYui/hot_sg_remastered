import { describe, expect, it } from 'vitest';
import { buildManifest, groupKey } from './swf.ts';

describe('groupKey', () => {
  it('uses two segments for nested files', () => {
    expect(groupKey('embedded/BloodWar/12.png')).toBe('embedded/BloodWar');
    expect(groupKey('images/hero/a/b.png')).toBe('images/hero');
  });

  it('falls back to the first segment for shallow files', () => {
    expect(groupKey('images/1_battle_info.png')).toBe('images');
    expect(groupKey('readme.txt')).toBe('readme.txt');
  });
});

describe('buildManifest', () => {
  it('aggregates counts and sizes per group', () => {
    const m = buildManifest([
      { path: 'images/a.png', size: 10 },
      { path: 'images/b.png', size: 5 },
      { path: 'swf/skin/1.png', size: 7 },
    ]);
    expect(m.totalFiles).toBe(3);
    expect(m.totalBytes).toBe(22);
    expect(m.groups).toEqual({
      images: { files: 2, bytes: 15 },
      'swf/skin': { files: 1, bytes: 7 },
    });
  });
});
