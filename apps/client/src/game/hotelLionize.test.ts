import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  lionizeAffairs,
  lionizeBravery,
  lionizeCommand,
  lionizeWisdom,
  parseLionizeData,
  type LionizeHero,
} from './hotelLionize';

setStrings({
  Hotel_LionizeDialogSrc_4_1: '断交',
  Hotel_LionizeDialogSrc_5_1: '结交',
  Hotel_LionizeDialogSrc_6_1: '自己人',
  Hotel_LionizeDialogSrc_7_1: '俘虏',
});

const row = {
  hid: '80500',
  npcid: '500',
  name: '赵云',
  npcname: '',
  npcstate: null,
  state: '1',
  friend: '10',
  level: '20',
  command_base: '80',
  command_add_on: '0',
  bravery_base: '95',
  bravery_add: '5',
  bravery_add_on: '0',
  wisdom_base: '70',
  wisdom_add: '0',
  wisdom_add_on: '0',
  affairs_base: '60',
  affairs_add: '0',
  affairs_add_on: '0',
  buf1: '0',
  buf2: '0',
  buf3: '0',
  buf4: '0',
};

describe('hotelLionize', () => {
  it('parses the list, state labels and the persuade flag', () => {
    const { heroes, persuadeClose } = parseLionizeData([[row], [], 1]);
    expect(persuadeClose).toBe(true);
    const h = heroes[0]!;
    expect(h).toMatchObject({ hid: 80500, npcid: 500, name: '赵云', friend: 10, state: 1 });
    // A blank master name / friendship becomes '*'.
    expect(h.npcname).toBe('*');
    expect(h.npcstate).toBe('*');
    expect(h.friendstate).toBe('结交');
    expect(parseLionizeData([]).heroes).toEqual([]);
  });

  it('labels each state', () => {
    const label = (state: number) =>
      parseLionizeData([[{ ...row, state }], [], 0]).heroes[0]!.friendstate;
    expect(label(0)).toBe('断交');
    expect(label(1)).toBe('结交');
    expect(label(2)).toBe('自己人');
    expect(label(3)).toBe('俘虏');
  });

  it('computes the four attributes, counting level and the 25% buffs', () => {
    const h = parseLionizeData([[row], [], 0]).heroes[0]!;
    const now = 1_000_000;
    expect(lionizeCommand(h, now)).toBe(100); // level 20 + command 80
    expect(lionizeBravery(h, now)).toBe(100); // 95 + 5
    expect(lionizeWisdom(h, now)).toBe(70);
    expect(lionizeAffairs(h, now)).toBe(60);

    const buffed: LionizeHero = { ...h, buf1: now + 100, bravery_add_on: 3, buf3: now + 100 };
    expect(lionizeCommand(buffed, now)).toBe(125); // round(100 * 1.25)
    expect(lionizeBravery(buffed, now)).toBe(128); // round(100 * 1.25) + 3
  });
});
