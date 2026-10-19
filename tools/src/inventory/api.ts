import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_SWFS } from '../lib/swf.ts';
import { clientCalls, stringLiterals } from './as3.ts';
import { code, generatedHeader, table } from './markdown.ts';
import {
  commandKind,
  moduleForFile,
  parseFunctionDefs,
  parseOpenfunc,
  type Module,
  type PhpFunction,
} from './php.ts';
import { as3Sources, gameDir, phpSources } from './sources.ts';

type Disposition =
  '保留' | '待确认：客户端未引用' | '待定：未归类' | '删除：单机不需要' | '删除：无实现';

interface ApiEntry {
  name: string;
  def?: PhpFunction;
  otherDefs: PhpFunction[];
  methods: PhpFunction[];
  module: Module;
  refs: string[];
  disposition: Disposition;
}

const MODULE_ORDER: Module[] = [
  'core',
  'auth',
  'user',
  'city',
  'hero',
  'item',
  'task',
  'world',
  'battle',
  'social',
  'rank',
  'activity',
  'unknown',
  'drop',
];

const MODULE_TITLES: Record<Module, string> = {
  core: 'core（公共）',
  auth: 'auth（登录与角色）',
  user: 'user（君主信息）',
  city: 'city（城池经济）',
  hero: 'hero（将领）',
  item: 'item（道具与商城）',
  task: 'task（任务与引导）',
  world: 'world（世界与军队）',
  battle: 'battle（战斗与战报）',
  social: 'social（社交与经济）',
  rank: 'rank（成长与荣誉）',
  activity: 'activity（玩法活动）',
  unknown: '未归类',
  drop: '不迁移',
};

/** amfphp maps `Class.method` onto game/Class.php, so such methods are callable through the gateway. */
function isGatewayMethod(d: PhpFunction): boolean {
  return !!d.className && !d.file.includes('/') && d.file === `${d.className}.php`;
}

function pickPrimary(defs: PhpFunction[]): PhpFunction | undefined {
  const score = (d: PhpFunction) =>
    (d.file.includes('/') ? 8 : 0) +
    (moduleForFile(d.file) === 'drop' ? 4 : 0) +
    (d.className ? 2 : 0) +
    (moduleForFile(d.file) === 'core' ? 0 : 1);
  return [...defs].sort((a, b) => score(a) - score(b))[0];
}

function kindOf(d: PhpFunction): string {
  return d.className ? 'amf' : commandKind(d.params);
}

export function buildApiInventory(): string {
  const openfunc = parseOpenfunc(readFileSync(join(gameDir, 'lang.php'), 'latin1'));
  const unique = [...new Set(openfunc)];
  const duplicates = openfunc.filter((f, i) => openfunc.indexOf(f) !== i);

  const defs = new Map<string, PhpFunction[]>();
  for (const src of phpSources()) {
    for (const d of parseFunctionDefs(src.text, src.rel)) {
      defs.set(d.name, [...(defs.get(d.name) ?? []), d]);
    }
  }

  const refs = new Map<string, Set<string>>();
  const calledButClosed = new Map<string, Set<string>>();
  const openSet = new Set(unique);
  for (const swf of MAIN_SWFS) {
    for (const src of as3Sources(swf)) {
      const id = src.id.replace(/\.as$/, '');
      for (const lit of stringLiterals(src.text)) {
        if (openSet.has(lit)) refs.set(lit, (refs.get(lit) ?? new Set()).add(id));
      }
      if (swf !== 'BloodWar') continue;
      for (const call of clientCalls(src.text)) {
        if (!openSet.has(call.func)) {
          calledButClosed.set(call.func, (calledButClosed.get(call.func) ?? new Set()).add(id));
        }
      }
    }
  }

  const entries: ApiEntry[] = unique.map((name) => {
    const all = defs.get(name) ?? [];
    const callable = all.filter((d) => !d.className || isGatewayMethod(d));
    const def = pickPrimary(callable);
    const module = def ? moduleForFile(def.file) : 'unknown';
    const r = [...(refs.get(name) ?? [])].sort();
    let disposition: Disposition = '保留';
    if (!def) disposition = '删除：无实现';
    else if (module === 'drop') disposition = '删除：单机不需要';
    else if (module === 'unknown') disposition = '待定：未归类';
    else if (r.length === 0) disposition = '待确认：客户端未引用';
    return {
      name,
      def,
      otherDefs: callable.filter((d) => d !== def),
      methods: all.filter((d) => d.className && !isGatewayMethod(d)),
      module,
      refs: r,
      disposition,
    };
  });

  const byModule = new Map<Module, ApiEntry[]>();
  for (const e of entries) byModule.set(e.module, [...(byModule.get(e.module) ?? []), e]);

  const dispositions: Disposition[] = [
    '保留',
    '待确认：客户端未引用',
    '待定：未归类',
    '删除：单机不需要',
    '删除：无实现',
  ];
  const count = (list: ApiEntry[], d: Disposition) =>
    list.filter((e) => e.disposition === d).length;

  const out: string[] = [
    generatedHeader('接口清单', 'pnpm legacy:inventory'),
    "原版客户端所有业务请求都经过 `Command.sendCommand`，服务端只允许调用 `lang.php` 中 `$GLOBALS['openfunc']` 白名单里的函数。本清单逐个列出这些函数，作为 NestJS 迁移的范围基线。",
    '',
    '- **类型**：`dialog` 表示以 `f($uid,$cid,$param)` 形式由对话框调用；`global` 表示以 `f($uid,$param)` 形式全局调用；`amf` 表示 amfphp 服务类方法，由客户端经网关直接调用（如 `Login.doLogin`、`ExternService.getTroopMaxTime`）；`other` 表示参数个数不符合上述约定（多为内部函数被误放进白名单）。',
    '- **定义位置**：只统计原版实际可调用的定义，即顶层函数和网关服务类方法；被注释掉的代码和普通类方法不算实现。',
    '- **客户端引用**：在四个 SWF 的反编译业务代码中出现该函数名字符串的类；没有引用的函数可能已废弃，迁移前需人工确认。',
    '- **处置**：按 `design/02-开发计划.md` 第 6 节的模块对照自动推断，评审时可在生成脚本中调整规则。',
    '',
    '## 汇总',
    '',
    `白名单共 ${openfunc.length} 项，去重后 ${unique.length} 个函数${duplicates.length ? `（重复：${duplicates.map(code).join('、')}）` : ''}。`,
    '',
    table(
      ['模块', '函数数', ...dispositions],
      MODULE_ORDER.filter((m) => byModule.has(m)).map((m) => {
        const list = byModule.get(m) ?? [];
        return [MODULE_TITLES[m], list.length, ...dispositions.map((d) => count(list, d))];
      }),
    ),
    '',
  ];

  if (calledButClosed.size) {
    out.push(
      '## 主客户端调用但不在白名单中的函数',
      '',
      'BloodWar.swf 中直接调用、但不在白名单里的函数。原版服务端不会执行它们（`function_exists` 失败时转入 `WizardFunc`，存在但不在白名单时报 `command_exception`），H5 版不需要实现，可据此清理死代码。两个独立战场 SWF 走各自的跨服服务，不在此统计。',
      '',
      table(
        ['函数', '调用位置'],
        [...calledButClosed.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([f, ids]) => [code(f), [...ids].sort().join('、')]),
      ),
      '',
    );
  }

  for (const m of MODULE_ORDER) {
    const list = byModule.get(m);
    if (!list) continue;
    list.sort(
      (a, b) =>
        (a.def?.file ?? '').localeCompare(b.def?.file ?? '') || a.name.localeCompare(b.name),
    );
    out.push(
      `## ${MODULE_TITLES[m]}`,
      '',
      table(
        ['函数', '类型', '定义位置', '客户端引用', '处置'],
        list.map((e) => [
          code(e.name),
          e.def ? kindOf(e.def) : '',
          e.def
            ? `${code(`${e.def.file}:${e.def.line}`)}${e.otherDefs.length ? `（另有 ${e.otherDefs.length} 处同名定义）` : ''}`
            : e.methods.length
              ? `仅有类方法 ${e.methods.map((m) => code(`${m.className}::${m.name}`) + `（${m.file}:${m.line}）`).join('、')}`
              : '',
          e.refs.length
            ? `${e.refs.length} 处：${e.refs.slice(0, 3).join('、')}${e.refs.length > 3 ? ' 等' : ''}`
            : '',
          e.disposition,
        ]),
      ),
      '',
    );
  }
  return out.join('\n');
}
