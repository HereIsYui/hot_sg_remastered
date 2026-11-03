import { describe, expect, it, vi } from 'vitest';
import { armBuyAgain, clearBuyAgain, consumeBuyAgain } from './battlefieldBuyAgain';

describe('battlefieldBuyAgain', () => {
  it('re-runs the armed command when the bought gid matches', () => {
    const send = vi.fn();
    armBuyAgain([59, 135], send);
    expect(consumeBuyAgain(135)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    // consumed: a second reply does nothing
    expect(consumeBuyAgain(135)).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('ignores unrelated gids', () => {
    const send = vi.fn();
    armBuyAgain([59], send);
    expect(consumeBuyAgain(140)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    clearBuyAgain();
  });

  it('clearBuyAgain drops the pending command', () => {
    const send = vi.fn();
    armBuyAgain([59], send);
    clearBuyAgain();
    expect(consumeBuyAgain(59)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
