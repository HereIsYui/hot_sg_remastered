import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export function run(cmd: string, args: string[], options: SpawnSyncOptions = {}): void {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${res.status}`);
  }
}

export function capture(cmd: string, args: string[], options: SpawnSyncOptions = {}): string {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...options });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${res.status}: ${res.stderr}`);
  }
  return String(res.stdout);
}

export function succeeds(cmd: string, args: string[]): boolean {
  const res = spawnSync(cmd, args, { stdio: 'ignore' });
  return !res.error && res.status === 0;
}

export function log(step: string, message: string): void {
  console.log(`[${step}] ${message}`);
}
