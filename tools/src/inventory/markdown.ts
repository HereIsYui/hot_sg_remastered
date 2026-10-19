export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function table(headers: string[], rows: unknown[][]): string {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

export function code(value: string): string {
  return value ? `\`${value}\`` : '';
}

export function generatedHeader(title: string, command: string): string {
  return [
    `# ${title}`,
    '',
    `> 本文件由 \`${command}\` 生成，请勿手工修改；需要补充的说明写在生成脚本或单独文档里。`,
    '',
  ].join('\n');
}
