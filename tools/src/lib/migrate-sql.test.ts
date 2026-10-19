import { describe, expect, it } from 'vitest';
import { migrateDump, migrateStatement } from './migrate-sql.ts';

describe('migrateStatement', () => {
  it('converts engines and charsets in table options', () => {
    expect(
      migrateStatement(') ENGINE=MyISAM AUTO_INCREMENT=3 DEFAULT CHARSET=utf8 ROW_FORMAT=FIXED;'),
    ).toBe(') ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;');
    expect(migrateStatement(') ENGINE=MEMORY DEFAULT CHARSET=utf8 COLLATE=utf8_bin;')).toBe(
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;',
    );
  });

  it('keeps non-utf8 charsets', () => {
    expect(migrateStatement(') ENGINE=MyISAM DEFAULT CHARSET=latin1;')).toBe(
      ') ENGINE=InnoDB DEFAULT CHARSET=latin1;',
    );
    expect(migrateStatement("  `ip` char(15) CHARACTER SET ascii NOT NULL DEFAULT '',")).toBe(
      "  `ip` char(15) CHARACTER SET ascii NOT NULL DEFAULT '',",
    );
  });

  it('converts column charsets and collations', () => {
    expect(
      migrateStatement('  `name` char(32) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,'),
    ).toBe('  `name` char(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,');
    expect(migrateStatement('  `name` char(32) CHARACTER SET utf8 NOT NULL,')).toBe(
      '  `name` char(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,',
    );
  });

  it('never touches row data', () => {
    const insert = "INSERT INTO `t` VALUES (1,'ENGINE=MyISAM CHARSET=utf8');";
    expect(migrateStatement(insert)).toBe(insert);
  });
});

describe('migrateDump', () => {
  it('wraps the dump in a loose, single-transaction import', () => {
    const out = migrateDump('/*!40101 SET NAMES utf8 */;');
    expect(out).toContain("SET SESSION sql_mode='';");
    expect(out).toContain('/*!40101 SET NAMES utf8mb4 */;');
    expect(out.trimEnd().endsWith('SET foreign_key_checks=1;')).toBe(true);
  });
});
