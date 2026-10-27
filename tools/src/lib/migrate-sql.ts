/**
 * Rewrites a MySQL 5.x mysqldump of the original database for MySQL 8.4:
 * every table becomes InnoDB (transactions, crash safety), utf8 becomes utf8mb4 and
 * options InnoDB rejects are dropped. The import epilogue also restores the maneuver combat
 * columns required by the production backend but omitted from the shipped PHP dump.
 */
export function migrateStatement(line: string): string {
  if (line.startsWith('INSERT INTO ')) return line;
  // utf8mb4 without an explicit collation defaults to utf8mb4_0900_ai_ci, which is NO PAD;
  // utf8mb4_general_ci keeps the trailing-space semantics of the original utf8_general_ci.
  return line
    .replace(/ENGINE=(MyISAM|MEMORY)\b/g, 'ENGINE=InnoDB')
    .replace(/ ROW_FORMAT=FIXED/g, '')
    .replace(/\bCHARSET=utf8\b(?! COLLATE)/g, 'CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci')
    .replace(/\bCHARSET=utf8\b/g, 'CHARSET=utf8mb4')
    .replace(/\bCOLLATE=utf8_bin\b/g, 'COLLATE=utf8mb4_bin')
    .replace(/\bCOLLATE=utf8_general_ci\b/g, 'COLLATE=utf8mb4_general_ci')
    .replace(
      /\bCHARACTER SET utf8\b(?! COLLATE)/g,
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci',
    )
    .replace(/\bCHARACTER SET utf8\b/g, 'CHARACTER SET utf8mb4')
    .replace(/\bCOLLATE utf8_bin\b/g, 'COLLATE utf8mb4_bin')
    .replace(/\bCOLLATE utf8_general_ci\b/g, 'COLLATE utf8mb4_general_ci')
    .replace(/\bSET NAMES utf8\b/g, 'SET NAMES utf8mb4');
}

export const IMPORT_PROLOGUE = [
  "SET SESSION sql_mode='';",
  'SET NAMES utf8mb4;',
  'SET foreign_key_checks=0;',
  'SET unique_checks=0;',
  'SET autocommit=0;',
].join('\n');

export const IMPORT_EPILOGUE = [
  "ALTER TABLE `mem_maneuver` ADD COLUMN `attackadd` char(255) CHARACTER SET ascii NOT NULL DEFAULT '', ADD COLUMN `resistadd` char(255) CHARACTER SET ascii NOT NULL DEFAULT '', ADD COLUMN `wallhp` bigint NOT NULL DEFAULT 0;",
  'COMMIT;',
  'SET unique_checks=1;',
  'SET foreign_key_checks=1;',
].join('\n');

export function migrateDump(sql: string): string {
  const body = sql.split('\n').map(migrateStatement).join('\n');
  return `${IMPORT_PROLOGUE}\n${body}\n${IMPORT_EPILOGUE}\n`;
}
