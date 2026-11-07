import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { Game } from './game';
import type { CommandClient } from '../net/command';
import { coordinates, stateReply, vacationCancelWait, vacationQuote } from './userState';
import { useWorldStore } from '../stores/world';
import { alertState } from '../ui/alert';

afterEach(() => {
  vi.useRealTimers();
  alertState.items.length = 0;
});
function setup() {
  vi.useFakeTimers();
  const pinia = createPinia();
  const sendGlobalCommand = vi.fn().mockResolvedValue(undefined);
  const cmd = {
    open: true,
    sendGlobalCommand,
    sendCityCommand: vi.fn(),
  } as unknown as CommandClient;
  return {
    game: new Game(pinia, undefined, cmd),
    send: sendGlobalCommand,
    world: useWorldStore(pinia),
  };
}
describe('W4 protocol boundaries', () => {
  it('accepts legacy 0..500 coordinates but never sends blank, fractional or partial input', () => {
    expect(coordinates('0', '500')).toEqual([0, 500]);
    for (const x of ['', '501', '-1', '1.2', '12abc']) expect(coordinates(x, '1')).toBeNull();
  });
  it('uses AS3 vacation limits and confirmation quote', () => {
    expect(vacationQuote('2')).toEqual({ days: 2, cost: 30, cooldown: 0 });
    expect(vacationQuote('15')).toEqual({ days: 15, cost: 95, cooldown: 3 });
    for (const input of ['', '1', '16', '2.5']) expect(vacationQuote(input)).toBeNull();
    expect(vacationCancelWait(100, 100 + 172799)).toBe(1);
    expect(vacationCancelWait(100, 100 + 172800)).toBe(0);
  });
  it('distinguishes PHP empty cancellation from state and vacation replies', () => {
    expect(stateReply([])).toEqual({ kind: 'cancelVacation' });
    expect(stateReply([6, '172800'])).toEqual({ kind: 'vacation', seconds: 172800 });
    expect(stateReply([2, ['goods']])).toEqual({ kind: 'state', state: 2, goods: ['goods'] });
    expect(stateReply(null)).toBeNull();
  });
});
describe('W4 global flow', () => {
  it('locks vacation, then accepts an empty cancellation and reloads without a saved password', () => {
    const { game, send } = setup();
    game.onGlobalCommand('user', 'changeUserState', [6, 172800]);
    expect(game.user.locked).toBe(true);
    expect(game.session.vacation!.end - game.session.vacation!.start).toBe(172800);
    game.changeUserState(0, '2');
    expect(send).toHaveBeenLastCalledWith('user', 'changeUserState', [0, '2']);
    game.onGlobalCommand('user', 'changeUserState', []);
    expect(game.user.locked).toBe(false);
    expect(game.session.vacation).toBeNull();
    expect(send).toHaveBeenLastCalledWith('user', 'loadUserInfo', expect.any(Array));
  });
  it('retries decree with exact world arguments only for the matching bought gid', () => {
    const { game, send } = setup();
    game.declareWar(15, 230045, true);
    expect(send).toHaveBeenLastCalledWith('world', 'useTaoNiShengZhi', [15, 230045]);
    game.onGlobalCommand('buybeforeuse', 'buyGoodsBeforeUse', [12, 0, 100]);
    expect(send).toHaveBeenCalledTimes(1);
    game.onGlobalCommand('buybeforeuse', 'buyGoodsBeforeUse', [157, 0, 100]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('world', 'useTaoNiShengZhi', [15, 230045]);
    game.onGlobalCommand('buybeforeuse', 'buyGoodsBeforeUse', [157, 0, 100]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('preserves state selector and string days when buying an immunity item', () => {
    const { game, send } = setup();
    game.changeUserState(1, '2');
    game.onGlobalCommand('buybeforeuse', 'buyGoodsBeforeUse', [12, 0, 100]);
    expect(send).toHaveBeenLastCalledWith('user', 'changeUserState', [1, '2']);
    game.cancelStatePurchase();
    game.onGlobalCommand('buybeforeuse', 'buyGoodsBeforeUse', [12, 0, 100]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('refreshes relocation destination without mutating the reply for other receivers', () => {
    const { game, world, send } = setup();
    const received = vi.fn();
    game.addGlobalReceiver('user', received);
    const reply = [230045];
    game.onGlobalCommand('user', 'changeCityPositionPointing', reply);
    expect(world.centre).toEqual({ x: 45, y: 230 });
    expect(send).toHaveBeenLastCalledWith('user', 'loadUserInfo', expect.any(Array));
    expect(received).toHaveBeenCalledWith('changeCityPositionPointing', [230045]);
    expect(reply).toEqual([230045]);
  });
  it('merges declaration city rows and only closes the world action on success', () => {
    const { game, world } = setup();
    game.session.dialog = { name: 'worldAction', cid: 230045 };
    game.onGlobalCommand('world', 'startWar', [{ cid: '230045', flag: '8', uid: '15' }]);
    expect(world.cityInfo.get(230045)?.flag).toBe(8);
    expect(game.session.dialog).toBeNull();
    game.session.userRule = true;
    game.onGlobalCommand('user', 'allowPK', null);
    expect(game.session.userRule).toBe(false);
  });
});
