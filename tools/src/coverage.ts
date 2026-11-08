import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { repoRoot } from './lib/paths.ts';

/** A static registration audit, not evidence of business correctness or client integration. */
type DecoratorKind = 'GlobalCommand' | 'DialogCommand' | 'AmfMethod' | 'RejectedCommand';
interface Registration {
  kind: DecoratorKind;
  file: string;
  line: number;
}
interface Entry {
  module: string;
  name: string;
  type: string;
  disposition: string;
  clientReferences: string;
  clientReferenceCount: number;
  inScope: boolean;
  status: 'registered' | 'rejected' | 'missing';
  registrations: Registration[];
}

const decoratorKinds = new Set<string>([
  'GlobalCommand',
  'DialogCommand',
  'AmfMethod',
  'RejectedCommand',
]);

function scanRegistrations(): Map<string, Registration[]> {
  const registrations = new Map<string, Registration[]>();
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node: ts.Node): void {
          if (ts.isMethodDeclaration(node) && ts.canHaveDecorators(node)) {
            for (const decorator of ts.getDecorators(node) ?? []) {
              const call = decorator.expression;
              if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
              const kind = call.expression.text;
              if (!decoratorKinds.has(kind)) continue;
              const argument = call.arguments[0];
              const method = node.name;
              const name =
                argument && ts.isStringLiteralLike(argument)
                  ? argument.text
                  : !argument && (ts.isIdentifier(method) || ts.isStringLiteralLike(method))
                    ? method.text
                    : undefined;
              if (!name) throw new Error(`Cannot resolve @${kind} in ${relative(repoRoot, file)}`);
              const registration: Registration = {
                kind: kind as DecoratorKind,
                file: relative(repoRoot, file),
                line: source.getLineAndCharacterOfPosition(decorator.getStart(source)).line + 1,
              };
              registrations.set(name, [...(registrations.get(name) ?? []), registration]);
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  walk(join(repoRoot, 'apps/server/src'));
  return registrations;
}

function parseInventory(registrations: Map<string, Registration[]>): Entry[] {
  const entries = new Map<string, Entry>();
  let module = '';
  for (const line of readFileSync(join(repoRoot, 'design/接口清单.md'), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('## ')) module = line.slice(3).trim();
    if (!module || module === '汇总' || module === '主客户端调用但不在白名单中的函数') continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 5) continue;
    const [functionCell, type, , clientReferences, disposition] = cells;
    const name = /^`([^`]+)`$/.exec(functionCell ?? '')?.[1];
    if (!name || type === undefined || clientReferences === undefined || !disposition) continue;
    // Count duplicate names once, matching the legacy Python audit.
    if (entries.has(name)) continue;
    const found = registrations.get(name) ?? [];
    entries.set(name, {
      module,
      name,
      type,
      disposition,
      clientReferences,
      clientReferenceCount: Number(/^(\d+)\s*处/.exec(clientReferences)?.[1] ?? 0),
      inScope: /^(保留|待确认)/.test(disposition),
      status: found.some((registration) => registration.kind !== 'RejectedCommand')
        ? 'registered'
        : found.length
          ? 'rejected'
          : 'missing',
      registrations: found,
    });
  }
  if (!entries.size) throw new Error('No API inventory rows found in design/接口清单.md');
  return [...entries.values()];
}

function summarize(entries: Entry[]) {
  const scoped = entries.filter((entry) => entry.inScope);
  const registered = scoped.filter((entry) => entry.status !== 'missing').length;
  const rejected = scoped.filter((entry) => entry.status === 'rejected').length;
  return {
    total: entries.length,
    inScope: scoped.length,
    outOfScope: entries.length - scoped.length,
    clientReferenced: scoped.filter((entry) => entry.clientReferenceCount > 0).length,
    registered,
    nonRejected: registered - rejected,
    rejectedCount: rejected,
    missingCount: scoped.length - registered,
    registrationPercent: scoped.length
      ? Number(((registered / scoped.length) * 100).toFixed(1))
      : null,
  };
}

export function buildCoverageReport() {
  const registrations = scanRegistrations();
  const entries = parseInventory(registrations);
  const missing = entries.filter((entry) => entry.inScope && entry.status === 'missing');
  const unreferencedMissing = missing.filter((entry) => !entry.clientReferenceCount);
  const names = new Set(entries.map((entry) => entry.name));
  return {
    schemaVersion: 1,
    inventory: 'design/接口清单.md',
    scope: '清单中保留/待确认的去重函数；注册按函数名匹配，不校验路由、业务行为或前端接入。',
    notes: [
      '已注册包含拒绝桩；RejectedCommand 单列为桩，不计作普通处理器，更不代表业务已实现。',
      '非拒绝注册也仅表示存在装饰器，不是实现率或测试覆盖率。',
      `本轮 wrap-up 计划排除无客户端引用的缺失接口（当前 ${unreferencedMissing.length} 项；基线 20 项）、51 平台、战场周边，以及跨服/沙场等既定不迁移内容；清单基线仍保留这些差额，不据此声称本轮须补齐。`,
      '客户端引用来自清单中的原版 SWF 引用列（可能截断），不是当前 H5 调用扫描。',
    ],
    summary: summarize(entries),
    rejectedRegistrations: [...registrations]
      .filter(([, found]) => found.some((registration) => registration.kind === 'RejectedCommand'))
      .map(([name, found]) => ({
        name,
        inInventory: names.has(name),
        registrations: found.filter((registration) => registration.kind === 'RejectedCommand'),
      })),
    modules: [...new Set(entries.map((entry) => entry.module))].map((module) => {
      const members = entries.filter((entry) => entry.module === module);
      return {
        module,
        ...summarize(members),
        missing: members.filter((entry) => entry.inScope && entry.status === 'missing'),
        rejected: members.filter((entry) => entry.inScope && entry.status === 'rejected'),
      };
    }),
    missing,
    unreferencedMissing: unreferencedMissing.map((entry) => entry.name),
    registrationsOutsideInventory: [...registrations]
      .filter(([name]) => !names.has(name))
      .map(([name, found]) => ({ name, registrations: found })),
    entries,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--json', '--help', '-h'].includes(arg))) {
    throw new Error('Usage: node tools/src/coverage.ts [--json] [--help]');
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: pnpm --filter @hot/tools coverage [--json]\n可从任意 cwd 用绝对路径运行 node /path/to/hot/tools/src/coverage.ts。',
    );
    return;
  }
  const report = buildCoverageReport();
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`注册覆盖率：${report.scope}\n模块：已注册/范围内（比例）；非拒绝注册；拒绝桩；缺失`);
  for (const module of report.modules) {
    console.log(
      module.inScope
        ? `${module.module}: ${module.registered}/${module.inScope} (${module.registrationPercent}%)；${module.nonRejected}；${module.rejectedCount}；${module.missingCount}`
        : `${module.module}: 范围外 ${module.outOfScope} 项`,
    );
  }
  const total = report.summary;
  console.log(
    `合计: ${total.registered}/${total.inScope} (${total.registrationPercent}%)；非拒绝注册 ${total.nonRejected}；拒绝桩 ${total.rejectedCount}；缺失 ${total.missingCount}`,
  );
  console.log('\n缺失接口（无注册）：');
  for (const module of report.modules) {
    if (!module.missing.length) continue;
    console.log(
      `${module.module} (${module.missing.length}): ${module.missing.map((entry) => `${entry.name}[${entry.disposition}；客户端引用 ${entry.clientReferenceCount}]`).join('、')}`,
    );
  }
  if (!report.missing.length) console.log('无');
  for (const module of report.modules) {
    if (module.rejected.length)
      console.log(
        `拒绝桩 ${module.module}: ${module.rejected.map((entry) => entry.name).join('、')}`,
      );
  }
  console.log(`\n清单外注册 ${report.registrationsOutsideInventory.length} 项（详见 --json）。`);
  console.log(
    `扫描到拒绝桩 ${report.rejectedRegistrations.length} 项（含清单外）: ${report.rejectedRegistrations.map((entry) => entry.name).join('、') || '无'}`,
  );
  console.log(report.notes.join('\n'));
}

// Importable for later validation without printing or scanning at import time.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
