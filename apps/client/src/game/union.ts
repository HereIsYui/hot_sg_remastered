import { i18n } from '../i18n';

export interface PagedRows<T = Record<string, unknown>> {
  pageCount: number;
  page: number;
  rows: T[];
}

export function pagedRows<T = Record<string, unknown>>(data: unknown): PagedRows<T> {
  const d = Array.isArray(data) ? data : [];
  const rows = Array.isArray(d[2]) ? (d[2] as T[]) : [];
  return { pageCount: Number(d[0] ?? 0), page: Number(d[1] ?? 0), rows };
}

export function unionPositionName(position: number): string {
  return position >= 0 && position <= 5 ? i18n(`_Utils_${position + 11}`) : '';
}

export function unionEventText(data: unknown): string {
  const { rows } = pagedRows(data);
  return rows.map((row) => String(row.content ?? '')).join('\n');
}

export function parseUnionStore(data: unknown): {
  level: number;
  remaining: number;
  items: Record<string, unknown>[];
} {
  const d = Array.isArray(data) ? data : [];
  return {
    level: Number(d[0] ?? 0),
    remaining: Number(d[1] ?? 0),
    items: d.slice(2) as Record<string, unknown>[],
  };
}

export function unionAreaText(rows: unknown): string {
  if (!Array.isArray(rows)) return '';
  return rows
    .map((row) =>
      row && typeof row === 'object'
        ? String((row as Record<string, unknown>).provincejun ?? '')
        : String(row ?? ''),
    )
    .filter(Boolean)
    .join(', ');
}

export function unionReportPageLabel(pageCount: number, page: number): string {
  return pageCount > 0 ? `${page + 1}/${pageCount}` : '0/0';
}
