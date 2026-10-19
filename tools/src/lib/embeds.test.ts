import { describe, expect, it } from 'vitest';
import { buildEmbedIndex, decodeSource, embedSource } from './embeds.ts';
import { parseLocale } from './locale.ts';

describe('embedSource', () => {
  it('extracts the mangled source from embed class names', () => {
    expect(embedSource('LoginDialog__embed_mxml_images_board_login_jpg_1633673007')).toBe(
      'images_board_login_jpg',
    );
    expect(
      embedSource('Login.LoginDialog__embed_css_swf_UIParts_swf_board_listdown_427982019'),
    ).toBe('swf_UIParts_swf_board_listdown');
    expect(embedSource('World.WorldPanel_city5')).toBeNull();
  });
});

describe('decodeSource', () => {
  const files = new Set(['images/achievement/progressSkin.png', 'images/button_red.png']);
  const exists = (p: string) => files.has(p);

  it('prefers a path that exists', () => {
    expect(decodeSource('images_achievement_progressSkin_png', exists)).toBe(
      'images/achievement/progressSkin.png',
    );
    expect(decodeSource('images_button_red_png', exists)).toBe('images/button_red.png');
  });

  it('falls back to the first segment as directory', () => {
    expect(decodeSource('images_board_login_jpg', exists)).toBe('images/board_login.jpg');
  });

  it('drops ../ and decodes swf symbols', () => {
    expect(decodeSource('___images_title_png', exists)).toBe('images/title.png');
    expect(decodeSource('swf_UIParts_swf_board_listdown', exists)).toBe(
      'swf/UIParts.swf#board_listdown',
    );
  });
});

describe('buildEmbedIndex', () => {
  it('maps sources to plain files, bitmap exports and sprite frames', () => {
    const exported = [
      'embedded/BloodWar/847_Login.LoginDialog__embed_mxml_images_board_login_jpg_1633673007.png',
      'embedded/BloodWar/309_World.WorldPanel_city5.png',
      'embedded/BloodWar/12.png',
      'embedded/BloodWar/644_Bar.BottomPanel__embed_css_images_function_friend_png_2142040788.png',
    ];
    const sprite = 'swf/UIParts/sprites/DefineSprite_27_board_listdown/1.png';
    const index = buildEmbedIndex({
      exportedBitmaps: exported,
      embedClasses: [
        'LoginDialog__embed_mxml_images_board_login_jpg_1633673007',
        'LoginDialog__embed_css_images_button_red_png_1958813944',
        'LoginDialog__embed_css_swf_UIParts_swf_board_listdown_427982019',
        'X__embed_css_images_gone_png_1',
      ],
      spriteFrames: [sprite],
      files: new Set([...exported, sprite, 'images/button_red.png', 'images/function_friend.png']),
    });
    expect(index.entries).toEqual({
      'images/board_login.jpg': exported[0],
      'images/button_red.png': 'images/button_red.png',
      'images/function_friend.png': exported[3],
      'swf/UIParts.swf#board_listdown': sprite,
      'symbol:World.WorldPanel_city5': exported[1],
    });
    expect(index.unresolved).toEqual(['images/gone.png']);
  });

  it('names bare exports of shared bitmaps through their symbol classes', () => {
    const shared = 'embedded/BloodWar/12.png';
    const index = buildEmbedIndex({
      exportedBitmaps: [shared],
      bitmapNames: {
        [shared]: [
          'UserInfo.InfoPanel__embed_mxml_images_title_png_1099526159',
          'Mail.MailDialog__embed_mxml_images_title_png_1099526159',
        ],
      },
      embedClasses: ['InfoPanel__embed_mxml_images_title_png_1099526159'],
      spriteFrames: [],
      files: new Set([shared, 'images/title.png']),
    });
    expect(index.entries).toEqual({ 'images/title.png': shared });
  });
});

describe('parseLocale', () => {
  it('splits at the first = and unescapes newlines', () => {
    expect(parseLocale('\uFEFFa=1\r\nb=x=y\nc=line\\nbreak\nnoeq\nb=2')).toEqual({
      a: '1',
      b: '2',
      c: 'line\nbreak',
    });
  });
});
