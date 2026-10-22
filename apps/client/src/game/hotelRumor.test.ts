import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { parseRumorDetail, parseRumorList } from './hotelRumor';

setStrings({
  Hotel_RumorDialogSrc_1: '据说',
  Hotel_RumorDialogSrc_2: '，字',
  Hotel_RumorDialogSrc_3: '。',
  Hotel_RumorDialogSrc_5: '<br/>',
});

describe('hotelRumor', () => {
  it('parses the rumor list, keeping id/name/type', () => {
    const list = parseRumorList([
      { id: '7', name: '赵云', type: '0', cid: '209355' },
      { id: '8', name: '关羽', type: '0' },
    ]);
    expect(list).toEqual([
      { id: 7, name: '赵云', type: 0 },
      { id: 8, name: '关羽', type: 0 },
    ]);
    expect(parseRumorList([])).toEqual([]);
  });

  it('builds a famous-hero detail with the 字 and location line', () => {
    const d = parseRumorDetail([
      { id: '7', price: '300', type: '0' },
      { name: '赵云', zi: '子龙', introduce: '常山赵子龙' },
      '他在洛阳[10,20]',
      true,
      true,
    ]);
    expect(d).toMatchObject({
      id: 7,
      price: 300,
      type: 0,
      name: '赵云',
      showDetail: true,
      showRecord: true,
    });
    expect(d.description).toBe('据说赵云，字子龙。常山赵子龙<br/><br/>他在洛阳[10,20]');
  });

  it('omits the 字 and location line when absent', () => {
    const d = parseRumorDetail([
      { id: '9', price: '0', type: '0' },
      { name: '无名', zi: '', introduce: '佚名' },
      '',
      false,
      true,
    ]);
    expect(d.description).toBe('据说无名。佚名<br/>');
    expect(d.showDetail).toBe(false);
  });
});
