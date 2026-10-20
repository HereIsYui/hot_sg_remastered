import { describe, expect, it } from 'vitest';
import {
  actMessage,
  parseHotelInfo,
  recruitCommand,
  recruitFace,
  recruitNameColor,
  type HeroRecruit,
} from './hotel';

const row = {
  _explicitType: 'HeroRecruit',
  id: '30231',
  hname: '汲可鹃',
  sex: '0',
  face: '3',
  cid: '209355',
  level: '3',
  affairs_base: '20',
  bravery_base: '30',
  wisdom_base: '40',
  affairs_add: '1',
  bravery_add: '1',
  wisdom_add: '1',
  loyalty: '70',
  gold_need: '3000',
  isActHero: false,
  command_base: '2',
  command_add: '0',
};

describe('hotel', () => {
  it('parses the recruit list, free slots and nobility flag', () => {
    const info = parseHotelInfo([[row], '13', true]);
    expect(info.validPosition).toBe(13);
    expect(info.guanJue).toBe(true);
    expect(info.recruits[0]).toMatchObject({ id: 30231, hname: '汲可鹃', gold_need: 3000 });
    expect(parseHotelInfo([]).recruits).toEqual([]);
  });

  it('colours names by base points', () => {
    const r = parseHotelInfo([[row]]).recruits[0] as HeroRecruit;
    expect(recruitNameColor(r)).toBe(0xffffff);
    expect(recruitNameColor({ ...r, wisdom_base: 60 })).toBe(0xffcc33);
    expect(recruitNameColor({ ...r, wisdom_base: 100 })).toBe(0xcc3333);
    expect(recruitNameColor({ ...r, wisdom_base: 120 })).toBe(0xcc00ff);
    expect(recruitNameColor({ ...r, isActHero: true })).toBe(0x008000);
    expect(recruitCommand(r)).toBe(5);
    expect(recruitFace(r)).toBe('images/hero/hero_girl_3.jpg');
  });

  it('finds the event message at the end of a reply', () => {
    expect(actMessage([{}, {}, [], 1, false, 'MSG_ACTTIP|获得了【乾坤碎片*1】'])).toBe(
      '获得了【乾坤碎片*1】',
    );
    expect(actMessage([{}, {}, [], 1, false])).toBeNull();
    expect(actMessage(['other'])).toBeNull();
  });
});
