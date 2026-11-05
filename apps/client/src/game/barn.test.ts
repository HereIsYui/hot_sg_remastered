import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { barnHolePearls, holeAction, horseStrongCheck, parseZuojiArmor } from './barn';

describe('parseZuojiArmor', () => {
  it('parses holes, pearls and the image name', () => {
    const a = parseZuojiArmor({
      sid: '900501',
      gid: '512',
      image: '0',
      id: '80',
      embed_holes: '0,0,3,3,3',
      embed_pearls: '502,0,0,0,0',
    });
    expect(a.sid).toBe(900501);
    expect(a.gid).toBe(512);
    expect(a.image).toBe('images/armor/80.png'); // image 0 falls back to id
    expect(a.holes).toEqual([0, 0, 3, 3, 3]);
    expect(a.pearls).toEqual([502, 0, 0, 0, 0]);
  });

  it('prefers a positive image over the id', () => {
    const a = parseZuojiArmor({
      sid: '1',
      image: '77',
      id: '80',
      embed_holes: '',
      embed_pearls: '',
    });
    expect(a.image).toBe('images/armor/77.png');
  });
});

describe('barnHolePearls', () => {
  it('returns five zeros with no armor', () => {
    expect(barnHolePearls(null)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('holeAction', () => {
  const armor = parseZuojiArmor({
    sid: '1',
    embed_holes: '0,0,3,3,3',
    embed_pearls: '502,0,0,0,0',
  });

  it('unlades a filled hole, returning its pearl gid', () => {
    expect(holeAction(armor, 0)).toEqual({ kind: 'unlade', gid: 502 });
  });
  it('embeds into an empty open hole', () => {
    expect(holeAction(armor, 1)).toEqual({ kind: 'embed' });
  });
  it('does nothing on a sealed hole', () => {
    expect(holeAction(armor, 2)).toEqual({ kind: 'none' });
  });
  it('does nothing without an armor', () => {
    expect(holeAction(null, 0)).toEqual({ kind: 'none' });
  });
});

describe('horseStrongCheck', () => {
  beforeAll(() => {
    setStrings({
      Barn_NoHorse: '没马',
      Barn_Remind_3: '满级',
      Barn_NoStrongGoods: '缺甘草',
      Barn_NoHighStrongGoods: '缺高级甘草',
      Barn_Remind_1: '升到%d可能失败',
      Barn_Remind_2: '升到%d可能归零',
    });
  });
  const at = (strong_level: number) => ({ sid: 1, strong_level });

  it('blocks without a mount, at max level or without the right stone', () => {
    expect(horseStrongCheck(null, 1, 1)).toEqual({ block: '没马' });
    expect(horseStrongCheck(at(15), 1, 1)).toEqual({ block: '满级' });
    expect(horseStrongCheck(at(9), 0, 1)).toEqual({ block: '缺甘草' });
    expect(horseStrongCheck(at(10), 1, 0)).toEqual({ block: '缺高级甘草' });
  });

  it('confirms risky levels', () => {
    expect(horseStrongCheck(at(2), 1, 0)).toBeNull();
    expect(horseStrongCheck(at(3), 1, 0)).toEqual({ confirm: '升到4可能失败' });
    expect(horseStrongCheck(at(6), 1, 0)).toEqual({ confirm: '升到7可能归零' });
  });
});
