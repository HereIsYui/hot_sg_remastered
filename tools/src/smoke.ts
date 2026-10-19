import { LegacyClient } from './lib/legacy-client.ts';
import { log } from './lib/run.ts';

const client = new LegacyClient();

function check(name: string, ok: boolean, detail: unknown): void {
  if (!ok) throw new Error(`${name} failed: ${JSON.stringify(detail).slice(0, 300)}`);
  log('smoke', `ok  ${name}`);
}

const banner = await (await fetch(client.gateway)).text();
check('json gateway reachable', banner.includes('installed correctly'), banner);

const session = await client.login(process.env.HOT_LEGACY_PASSPORT ?? 'changle');
check('Login.doLogin', session.uid > 0 && session.sid > 0, session);

const info = await client.command(session, 'loadUserInfo');
const user = (info[4] as unknown[] | undefined)?.[0] as { uid?: string } | undefined;
check('sendCommand loadUserInfo', info[0] === 1 && Number(user?.uid) === session.uid, info);

const denied = await client.command({ ...session, sid: session.sid + 1 }, 'loadUserInfo');
check('wrong sid is rejected', denied[0] === 0 && denied[1] === 'invalid_user_auth', denied);

const tick = await fetch(`${client.baseUrl}/server/game/cfg_js.php`);
const tickBody = (await tick.text()).replace(/\uFEFF/g, '').trim();
check('cfg_js.php tick runs cleanly', tick.ok && tickBody === '', tickBody);
