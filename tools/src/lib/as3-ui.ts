/**
 * Extracts the UI structure of decompiled Flex (MXML) components: the `UIComponentDescriptor`
 * tree built in the constructor, data bindings, `StyleManager` declarations and event handler
 * bodies. The result is reference material for porting views; it is not interpreted at runtime.
 */

export type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value } | { $ref: string };

export interface UiNode {
  type: string;
  id?: string;
  props: Record<string, Value>;
  styles: Record<string, Value>;
  events: Record<string, string>;
  children: UiNode[];
}

export interface UiBinding {
  target: string;
  expr: string;
}

export interface UiComponent {
  className: string;
  root: UiNode | null;
  /** `this.x = ...` assignments in the constructor (size, scroll policy, ...). */
  rootProps: Record<string, Value>;
  bindings: UiBinding[];
  styleDeclarations: Record<string, Record<string, Value>>;
  /** Event handler name -> body of the method, trimmed. */
  handlers: Record<string, string>;
}

type Token = { kind: 'str' | 'num' | 'id' | 'punct'; text: string; value?: string | number };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2 || src.length;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : (n ?? '');
          j += 2;
        } else {
          s += src[j++];
        }
      }
      tokens.push({ kind: 'str', text: src.slice(i, j + 1), value: s });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?)/.exec(src.slice(i))!;
      tokens.push({ kind: 'num', text: m[0], value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z0-9_$]+/.exec(src.slice(i))!;
      tokens.push({ kind: 'id', text: m[0] });
      i += m[0].length;
    } else {
      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      const op = ['===', '!=='].includes(three)
        ? three
        : ['==', '!=', '<=', '>=', '&&', '||', '::', '++', '--', '+=', '-='].includes(two)
          ? two
          : c;
      tokens.push({ kind: 'punct', text: op });
      i += op.length;
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private is(text: string, offset = 0): boolean {
    return this.peek(offset)?.text === text;
  }

  private expect(text: string): void {
    const t = this.tokens[this.pos++];
    if (t?.text !== text) throw new Error(`expected ${text}, got ${t?.text ?? 'EOF'}`);
  }

  value(): Value {
    const t = this.peek();
    if (!t) throw new Error('unexpected EOF');
    const next = this.peek(1)?.text;
    const simpleEnd = next === undefined || [',', '}', ']', ')', ';'].includes(next);
    if (t.text === '{') return this.object();
    if (t.text === '[') return this.array();
    if (t.kind === 'str' && simpleEnd) return this.take(t.value as string);
    if (t.kind === 'num' && simpleEnd) return this.take(t.value as number);
    if (t.text === '-' && this.peek(1)?.kind === 'num' && this.endsAt(2)) {
      this.pos++;
      return -(this.tokens[this.pos++]!.value as number);
    }
    if (t.text === 'true' && simpleEnd) return this.take(true);
    if (t.text === 'false' && simpleEnd) return this.take(false);
    if (t.text === 'null' && simpleEnd) return this.take(null);
    if (t.text === 'function') return this.fn();
    if (t.text === 'new' && this.is('UIComponentDescriptor', 1)) {
      this.pos += 2;
      this.expect('(');
      const v = this.value();
      this.expect(')');
      return { $descriptor: v } as Value;
    }
    return { $ref: this.raw() };
  }

  private endsAt(offset: number): boolean {
    const n = this.peek(offset)?.text;
    return n === undefined || [',', '}', ']', ')', ';'].includes(n);
  }

  private take<T extends Value>(v: T): T {
    this.pos++;
    return v;
  }

  /** Consumes an expression up to the next delimiter at depth 0 and returns its source text. */
  raw(): string {
    let depth = 0;
    const parts: string[] = [];
    while (this.pos < this.tokens.length) {
      const t = this.peek()!;
      if (depth === 0 && [',', '}', ']', ')', ';'].includes(t.text)) break;
      if (['(', '[', '{'].includes(t.text)) depth++;
      if ([')', ']', '}'].includes(t.text)) depth--;
      parts.push(t.text);
      this.pos++;
    }
    return joinTokens(parts);
  }

  private object(): Value {
    this.expect('{');
    const out: Record<string, Value> = {};
    while (!this.is('}')) {
      const key = this.tokens[this.pos++]!;
      this.expect(':');
      out[key.kind === 'str' ? (key.value as string) : key.text] = this.value();
      if (this.is(',')) this.pos++;
    }
    this.expect('}');
    return out;
  }

  private array(): Value {
    this.expect('[');
    const out: Value[] = [];
    while (!this.is(']')) {
      out.push(this.value());
      if (this.is(',')) this.pos++;
    }
    this.expect(']');
    return out;
  }

  /**
   * `function():Object { return X; }` yields X; `function():void { this.a = v; ... }` yields the
   * assigned properties; anything else is kept as source text.
   */
  private fn(): Value {
    this.expect('function');
    this.expect('(');
    while (!this.is(')')) this.pos++;
    this.expect(')');
    if (this.is(':')) {
      this.pos++;
      this.pos++;
    }
    this.expect('{');
    if (this.is('return')) {
      this.pos++;
      const v = this.value();
      if (this.is(';')) this.pos++;
      this.skipBlockRest();
      return v;
    }
    const assigned: Record<string, Value> = {};
    while (!this.is('}')) {
      if (this.is('this') && this.is('.', 1) && this.is('=', 3)) {
        const key = this.peek(2)!.text;
        this.pos += 4;
        assigned[key] = this.value();
        if (this.is(';')) this.pos++;
      } else {
        this.skipStatement();
      }
    }
    this.expect('}');
    return assigned;
  }

  private skipStatement(): void {
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!.text;
      if (depth === 0 && t === '}') return;
      this.pos++;
      if (t === '{' || t === '(' || t === '[') depth++;
      if (t === '}' || t === ')' || t === ']') depth--;
      if (depth === 0 && (t === ';' || t === '}')) return;
    }
  }

  private skipBlockRest(): void {
    let depth = 1;
    while (this.pos < this.tokens.length && depth > 0) {
      const t = this.tokens[this.pos++]!.text;
      if (t === '{') depth++;
      if (t === '}') depth--;
    }
  }
}

function joinTokens(parts: string[]): string {
  let out = '';
  for (const p of parts) {
    const prev = out.at(-1) ?? '';
    const word = /^[A-Za-z0-9_$"']/.test(p);
    out += word && /[A-Za-z0-9_$"']/.test(prev) ? ` ${p}` : p;
  }
  return out;
}

function toNode(v: Value): UiNode {
  const d = (v as { $descriptor?: Value }).$descriptor as Record<string, Value>;
  const typeRef = d['type'] as { $ref?: string } | string | undefined;
  const props = (d['propertiesFactory'] as Record<string, Value> | undefined) ?? {};
  const { childDescriptors, ...rest } = props as Record<string, Value> & {
    childDescriptors?: Value[];
  };
  const node: UiNode = {
    type: typeof typeRef === 'string' ? typeRef : (typeRef?.$ref ?? '?'),
    props: rest,
    styles: (d['stylesFactory'] as Record<string, Value> | undefined) ?? {},
    events: (d['events'] as Record<string, string> | undefined) ?? {},
    children: (childDescriptors ?? []).map(toNode),
  };
  if (typeof d['id'] === 'string') node.id = d['id'];
  return node;
}

/** Index just past the `}` matching the `{` at `open`. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

function methodBody(src: string, name: string): string | null {
  const m = new RegExp(
    `function ${name.replace(/\$/g, '\\$')}\\([^)]*\\)\\s*(?::\\s*[\\w*]+)?\\s*\\{`,
  ).exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  return src.slice(open + 1, matchBrace(src, open) - 1).trim();
}

const BINDING =
  /new Binding\(this,function\(\):\w+\s*\{([\s\S]*?)\},function\(param1:\w+\):void\s*\{[\s\S]*?\},"([^"]+)"\)/g;

function bindingExpr(body: string): string {
  const local = /var _loc1_:\*\s*=\s*([\s\S]*?);\s*return/.exec(body);
  if (local) return local[1]!.trim();
  const ret = /return\s+([\s\S]*?);\s*$/.exec(body.trim());
  return (ret?.[1] ?? body).trim().replace(/\s+/g, ' ');
}

const STYLE_DECL =
  /StyleManager\.getStyleDeclaration\("([^"]+)"\);[\s\S]*?style\.factory = function\(\):void\s*\{/g;

function parseAssignments(block: string): Record<string, Value> {
  try {
    const v = new Parser(tokenize(`function():void{${block}}`)).value();
    return v as Record<string, Value>;
  } catch {
    return {};
  }
}

/** The descriptor is assigned in the constructor or declared as a typed field initializer. */
const DESCRIPTOR = /_documentDescriptor_(?::UIComponentDescriptor)? = new UIComponentDescriptor\(/;

export function hasDescriptor(src: string): boolean {
  return DESCRIPTOR.test(src);
}

export function extractComponent(className: string, src: string): UiComponent {
  const result: UiComponent = {
    className,
    root: null,
    rootProps: {},
    bindings: [],
    styleDeclarations: {},
    handlers: {},
  };

  const at = DESCRIPTOR.exec(src);
  if (at) {
    const start = src.indexOf('new UIComponentDescriptor(', at.index);
    const parser = new Parser(tokenize(src.slice(start)));
    result.root = toNode(parser.value());
  }

  const ctor = methodBody(src, className.split('.').pop()!);
  if (ctor) {
    let tail = ctor.slice(ctor.lastIndexOf('super();'));
    for (let fn = tail.indexOf('function('); fn >= 0; fn = tail.indexOf('function(')) {
      const open = tail.indexOf('{', fn);
      tail = tail.slice(0, fn) + tail.slice(matchBrace(tail, open));
    }
    for (const m of tail.matchAll(/^\s*this\.(\w+) = ([^;\n]+);$/gm)) {
      result.rootProps[m[1]!] = new Parser(tokenize(m[2]!)).value();
    }
    const defaults = /styleDeclaration\.defaultFactory = function\(\):void\s*\{/.exec(ctor);
    if (defaults) {
      const open = defaults.index + defaults[0].length - 1;
      const block = ctor.slice(open + 1, matchBrace(ctor, open) - 1);
      result.styleDeclarations['(self)'] = parseAssignments(block);
    }
  }

  for (const m of src.matchAll(BINDING)) {
    result.bindings.push({ target: m[2]!, expr: bindingExpr(m[1]!) });
  }

  for (const m of src.matchAll(STYLE_DECL)) {
    const open = m.index + m[0].length - 1;
    const block = src.slice(open + 1, matchBrace(src, open) - 1);
    result.styleDeclarations[m[1]!] = parseAssignments(block);
  }

  const handlerNames = new Set<string>();
  const visit = (n: UiNode) => {
    Object.values(n.events).forEach((h) => handlerNames.add(h));
    n.children.forEach(visit);
  };
  if (result.root) visit(result.root);
  for (const m of src.matchAll(/this\.addEventListener\("\w+",(\w+)\)/g)) handlerNames.add(m[1]!);
  for (const name of handlerNames) {
    const body = methodBody(src, name);
    if (body !== null) result.handlers[name] = body.replace(/\s+/g, ' ');
  }
  return result;
}

export interface OutlineContext {
  /** Resolves an embed class field (`_embed_mxml_images_x_png_123`) to its source path. */
  embed: (ref: string) => string | null;
  /** Client string lookup for `Global.i18n("key")`. */
  text: (key: string) => string | undefined;
}

function show(v: Value, ctx: OutlineContext): string {
  if (v !== null && typeof v === 'object' && '$ref' in v) {
    const ref = (v as { $ref: string }).$ref;
    return ctx.embed(ref) ?? `{${ref}}`;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === 'object' && '$ref' in x ? `{${(x as { $ref: string }).$ref}}` : x,
  );
}

export function describeExpr(expr: string, ctx: OutlineContext): string {
  return expr.replace(/Global\.i18n\("([^"]+)"\)/g, (all, key: string) => {
    const t = ctx.text(key);
    return t === undefined ? all : `i18n(${key})「${t.replace(/\n/g, '\\n')}」`;
  });
}

export type StyleValue = string | number | boolean | null | StyleValue[];

/**
 * Global style sheet: Flex 3 registers every component's `<mx:Style>` selectors globally, so all
 * declarations are merged (earlier components win). Embed refs become asset source paths; other
 * runtime expressions are dropped. `(self)` declarations are component-local and skipped.
 */
export function globalStyles(
  components: UiComponent[],
  embed: (ref: string) => string | null,
): Record<string, Record<string, StyleValue>> {
  const convert = (v: Value): StyleValue | undefined => {
    if (Array.isArray(v)) {
      const items = v.map(convert);
      return items.includes(undefined) ? undefined : (items as StyleValue[]);
    }
    if (v !== null && typeof v === 'object') {
      return '$ref' in v && typeof v.$ref === 'string' ? (embed(v.$ref) ?? undefined) : undefined;
    }
    return v;
  };
  const sheet: Record<string, Record<string, StyleValue>> = {};
  for (const c of components) {
    for (const [selector, props] of Object.entries(c.styleDeclarations)) {
      if (selector === '(self)' || selector in sheet) continue;
      const decl: Record<string, StyleValue> = {};
      for (const [k, v] of Object.entries(props)) {
        const value = convert(v);
        if (value !== undefined) decl[k] = value;
      }
      sheet[selector] = decl;
    }
  }
  return sheet;
}

/** Human-readable tree: one line per component with geometry, style, bindings and events. */
export function outline(c: UiComponent, ctx: OutlineContext): string {
  const lines: string[] = [`# ${c.className}`];
  const rootProps = Object.entries(c.rootProps)
    .map(([k, v]) => `${k}=${show(v, ctx)}`)
    .join(' ');
  if (rootProps) lines.push(`root: ${rootProps}`);
  const bindingsByTarget = new Map<string, UiBinding[]>();
  for (const b of c.bindings) {
    const id = b.target.split('.')[0]!;
    bindingsByTarget.set(id, [...(bindingsByTarget.get(id) ?? []), b]);
  }
  const GEOMETRY = ['x', 'y', 'width', 'height'];
  const visit = (n: UiNode, depth: number) => {
    const p = n.props;
    const geo = GEOMETRY.filter((k) => k in p)
      .map((k) => `${k[0]}=${show(p[k]!, ctx)}`)
      .join(' ');
    const others = Object.entries(p)
      .filter(([k]) => !GEOMETRY.includes(k) && k !== 'id')
      .map(([k, v]) => `${k}=${show(v, ctx)}`);
    const styles = Object.entries(n.styles).map(([k, v]) => `${k}:${show(v, ctx)}`);
    const events = Object.entries(n.events).map(([e, h]) => `@${e}→${c.handlers[h] ?? h}`);
    const binds = (n.id ? (bindingsByTarget.get(n.id) ?? []) : []).map(
      (b) => `${b.target.slice(b.target.indexOf('.') + 1)}={${describeExpr(b.expr, ctx)}}`,
    );
    const head = `${'  '.repeat(depth)}${n.type}${n.id ? `#${n.id}` : ''}`;
    lines.push(
      [
        head,
        geo,
        ...others,
        styles.length ? `style{${styles.join('; ')}}` : '',
        ...binds,
        ...events,
      ]
        .filter(Boolean)
        .join('  '),
    );
    n.children.forEach((ch) => visit(ch, depth + 1));
  };
  if (c.root) visit(c.root, 0);
  const decls = Object.entries(c.styleDeclarations);
  if (decls.length) {
    lines.push('', '## styles');
    for (const [sel, props] of decls) {
      lines.push(
        `${sel} { ${Object.entries(props)
          .map(([k, v]) => `${k}: ${show(v, ctx)}`)
          .join('; ')} }`,
      );
    }
  }
  const others = c.bindings.filter((b) => !c.root || !b.target.includes('.'));
  if (others.length) {
    lines.push('', '## other bindings');
    for (const b of others) lines.push(`${b.target} = ${describeExpr(b.expr, ctx)}`);
  }
  return lines.join('\n') + '\n';
}
