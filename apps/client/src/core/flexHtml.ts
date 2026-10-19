/**
 * Converts Flash `htmlText` (font/b/i/u/br/p/a/li/textformat/span, `\n` line breaks) into safe
 * HTML. Text is escaped, unknown tags are dropped with their content kept, and only vetted
 * attribute values are emitted. `<a href="event:x">` (Flash TextEvent.LINK) becomes
 * `<a data-event="x">` for the host component to handle.
 */

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function color(value: string | undefined): string | null {
  const m = value?.trim().match(/^(?:#|0x)?([0-9a-f]{6})$/i);
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

function fontStyle(attrs: Record<string, string>): string {
  const css: string[] = [];
  const c = color(attrs.color);
  if (c) css.push(`color:${c}`);
  if (attrs.size !== undefined && /^\d{1,3}$/.test(attrs.size.trim()))
    css.push(`font-size:${attrs.size.trim()}px`);
  if (attrs.face && /^[\w\s\u4e00-\u9fff,-]+$/.test(attrs.face))
    css.push(`font-family:${attrs.face}`);
  return css.join(';');
}

interface Open {
  name: string;
  close: string;
}

export function flexHtml(src: string | null | undefined): string {
  if (!src) return '';
  let out = '';
  const stack: Open[] = [];
  const text = (t: string) => {
    out += escapeHtml(decode(t)).replace(/\r\n|\r|\n/g, '<br>');
  };
  const open = (name: string, html: string, close: string) => {
    out += html;
    stack.push({ name, close });
  };

  for (const m of src.matchAll(/<(\/?)([a-zA-Z]+)([^>]*)>|<|[^<]+/g)) {
    if (m[2] === undefined) {
      text(m[0]);
      continue;
    }
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((o) => o.name).lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) out += stack.pop()!.close;
      continue;
    }
    const attrs = attributes(m[3] ?? '');
    const selfClosing = /\/\s*$/.test(m[3] ?? '');
    switch (name) {
      case 'br':
        out += '<br>';
        continue;
      case 'b':
      case 'i':
      case 'u':
        open(name, `<${name}>`, `</${name}>`);
        break;
      case 'font': {
        const style = fontStyle(attrs);
        open(name, style ? `<span style="${style}">` : '<span>', '</span>');
        break;
      }
      case 'p': {
        const align = ['left', 'right', 'center', 'justify'].includes(attrs.align ?? '')
          ? attrs.align
          : '';
        open(name, align ? `<div style="text-align:${align}">` : '<div>', '</div>');
        break;
      }
      case 'li':
        open(name, '<div>\u2022 ', '</div>');
        break;
      case 'a': {
        const href = attrs.href ?? '';
        if (href.startsWith('event:')) {
          open(name, `<a data-event="${escapeHtml(href.slice(6))}">`, '</a>');
        } else if (/^https?:\/\//i.test(href)) {
          open(
            name,
            `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`,
            '</a>',
          );
        } else {
          open(name, '<a>', '</a>');
        }
        break;
      }
      default:
        // textformat, span, img and anything else: keep the content only.
        continue;
    }
    if (selfClosing) out += stack.pop()!.close;
  }
  while (stack.length) out += stack.pop()!.close;
  return out;
}
