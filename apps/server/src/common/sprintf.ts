/** The subset of PHP sprintf used by lang.php texts: %s, %d, %f (with .precision), %% and %1$s. */
export function sprintf(format: string, ...args: unknown[]): string {
  let next = 0;
  return format.replace(
    /%(?:(\d+)\$)?(?:\.(\d+))?([sdf%])/g,
    (_, pos: string | undefined, prec: string | undefined, spec: string) => {
      if (spec === '%') return '%';
      const value = pos ? args[Number(pos) - 1] : args[next++];
      if (spec === 'd') return String(Math.trunc(Number(value) || 0));
      if (spec === 'f') {
        const digits = prec === undefined ? 6 : Number(prec);
        const n = Number(value) || 0;
        // PHP %.0f rounds half away from zero (2.5 -> 3, -2.5 -> -3).
        if (digits === 0) return String((n < 0 ? -1 : 1) * Math.round(Math.abs(n)));
        return n.toFixed(digits);
      }
      return value === undefined || value === null ? '' : String(value);
    },
  );
}
