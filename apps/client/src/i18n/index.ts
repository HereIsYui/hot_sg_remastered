/**
 * Client strings (`Global.i18n`), extracted from the original locale bundle into
 * public/assets/lang/<locale>.json by `pnpm legacy:assets`.
 */

let strings: Record<string, string> = {};

export function setStrings(table: Record<string, string>): void {
  strings = table;
}

export async function loadStrings(locale = 'zh_CN'): Promise<void> {
  const url = `${import.meta.env.BASE_URL}assets/lang/${locale}.json`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      setStrings((await res.json()) as Record<string, string>);
      return;
    }
  } catch {
    // reported below
  }
  console.warn(`missing ${url}; run "pnpm legacy:assets"`);
}

/** The original returns null for unknown keys; an empty string keeps labels blank the same way. */
export function i18n(key: string): string {
  return strings[key] ?? '';
}

/** `mx.utils.StringUtil.substitute`: replaces `{0}`, `{1}`, ... with the arguments. */
export function substitute(template: string, ...args: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (all, i: string) =>
    Number(i) < args.length ? String(args[Number(i)]) : all,
  );
}
