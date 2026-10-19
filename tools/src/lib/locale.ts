/**
 * Parses the client string table embedded in BloodWar.swf (`utils.LocaleChinese`), read by
 * `utils/Localizator.as`: one `key=value` per line, split at the first `=`, literal `\n` turned
 * into a newline and carriage returns dropped. Later duplicates win, as with the Dictionary.
 */
export function parseLocale(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.replace(/^\uFEFF/, '').split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out[line.slice(0, eq)] = line
      .slice(eq + 1)
      .replace(/\\n/g, '\n')
      .replace(/\r/g, '');
  }
  return out;
}
