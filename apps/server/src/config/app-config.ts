import { resolve } from 'node:path';
import { z } from 'zod';

const repoRoot = resolve(__dirname, '../../../..');

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().default('mysql://hot:hot@127.0.0.1:3318/bloodwar'),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  /** Generated locally by `pnpm legacy:lang`; original game text is not committed. */
  LANG_FILE: z.string().default(resolve(repoRoot, 'legacy/lang/zh_CN.json')),
  TICK_ENABLED: bool.default(true),
  TICK_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  /** POST /api/debug/tick/:order runs one settlement slot; for the differential tests only. */
  TICK_DEBUG_ENDPOINT: bool.default(false),
  LOG_JSON: bool.default(false),
  /** Server identity and chat endpoints handed to the client by loadGlobalData (config/db.php). */
  SERVER_MARK: z.string().default('hot'),
  SERVER_NAME: z.string().default('hot'),
  CHAT_HOST: z.string().default('127.0.0.1'),
  CHAT_PORT: z.string().default('5308'),
  CHIBI_CHAT_HOST: z.string().default('127.0.0.1'),
  CHIBI_CHAT_PORT: z.string().default('7308'),
});

export type AppConfig = z.infer<typeof schema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
