import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toContainerPath } from './ffdec.ts';
import { repoRoot } from './paths.ts';

describe('toContainerPath', () => {
  it('maps repository paths onto the /work mount', () => {
    expect(toContainerPath(join(repoRoot, 'legacy', 'raw', 'a.swf'))).toBe(
      '/work/legacy/raw/a.swf',
    );
  });

  it('rejects paths outside the repository', () => {
    expect(() => toContainerPath('/etc/passwd')).toThrow(/outside/);
  });
});
