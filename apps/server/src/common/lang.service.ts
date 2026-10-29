import { existsSync, readFileSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GameError } from './game-error';
import { sprintf } from './sprintf';

export type LangTable = Record<string, unknown>;

export const LANG_TABLE = Symbol('LANG_TABLE');

export function loadLangTable(file: string): LangTable {
  if (!existsSync(file)) {
    new Logger('LangService').warn(
      `${file} not found, messages fall back to their keys (run "pnpm legacy:lang")`,
    );
    return {};
  }
  return JSON.parse(readFileSync(file, 'utf8')) as LangTable;
}

@Injectable()
export class LangService {
  constructor(@Inject(LANG_TABLE) private readonly table: LangTable) {}

  /** Looks up `group.key` (e.g. `doLogin.server_full`) and applies sprintf arguments. */
  t(key: string, ...args: unknown[]): string {
    let node: unknown = this.table;
    for (const part of key.split('.')) {
      node = node && typeof node === 'object' ? (node as LangTable)[part] : undefined;
    }
    return typeof node === 'string' ? sprintf(node, ...args) : key;
  }

  /** Like `t`, but null for a missing key, as PHP reads an unset `$GLOBALS` entry. */
  tOrNull(key: string): string | null {
    const text = this.t(key);
    return text === key ? null : text;
  }

  /** The raw value of a top-level `$GLOBALS` entry, e.g. `openfunc`. */
  value<T = unknown>(group: string): T | undefined {
    return this.table[group] as T | undefined;
  }

  messageOf(err: unknown): string {
    if (err instanceof GameError) {
      if (!err.key) return err.message;
      // A missing entry reads as PHP's `Exception($GLOBALS[g][k])` with an unset index: notice +
      // null message, which Command.php's catch pushes as an empty string. Existing entries keep
      // their sprintf arguments.
      return this.t(err.key, ...err.args) === err.key ? '' : this.t(err.key, ...err.args);
    }
    return err instanceof Error ? err.message : String(err);
  }
}
