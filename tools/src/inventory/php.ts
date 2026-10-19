/** Extracts the `$GLOBALS['openfunc']` whitelist (the functions sendCommand may dispatch to). */
export function parseOpenfunc(langSrc: string): string[] {
  const m = /\$GLOBALS\[['"]openfunc['"]\]\s*=\s*array\(([\s\S]*?)\);/.exec(langSrc);
  if (!m?.[1]) throw new Error('openfunc array not found');
  return [...m[1].matchAll(/['"]\s*([A-Za-z_]\w*)\s*['"]/g)].map((x) => x[1] as string);
}

export interface PhpFunction {
  name: string;
  params: string[];
  file: string;
  line: number;
  /** Set for methods; sendCommand resolves names with function_exists(), which ignores methods. */
  className?: string;
}

const IDENT = /[A-Za-z0-9_]/;

/**
 * Finds named `function` declarations, skipping comments, strings and heredocs, and records
 * the enclosing class so methods can be told apart from callable global functions.
 */
export function parseFunctionDefs(src: string, file: string): PhpFunction[] {
  const out: PhpFunction[] = [];
  const classes: { name: string; depth: number }[] = [];
  let pendingClass: string | null = null;
  let depth = 0;
  let line = 1;
  let i = 0;
  const skipTo = (end: number) => {
    for (let j = i; j < end; j++) if (src[j] === '\n') line++;
    i = end;
  };

  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === '\n') {
      line++;
      i++;
    } else if ((c === '/' && next === '/') || c === '#') {
      let j = i;
      while (j < src.length && src[j] !== '\n' && !(src[j] === '?' && src[j + 1] === '>')) j++;
      skipTo(j);
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      skipTo(end < 0 ? src.length : end + 2);
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      skipTo(j + 1);
    } else if (c === '<' && src.startsWith('<<<', i)) {
      const tag = /^<<<\s*['"]?(\w+)['"]?/.exec(src.slice(i, i + 80))?.[1];
      const end = tag ? src.indexOf(`\n${tag}`, i) : -1;
      skipTo(end < 0 ? i + 3 : end + tag!.length + 1);
    } else if (c === '{') {
      depth++;
      if (pendingClass) {
        classes.push({ name: pendingClass, depth });
        pendingClass = null;
      }
      i++;
    } else if (c === '}') {
      if (classes.at(-1)?.depth === depth) classes.pop();
      depth--;
      i++;
    } else if (/[A-Za-z_]/.test(c) && !IDENT.test(src[i - 1] ?? '') && src[i - 1] !== '$') {
      let j = i;
      while (j < src.length && IDENT.test(src[j] as string)) j++;
      const word = src.slice(i, j).toLowerCase();
      const prev = src.slice(Math.max(0, i - 2), i);
      if (word === 'class' && prev !== '::' && prev !== '->') {
        pendingClass = /^\s+([A-Za-z_]\w*)/.exec(src.slice(j, j + 100))?.[1] ?? null;
      } else if (word === 'function') {
        const m = /^\s*&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(src.slice(j, j + 500));
        if (m) {
          const params = (m[2] ?? '')
            .split(',')
            .map((p) => p.trim().replace(/\s*=.*$/s, ''))
            .filter(Boolean);
          const className = classes.at(-1)?.name;
          out.push({
            name: m[1] as string,
            params,
            file,
            line,
            ...(className ? { className } : {}),
          });
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Command.sendCommand calls dialog functions as f($uid,$cid,$param) and global ones as
 * f($uid,$param); the declared arity tells which dispatcher a function was written for.
 */
export function commandKind(params: string[]): 'dialog' | 'global' | 'other' {
  if (params.length === 3) return 'dialog';
  if (params.length === 2) return 'global';
  return 'other';
}

export type Module =
  | 'core'
  | 'auth'
  | 'user'
  | 'city'
  | 'hero'
  | 'item'
  | 'task'
  | 'world'
  | 'battle'
  | 'social'
  | 'rank'
  | 'activity'
  | 'drop'
  | 'unknown';

const FILE_MODULES: Record<Exclude<Module, 'drop' | 'unknown'>, string[]> = {
  core: ['utils.php', 'UtilsExtend.php', 'global.php', 'interface.php', 'Command.php', 'lang.php'],
  auth: ['Login.php', 'forlogin.php', 'createrole.php', 'GetUserLogin.php'],
  user: ['UserFunc.php'],
  city: [
    'CityFunc.php',
    'BuildingFunc.php',
    'TechnicFunc.php',
    'SoldierFunc.php',
    'DefenceFunc.php',
    'CityMergeFunc.php',
    'WorkShop.php',
    'CityCommand.php',
  ],
  hero: ['HeroFunc.php', 'HeroExpr.php', 'HeroSkillFunc.php', 'HotelFunc.php'],
  item: [
    'GoodsFunc.php',
    'ArmorFunc.php',
    'EquipmentFunc.php',
    'StoreFunc.php',
    'BarnFunc.php',
    'ShopFunc.php',
  ],
  task: [
    'TaskFunc.php',
    'TaskFuncAdd.php',
    'GuideFunc.php',
    'RewardFunc.php',
    'ActFunc.php',
    'AchivementFunc.php',
  ],
  world: ['WorldFunc.php', 'GroundFunc.php', 'TroopFunc.php', 'updateMap.php', 'ExternService.php'],
  battle: [
    'BattleFunc.php',
    'OLdBattleCron.php',
    'ReportCron.php',
    'ReportFunc.php',
    'cfg_js.php',
    'BattleCommand.php',
  ],
  social: ['UnionFunc.php', 'FriendFunc.php', 'MailFunc.php', 'MarketFunc.php'],
  rank: [
    'RankFunc.php',
    'OfficeFunc.php',
    'StatFunc.php',
    'VipFunc.php',
    'BufferFunc.php',
    'TrickFunc.php',
    'LotteryFunc.php',
  ],
  activity: [
    'PKFunc.php',
    'LuoyangFunc.php',
    'MarrySystemFunc.php',
    'ShaChang.php',
    'ShaChangFunc.php',
    'NaoZhong.php',
  ],
};

const DROP_PATTERNS = [
  /^51/,
  /^BattleNet/,
  /^ChibiNet/,
  /^AssembleKuaFu\.php$/,
  /^AdultFunc\.php$/,
  /^pay/i,
  /^(51SDK|xiaonei|agents|passport|secret|tempaaa)\//,
];

/** Maps a path relative to server/game/ onto the NestJS module planned in 02-开发计划.md §6. */
export function moduleForFile(relPath: string): Module {
  if (DROP_PATTERNS.some((re) => re.test(relPath))) return 'drop';
  for (const [mod, files] of Object.entries(FILE_MODULES)) {
    if (files.includes(relPath)) return mod as Module;
  }
  return 'unknown';
}
