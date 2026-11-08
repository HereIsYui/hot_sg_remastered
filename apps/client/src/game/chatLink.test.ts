import { describe, expect, it } from 'vitest';
import {
  appendChatItem,
  armorShowTip,
  CHAT_ITEM_LIMIT,
  decodeChatItems,
  encodeChatItems,
  escapeItemTip,
  parseArmorShowTip,
} from './chatLink';

// The wire form: the title's quotes already passed CTextInput.addItem's `"` → `'` pass.
const TIP =
  "<b><font size='15' color='#0090ff'>名将  (LV. 3)</font></b>\n头饰\n<font color='#00ff00'>攻击 +5</font>\n<image src=images/armor/123.jpg";

describe('CTextInput.addItem', () => {
  it('queues up to three pieces and appends the bracketed name', () => {
    const first = appendChatItem('看这个', [], { sid: 11, name: '青釭剑', tip: TIP });
    expect(first).toEqual({
      text: '看这个【青釭剑】',
      items: [{ sid: 11, name: '青釭剑', tip: TIP }],
    });
    let text = first!.text;
    let items = first!.items;
    for (const sid of [12, 13]) {
      const next = appendChatItem(text, items, { sid, name: `装备${sid}`, tip: TIP });
      text = next!.text;
      items = next!.items;
    }
    expect(items).toHaveLength(CHAT_ITEM_LIMIT);
    expect(text).toBe('看这个【青釭剑】【装备12】【装备13】');
    expect(appendChatItem(text, items, { sid: 14, name: '超限', tip: TIP })).toBeNull();
  });
});

describe('CTextInput.textWithItemTip', () => {
  it('wraps the queued names and appends the escaped tooltip segments', () => {
    const items = [
      { sid: 11, name: '青釭剑', tip: '甲\n乙<丙>丁' },
      { sid: 12, name: '赤兔', tip: '无格式' },
    ];
    const wire = encodeChatItems('看【青釭剑】和【赤兔】', items);
    expect(wire).toBe(
      '看[item=11]【青釭剑】[/item]和[item=12]【赤兔】[/item]' +
        '[tooltip id=11]甲[n]乙[丙]丁[/tooltip] [tooltip id=12]无格式[/tooltip] ',
    );
  });

  it('leaves text without a queued occurrence untouched', () => {
    const wire = encodeChatItems('没有链接', [{ sid: 11, name: '青釭剑', tip: TIP }]);
    expect(wire).toBe('没有链接[tooltip id=11]' + escapeItemTip(TIP) + '[/tooltip] ');
  });
});

describe('ArmorShow.filterTip', () => {
  it('splits links and pulls the tooltips out of a received line', () => {
    const wire =
      '看[item=11]【青釭剑】[/item]和[item=12]【赤兔】[/item]呀' +
      '[tooltip id=11]甲[n]乙[丙]丁[/tooltip] [tooltip id=12]无格式[/tooltip] ';
    const decoded = decodeChatItems(wire);
    expect(decoded.segments).toEqual([
      { text: '看', sid: null },
      { text: '【青釭剑】', sid: 11 },
      { text: '和', sid: null },
      { text: '【赤兔】', sid: 12 },
      // the greedy strip keeps the single space that followed the last segment
      { text: '呀 ', sid: null },
    ]);
    expect(decoded.tips[11]).toBe('甲\n乙<丙>丁');
    expect(decoded.tips[12]).toBe('无格式');
  });

  it('keeps plain lines untouched', () => {
    const decoded = decodeChatItems('普通消息');
    expect(decoded.segments).toEqual([{ text: '普通消息', sid: null }]);
    expect(decoded.tips).toEqual({});
  });

  it('drops an unterminated tooltip segment', () => {
    const decoded = decodeChatItems('坏[tooltip id=1]未闭合');
    expect(decoded.segments).toEqual([{ text: '坏[tooltip id=1]未闭合', sid: null }]);
  });
});

describe('the tooltip wire form', () => {
  it('serializes the ArmorTooltip html the way the AS3 built it', () => {
    const wire = armorShowTip(
      {
        title: '名将  (LV. 3)',
        color: '#0090ff',
        stars: [],
        text: '头饰\n<font color="#00ff00">攻击 +5</font>\n',
      },
      'images/armor/123.jpg',
    );
    expect(wire).toBe(
      "<b><font size='15' color='#0090ff'>名将  (LV. 3)</font></b>\n" +
        "头饰\n<font color='#00ff00'>攻击 +5</font>\n<image src=images/armor/123.jpg",
    );
  });

  it('parses a received tooltip back into the ArmorTip view model', () => {
    const tip = parseArmorShowTip(TIP);
    expect(tip).toEqual({
      title: '名将  (LV. 3)',
      color: '#0090ff',
      stars: ['images/small_star.png', 'images/small_star.png', 'images/small_star.png'],
      text: "头饰\n<font color='#00ff00'>攻击 +5</font>\n",
      image: 'images/armor/123.jpg',
    });
  });

  it('round-trips through the wire form', () => {
    const tip = parseArmorShowTip(
      armorShowTip(
        { title: '方天画戟', color: '#e70303', stars: [], text: '武器\n' },
        'images/armor/9.png',
      ),
    );
    expect(tip).toMatchObject({
      title: '方天画戟',
      color: '#e70303',
      text: '武器\n',
      image: 'images/armor/9.png',
    });
  });

  it('rejects a non-armor tooltip', () => {
    expect(parseArmorShowTip('普通文字')).toBeNull();
  });
});
