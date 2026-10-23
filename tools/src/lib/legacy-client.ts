/**
 * Minimal client for the legacy amfphp JSON gateway (server/amfphp/json.php), which accepts
 * the same argument array the Flash client sends over AMF as a JSON POST body.
 */
export class LegacyClient {
  readonly baseUrl: string;
  /** Must equal mem_state.value where state=3 in the shipped save, or doLogin rejects the client. */
  readonly clientVersion: string;

  constructor(
    baseUrl = process.env.HOT_LEGACY_URL ?? 'http://127.0.0.1:8090',
    clientVersion = process.env.HOT_LEGACY_VERSION ?? '1121',
  ) {
    this.baseUrl = baseUrl;
    this.clientVersion = clientVersion;
  }

  get gateway(): string {
    return `${this.baseUrl}/server/amfphp/json.php`;
  }

  async call<T = unknown>(service: string, args: unknown[], rng?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (rng) headers['X-Difftest-Rng'] = rng;
    const res = await fetch(`${this.gateway}/${service}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${service}: HTTP ${res.status}`);
    return parseGatewayResponse<T>(service, text);
  }

  /**
   * An amfphp service method whose PHP signature takes SPREAD positional arguments (e.g.
   * `ExternService::getTroopMaxTime($x, $y)`), as opposed to the single-`$param`-array convention
   * every Command/Login/CityCommand method uses. The json gateway (Gateway.php) builds the
   * argument list from the URL PATH segments after `Service.method` and appends the raw POST body
   * as one extra trailing argument, so a method expecting N positional args is reached by putting
   * each arg in its own path segment — which is exactly what the Flash client's `CallEvent` did.
   * Each segment is JSON so the gateway's deserializer decodes it back to its real type.
   */
  async callSpread<T = unknown>(service: string, args: unknown[], rng?: string): Promise<T> {
    const path = args.map((a) => encodeURIComponent(JSON.stringify(a))).join('/');
    const url = path ? `${this.gateway}/${service}/${path}` : `${this.gateway}/${service}`;
    const headers: Record<string, string> = {};
    if (rng) headers['X-Difftest-Rng'] = rng;
    const res = await fetch(url, { method: 'POST', headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`${service}: HTTP ${res.status}`);
    return parseGatewayResponse<T>(service, text);
  }

  async login(passport: string, passtype = 'testpassport'): Promise<LegacySession> {
    const ret = await this.call<unknown[]>('Login.doLogin', [
      this.clientVersion,
      0,
      passtype,
      passport,
    ]);
    if (ret[0] !== 1) throw new Error(`login failed: ${JSON.stringify(ret)}`);
    return { uid: Number(ret[2]), sid: Number(ret[3]) };
  }

  command(session: LegacySession, func: string, ...args: unknown[]): Promise<unknown[]> {
    return this.call<unknown[]>('Command.sendCommand', [
      session.uid,
      session.sid,
      2,
      0,
      func,
      ...args,
    ]);
  }
}

export interface LegacySession {
  uid: number;
  sid: number;
}

/** Strips UTF-8 BOMs that legacy includes emit before the JSON payload. */
export function parseGatewayResponse<T>(service: string, text: string): T {
  const body = text.replace(/^(\uFEFF)+/, '').trim();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${service}: non-JSON response: ${body.slice(0, 300)}`);
  }
}
