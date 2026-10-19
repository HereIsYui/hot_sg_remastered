import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { images } from './docker.ts';
import { paths, repoRoot } from './paths.ts';
import { log, run, succeeds } from './run.ts';

export const FFDEC_VERSION = '24.1.0';
const FFDEC_URL = `https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version${FFDEC_VERSION}/ffdec_${FFDEC_VERSION}.zip`;

const ffdecDir = join(paths.cache, `ffdec-${FFDEC_VERSION}`);
const ffdecJar = join(ffdecDir, 'ffdec.jar');

/** Downloads FFDec once into legacy/.cache; HOT_FFDEC_ZIP may point at a pre-downloaded zip. */
export function ensureFfdec(): string {
  if (existsSync(ffdecJar)) return ffdecJar;
  mkdirSync(paths.cache, { recursive: true });
  const zip = join(paths.cache, `ffdec_${FFDEC_VERSION}.zip`);
  if (!existsSync(zip)) {
    const local = process.env.HOT_FFDEC_ZIP;
    if (local) {
      copyFileSync(local, zip);
    } else {
      log('ffdec', `downloading ${FFDEC_URL}`);
      run('curl', ['-fL', '--retry', '3', '-o', zip, FFDEC_URL]);
    }
  }
  rmSync(ffdecDir, { recursive: true, force: true });
  run('unzip', ['-q', '-o', zip, '-d', ffdecDir]);
  if (!existsSync(ffdecJar)) throw new Error(`ffdec.jar missing after unzip in ${ffdecDir}`);
  return ffdecJar;
}

function hasLocalJava(): boolean {
  return process.env.HOT_FFDEC_DOCKER !== '1' && succeeds('java', ['-version']);
}

/** Converts a host path under the repo into the path seen inside the /work container mount. */
export function toContainerPath(hostPath: string): string {
  const rel = relative(repoRoot, hostPath);
  if (rel.startsWith('..')) throw new Error(`${hostPath} is outside the repository`);
  return ['/work', ...rel.split(sep)].join('/');
}

/** Runs FFDec CLI; every path argument must be an absolute path inside the repository. */
export function ffdec(args: string[]): void {
  const jar = ensureFfdec();
  const javaArgs = ['-Xmx4g', '-Djava.awt.headless=true', '-jar'];
  if (hasLocalJava()) {
    run('java', [...javaArgs, jar, '-cli', ...args]);
    return;
  }
  const mapped = args.map((a) => (a.startsWith(repoRoot) ? toContainerPath(a) : a));
  const user =
    process.platform === 'linux' && process.getuid && process.getgid
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : [];
  run('docker', [
    'run',
    '--rm',
    ...user,
    '-v',
    `${repoRoot}:/work`,
    images.javaRuntime(),
    'java',
    ...javaArgs,
    toContainerPath(jar),
    '-cli',
    ...mapped,
  ]);
}
