import { dirname } from 'node:path';
import { clientCalls, phaseForPackage, uiKind, type Phase, type UiKind } from './as3.ts';
import { code, generatedHeader, table } from './markdown.ts';
import { as3Sources } from './sources.ts';

interface UiEntry {
  swf: string;
  className: string;
  pkg: string;
  kind: UiKind;
  lines: number;
  commands: string[];
  phase: Phase;
}

const PHASE_TITLES: Record<string, string> = {
  '2': '阶段 2：前端框架（登录、主界面框架、通用组件）',
  '3': '阶段 3：城池经济',
  '4': '阶段 4：将领与道具',
  '5': '阶段 5：世界与战斗',
  '6': '阶段 6：社交与经济',
  '7': '阶段 7：成长与荣誉',
  '8': '阶段 8：玩法活动',
  '9': '阶段 9：独立战场',
  unknown: '未归类',
  drop: '不迁移',
};
const PHASE_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'unknown', 'drop'];

function collect(
  swf: 'BloodWar' | 'BloodBattle' | 'ChibiBattle',
  phaseOverride?: Phase,
): UiEntry[] {
  const out: UiEntry[] = [];
  for (const src of as3Sources(swf)) {
    const file = src.rel.split('/').pop() ?? '';
    const kind = uiKind(file);
    if (!kind) continue;
    const pkg = dirname(src.rel) === '.' ? '' : dirname(src.rel);
    out.push({
      swf,
      className: file.replace(/\.as$/, ''),
      pkg,
      kind,
      lines: src.text.split('\n').length,
      commands: [...new Set(clientCalls(src.text).map((c) => c.func))].sort(),
      phase: phaseOverride ?? phaseForPackage(pkg),
    });
  }
  return out;
}

export function buildUiInventory(): string {
  const entries = [
    ...collect('BloodWar'),
    ...collect('BloodBattle', 9),
    ...collect('ChibiBattle', 9),
  ];
  const byPhase = new Map<string, UiEntry[]>();
  for (const e of entries) {
    const key = String(e.phase);
    byPhase.set(key, [...(byPhase.get(key) ?? []), e]);
  }
  const kinds: UiKind[] = ['Dialog', 'Panel', 'View'];
  const main = entries.filter((e) => e.swf === 'BloodWar');

  const out: string[] = [
    generatedHeader('界面清单', 'pnpm legacy:inventory'),
    '从反编译的 AS3 代码中提取手写的界面类（类名以 `Dialog`、`Panel`、`View` 结尾，排除 Flex 编译器生成的辅助类），按 `design/02-开发计划.md` 的阶段归类。H5 版以此作为界面迁移的范围基线。',
    '',
    '- **行数**：反编译后的代码行数，MXML 布局和数据绑定被展开成了 AS3，只能用来粗略比较复杂度。',
    '- **调用命令**：类中直接出现的 `sendGlobalCommand` / `sendDialogCommand` 调用，对应接口清单中的函数。',
    '',
    '## 汇总',
    '',
    `主客户端 BloodWar.swf 共 ${main.length} 个界面类（Dialog ${main.filter((e) => e.kind === 'Dialog').length} 个）；两个独立战场 SWF 共 ${entries.length - main.length} 个。`,
    '',
    table(
      ['阶段', ...kinds, '合计', '代码行数'],
      PHASE_ORDER.filter((p) => byPhase.has(p)).map((p) => {
        const list = byPhase.get(p) ?? [];
        return [
          PHASE_TITLES[p],
          ...kinds.map((k) => list.filter((e) => e.kind === k).length),
          list.length,
          list.reduce((s, e) => s + e.lines, 0),
        ];
      }),
    ),
    '',
  ];

  for (const p of PHASE_ORDER) {
    const list = byPhase.get(p);
    if (!list) continue;
    list.sort(
      (a, b) =>
        a.swf.localeCompare(b.swf) ||
        a.pkg.localeCompare(b.pkg) ||
        kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
        a.className.localeCompare(b.className),
    );
    out.push(
      `## ${PHASE_TITLES[p]}`,
      '',
      table(
        ['类', 'SWF', '包', '类型', '行数', '调用命令'],
        list.map((e) => [
          code(e.className),
          e.swf,
          e.pkg ? code(e.pkg) : '（根）',
          e.kind,
          e.lines,
          e.commands.map(code).join(' '),
        ]),
      ),
      '',
    );
  }
  return out.join('\n');
}
