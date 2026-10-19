/** Client address in the two forms common.php kept: `$GLOBALS['ip']` and `$GLOBALS['sip']`. */
export interface ClientAddress {
  ip: number;
  sip: string;
}

const IPV4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * `common.php` stores the client IPv4 address as `(d << 24) + (c << 16) + (b << 8) + a`
 * (bytes reversed, 64-bit PHP integers); anything else becomes 0.
 */
export function ipToLegacyInt(ip: string | undefined): number {
  const m = IPV4.exec(ip?.trim() ?? '');
  if (!m) return 0;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  return d * 2 ** 24 + c * 2 ** 16 + b * 2 ** 8 + a;
}

export function clientAddress(ip: string | undefined): ClientAddress {
  const raw = ip?.trim() ?? '';
  return { ip: ipToLegacyInt(raw), sip: raw.replace(/^::ffff:(?=\d+\.)/, '') };
}
