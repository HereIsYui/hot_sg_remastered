import { describe, expect, it } from 'vitest';
import { clientCalls, phaseForPackage, stringLiterals, uiKind } from './as3.ts';
import { cell, table } from './markdown.ts';
import { commandKind, moduleForFile, parseFunctionDefs, parseOpenfunc } from './php.ts';
import { countRows, parseGlossary, parseSchema, tablePrefix } from './schema.ts';

describe('php', () => {
  it('parses the openfunc whitelist', () => {
    const src = `<?php\n$GLOBALS['openfunc']=array('sendCommand','getCityInfo', 'useGoods'\n,"dismissHero");\n`;
    expect(parseOpenfunc(src)).toEqual(['sendCommand', 'getCityInfo', 'useGoods', 'dismissHero']);
  });

  it('parses function declarations with line numbers', () => {
    const src =
      '<?php\nfunction a($uid,$cid,$param){}\nif (1) { function b($uid, $param = array()) {} }\n';
    expect(parseFunctionDefs(src, 'X.php')).toEqual([
      { name: 'a', params: ['$uid', '$cid', '$param'], file: 'X.php', line: 2 },
      { name: 'b', params: ['$uid', '$param'], file: 'X.php', line: 3 },
    ]);
  });

  it('tags class methods and ignores comments, strings and closures', () => {
    const src = [
      '<?php',
      'class Svc {',
      '  function m($x) { $s = "function fake() {"; $f = function($y) {}; }',
      '}',
      '//function commented($uid,$param)',
      '/* function blocked($uid,$param) { */',
      "$q = 'class Nope {';",
      'function after($uid,$param) {}',
    ].join('\n');
    expect(parseFunctionDefs(src, 'S.php')).toEqual([
      { name: 'm', params: ['$x'], file: 'S.php', line: 3, className: 'Svc' },
      { name: 'after', params: ['$uid', '$param'], file: 'S.php', line: 8 },
    ]);
  });

  it('derives the dispatcher from arity', () => {
    expect(commandKind(['$uid', '$cid', '$param'])).toBe('dialog');
    expect(commandKind(['$uid', '$param'])).toBe('global');
    expect(commandKind(['$param'])).toBe('other');
  });

  it('maps files onto planned modules', () => {
    expect(moduleForFile('GoodsFunc.php')).toBe('item');
    expect(moduleForFile('BattleNetFunc.php')).toBe('drop');
    expect(moduleForFile('51utils.php')).toBe('drop');
    expect(moduleForFile('tempaaa/x/Command.php')).toBe('drop');
    expect(moduleForFile('Mystery.php')).toBe('unknown');
  });
});

describe('as3', () => {
  it('finds command calls', () => {
    const src = `Global.cmd.sendDialogCommand("recruitHero",Define.ID,1);\n(Global.cmd as Command).sendGlobalCommand("city","getCityInfo",a);`;
    expect(clientCalls(src)).toEqual([
      { func: 'getCityInfo', kind: 'global', module: 'city' },
      { func: 'recruitHero', kind: 'dialog' },
    ]);
  });

  it('collects string literals', () => {
    expect([...stringLiterals('x("a_b", "c d", "e")')]).toEqual(['a_b', 'e']);
  });

  it('recognises hand-written UI classes only', () => {
    expect(uiKind('HotelDialog.as')).toBe('Dialog');
    expect(uiKind('CityPanel.as')).toBe('Panel');
    expect(uiKind('_Hotel_RumorDialogWatcherSetupUtil.as')).toBeNull();
    expect(uiKind('BattleWaitDialog__embed_mxml__images_title_png_1.as')).toBeNull();
    expect(uiKind('Command.as')).toBeNull();
  });

  it('maps packages to phases', () => {
    expect(phaseForPackage('Hotel')).toBe(4);
    expect(phaseForPackage('')).toBe(2);
    expect(phaseForPackage('Adult')).toBe('drop');
    expect(phaseForPackage('Mystery')).toBe('unknown');
  });
});

describe('schema', () => {
  const dump = [
    'CREATE TABLE `sys_city` (',
    "  `cid` int(11) NOT NULL AUTO_INCREMENT COMMENT '城池ID',",
    "  `name` char(30) NOT NULL DEFAULT '',",
    '  `rank` tinyint(4) unsigned DEFAULT NULL,',
    '  PRIMARY KEY (`cid`),',
    '  KEY `name` (`name`) USING BTREE',
    ") ENGINE=MyISAM AUTO_INCREMENT=3 DEFAULT CHARSET=utf8 COMMENT='玩家拥有的所有城市';",
    "INSERT INTO `sys_city` VALUES (1,'a(b),c;',NULL),(2,'it\\'s',3);",
    "INSERT INTO `sys_city` VALUES (3,'x',1);",
  ].join('\n');

  it('parses tables, columns and keys', () => {
    const [t] = parseSchema(dump);
    expect(t).toMatchObject({
      name: 'sys_city',
      engine: 'MyISAM',
      charset: 'utf8',
      comment: '玩家拥有的所有城市',
      primaryKey: ['cid'],
      indexes: ['KEY `name` (`name`)'],
    });
    expect(t?.columns).toEqual([
      {
        name: 'cid',
        type: 'int(11)',
        nullable: false,
        default: null,
        extra: 'AUTO_INCREMENT',
        comment: '城池ID',
      },
      { name: 'name', type: 'char(30)', nullable: false, default: "''", extra: '', comment: '' },
      {
        name: 'rank',
        type: 'tinyint(4) unsigned',
        nullable: true,
        default: 'NULL',
        extra: '',
        comment: '',
      },
    ]);
  });

  it('counts rows across inserts, ignoring parentheses inside strings', () => {
    expect(countRows(dump).get('sys_city')).toBe(3);
  });

  it('parses the glossary', () => {
    const g = parseGlossary('cfg_building建筑\nsys_goods 玩家拥有的宝物\n\n');
    expect(g.get('cfg_building')).toBe('建筑');
    expect(g.get('sys_goods')).toBe('玩家拥有的宝物');
  });

  it('groups by prefix', () => {
    expect(tablePrefix('mem_world')).toBe('mem');
    expect(tablePrefix('adm_goods_request')).toBe('other');
  });
});

describe('markdown', () => {
  it('escapes pipes and newlines', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(table(['x'], [[1]])).toBe('| x |\n|---|\n| 1 |');
  });
});
