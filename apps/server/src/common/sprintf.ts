/** The subset of PHP sprintf used by lang.php texts: %s, %d, %% and positional %1$s. */
export function sprintf(format: string, ...args: unknown[]): string {
  let next = 0;
  return format.replace(/%(?:(\d+)\$)?([sd%])/g, (_, pos: string | undefined, spec: string) => {
    if (spec === '%') return '%';
    const value = pos ? args[Number(pos) - 1] : args[next++];
    if (spec === 'd') return String(Math.trunc(Number(value) || 0));
    return value === undefined || value === null ? '' : String(value);
  });
}
