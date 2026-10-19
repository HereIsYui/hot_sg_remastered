import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { fieldDescription, wid2cid, worldTypeName } from './field';

beforeAll(() => {
  setStrings({
    _Define_5: '草原',
    Government_FieldDetailDialog_18_1: '无',
    Government_FieldDetailDialog_19_1: '筑城',
    Government_FieldDetailDialog_24_1: '粮',
    Government_FieldDetailDialog_25_1: '%',
    Government_FieldDetailDialog_28_1: '湖',
    Government_FieldDetailDialog_29_1: '%',
  });
});

describe('field helpers', () => {
  it('converts world ids to city ids', () => {
    expect(wid2cid(11)).toBe(1001);
    expect(wid2cid(123456)).toBe(125346);
  });

  it('names the terrain', () => {
    expect(worldTypeName(4)).toBe('草原');
    expect(worldTypeName(8)).toBe('');
  });

  it('describes the production bonus', () => {
    expect(fieldDescription(4, 0, 1, 0)).toBe('无');
    expect(fieldDescription(1, 0, 1, 0)).toBe('筑城');
    expect(fieldDescription(4, 3, 1, 0)).toBe('粮5%');
    expect(fieldDescription(6, 3, 1, 60)).toBe('湖17%');
    expect(fieldDescription(6, 3, 2, 60)).toBe('湖14%');
  });
});
