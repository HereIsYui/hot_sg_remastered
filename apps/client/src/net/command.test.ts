import { describe, expect, it, vi } from 'vitest';
import { classifyFailure, CommandClient, type CommandHandlers } from './command';
import { NetworkError, type Transport } from './http';

function setup(reply: unknown | Error) {
  const transport = vi.fn<Transport>(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const handlers = {
    global: vi.fn(),
    dialog: vi.fn(),
    city: vi.fn(),
    failure: vi.fn(),
    malformed: vi.fn(),
    fault: vi.fn(),
    action: vi.fn(),
    busy: vi.fn(),
  } satisfies CommandHandlers;
  const session = { uid: 1001, sid: 77, cid: 215105, locked: false };
  const client = new CommandClient(() => session, handlers, transport);
  return { client, handlers, transport, session };
}

describe('CommandClient', () => {
  it('sends global commands in the original layout and routes the echo', async () => {
    const { client, handlers, transport } = setup([1, 2, 'user', 'loadUserInfo', [{ name: 'x' }]]);
    await client.sendGlobalCommand('user', 'loadUserInfo', [123]);
    expect(transport).toHaveBeenCalledWith('/api/command', [
      1001,
      77,
      2,
      'user',
      'loadUserInfo',
      123,
    ]);
    expect(handlers.global).toHaveBeenCalledWith('user', 'loadUserInfo', [{ name: 'x' }]);
    expect(handlers.action).toHaveBeenCalledOnce();
    expect(handlers.busy.mock.calls).toEqual([[1], [0]]);
  });

  it('routes the bare header of an unhandled global command with undefined data', async () => {
    const { client, handlers } = setup([1, 2, 'city', 'getUserCities']);
    await client.sendGlobalCommand('city', 'getUserCities');
    expect(handlers.global).toHaveBeenCalledWith('city', 'getUserCities', undefined);
  });

  it('sends dialog commands with the current city and routes the result', async () => {
    const { client, handlers, transport } = setup([1, 1, 215105, 6, 0, 3, ['data']]);
    await client.sendDialogCommand('getInfo', 6, 0, ['a'], 3);
    expect(transport).toHaveBeenCalledWith('/api/command', [
      1001,
      77,
      1,
      215105,
      6,
      0,
      3,
      'getInfo',
      'a',
    ]);
    expect(handlers.dialog).toHaveBeenCalledWith({
      cid: 215105,
      receiverId: 6,
      receiverParam: 0,
      ttype: 3,
      data: ['data'],
    });
  });

  it('suppresses dialog and city commands while locked or closed', async () => {
    const { client, transport, session } = setup([1, 1]);
    session.locked = true;
    await client.sendDialogCommand('x', 1);
    await client.sendCityCommand(0);
    session.locked = false;
    client.open = false;
    await client.sendGlobalCommand('user', 'x');
    expect(transport).not.toHaveBeenCalled();
  });

  it('reports failures, malformed replies and faults', async () => {
    const failed = setup([0, '**ok']);
    await failed.client.sendGlobalCommand('a', 'b');
    expect(failed.handlers.failure).toHaveBeenCalledWith({ kind: 'panel', text: 'ok' });

    const malformed = setup([1]);
    await malformed.client.sendGlobalCommand('a', 'b');
    expect(malformed.handlers.malformed).toHaveBeenCalledWith('command');

    const fault = setup(new NetworkError('down'));
    await fault.client.sendGlobalCommand('a', 'b', null, false);
    expect(fault.handlers.fault).toHaveBeenCalledWith(expect.any(NetworkError), true);
    expect(fault.handlers.busy).not.toHaveBeenCalled();
  });

  it('sends city commands to the CityCommand service', async () => {
    const { client, handlers, transport } = setup([1, 4, [1700000000]]);
    await client.sendCityCommand(4);
    expect(transport).toHaveBeenCalledWith(
      '/api/service/CityCommand/sendCommand',
      [1001, 215105, 77, 4],
    );
    expect(handlers.city).toHaveBeenCalledWith(4, [1700000000]);
  });
});

describe('classifyFailure', () => {
  it('recognizes the special keys of Command.as', () => {
    expect(classifyFailure('need_refresh', ['p'])).toEqual({ kind: 'needRefresh', swfPass: 'p' });
    expect(classifyFailure('invalid_user_auth')).toEqual({ kind: 'invalidAuth' });
    expect(classifyFailure('server_is_updating')).toEqual({ kind: 'serverUpdating' });
    expect(classifyFailure('not_user_city')).toEqual({ kind: 'notUserCity' });
    expect(classifyFailure('not_enough_goods12')).toEqual({
      kind: 'notEnoughGoods',
      gid: 12,
      count: 1,
    });
    expect(classifyFailure('not_enough_goods12#5')).toEqual({
      kind: 'notEnoughGoods',
      gid: 12,
      count: 5,
    });
    expect(classifyFailure('ask_for_copperShop')).toEqual({ kind: 'ask', what: 'copperShop' });
    expect(classifyFailure('资源不足')).toEqual({ kind: 'alert', text: '资源不足' });
  });
});
