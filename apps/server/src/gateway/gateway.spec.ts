import { Global, Injectable, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { GameError } from '../common/game-error';
import { LangService } from '../common/lang.service';
import type { OwnershipService } from '../core/ownership.service';
import { clientAddress, ipToLegacyInt } from './client-ip';
import { CommandService } from './command.service';
import {
  AmfMethod,
  AmfService,
  type CommandContext,
  DialogCommand,
  GlobalCommand,
} from './decorators';
import { HandlerRegistry } from './handler-registry';
import { KeyedMutex } from './keyed-mutex';
import type { SessionService } from './session.service';

const lang = new LangService({ sendCommand: { command_not_found: '不存在的请求' } });

describe('KeyedMutex', () => {
  it('serialises work per key but not across keys', async () => {
    const mutex = new KeyedMutex<number>();
    const log: string[] = [];
    const task = (key: number, name: string, ms: number) =>
      mutex.run(key, async () => {
        log.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`${name}:end`);
      });
    await Promise.all([task(1, 'a', 20), task(1, 'b', 1), task(2, 'c', 1)]);
    expect(log.indexOf('a:end')).toBeLessThan(log.indexOf('b:start'));
    expect(log.indexOf('c:end')).toBeLessThan(log.indexOf('a:end'));
    expect(mutex.size).toBe(0);
  });

  it('keeps the queue going after a failure', async () => {
    const mutex = new KeyedMutex<number>();
    await expect(mutex.run(1, async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(mutex.run(1, async () => 42)).resolves.toBe(42);
  });
});

describe('ipToLegacyInt', () => {
  it('reverses the IPv4 bytes like common.php', () => {
    expect(ipToLegacyInt('127.0.0.1')).toBe(16777343);
    expect(ipToLegacyInt('::ffff:192.168.1.10')).toBe(
      10 * 2 ** 24 + 1 * 2 ** 16 + 168 * 2 ** 8 + 192,
    );
    expect(ipToLegacyInt('::1')).toBe(0);
    expect(ipToLegacyInt(undefined)).toBe(0);
  });

  it('keeps the dotted form as sip', () => {
    expect(clientAddress('::ffff:10.0.0.2')).toEqual({ ip: 2 * 2 ** 24 + 10, sip: '10.0.0.2' });
    expect(clientAddress('::1')).toEqual({ ip: 0, sip: '::1' });
  });
});

const LOCAL = { ip: 0, sip: '' };

function commandService(options: { ownCity?: boolean } = {}) {
  const registry = new HandlerRegistry(null as never, null as never, null as never);
  const calls: { ctx: CommandContext; param: unknown[] }[] = [];
  registry.addCommand({
    name: 'getCityInfo',
    kind: 'dialog',
    owner: 'test',
    invoke: (ctx, param) => {
      calls.push({ ctx, param });
      return { cid: ctx.cid };
    },
  });
  registry.addCommand({
    name: 'loadUserInfo',
    kind: 'global',
    owner: 'test',
    invoke: (ctx, param) => {
      calls.push({ ctx, param });
      return undefined;
    },
  });
  registry.addCommand({
    name: 'fails',
    kind: 'global',
    owner: 'test',
    invoke: () => {
      throw GameError.raw('boom');
    },
  });
  const sessions = {
    verify: async (uid: unknown, sid: unknown) => {
      if (sid !== 'good') throw GameError.raw('invalid_user_auth');
      return Number(uid);
    },
  } as unknown as SessionService;
  const ownership = {
    checkCityOwner: async () => {
      if (options.ownCity === false) throw GameError.raw('not_user_city');
    },
  } as unknown as OwnershipService;
  return { svc: new CommandService(ownership, registry, sessions, lang), calls };
}

describe('CommandService.dispatch', () => {
  it('echoes dialog header fields and appends the result', async () => {
    const { svc, calls } = commandService();
    const res = await svc.dispatch([1001, 'good', 1, 209355, 'recv', 7, 3, 'getCityInfo', 'a', 2], {
      ip: 99,
      sip: '99.0.0.0',
    });
    expect(res).toEqual([1, 1, 209355, 'recv', 7, 3, { cid: 209355 }]);
    expect(calls[0]).toEqual({
      ctx: { uid: 1001, cid: 209355, ip: 99, sip: '99.0.0.0' },
      param: ['a', 2],
    });
  });

  it('echoes global header fields and maps undefined results to null', async () => {
    const { svc, calls } = commandService();
    expect(await svc.dispatch([1001, 'good', 2, 0, 'loadUserInfo', 5], LOCAL)).toEqual([
      1,
      2,
      0,
      'loadUserInfo',
      null,
    ]);
    expect(calls[0]?.ctx.cid).toBe(0);
  });

  it('answers unknown global commands with the bare header', async () => {
    const { svc } = commandService();
    expect(await svc.dispatch([1001, 'good', 2, 7, 'nope', 'hi'], LOCAL)).toEqual([
      1,
      2,
      7,
      'nope',
    ]);
  });

  it('echoes city commands without calling anything', async () => {
    const { svc, calls } = commandService();
    expect(await svc.dispatch([1001, 'good', 0, 209355, 'res'], LOCAL)).toEqual([
      1,
      0,
      209355,
      'res',
    ]);
    expect(calls).toHaveLength(0);
  });

  it('reports failures as [0, message]', async () => {
    const { svc } = commandService();
    expect(await svc.dispatch([1001, 'bad', 2, 0, 'loadUserInfo'], LOCAL)).toEqual([
      0,
      'invalid_user_auth',
    ]);
    expect(await svc.dispatch([1001, 'good', 1, 1, 0, 0, 0, 'nope'], LOCAL)).toEqual([
      0,
      'nope不存在的请求',
    ]);
    expect(await svc.dispatch([1001, 'good', 2, 0, 'getCityInfo'], LOCAL)).toEqual([
      0,
      'getCityInfo不存在的请求',
    ]);
    expect(await svc.dispatch([1001, 'good', 2, 0, 'fails'], LOCAL)).toEqual([0, 'boom']);
  });

  it('rejects dialog commands for cities the user does not own', async () => {
    const { svc, calls } = commandService({ ownCity: false });
    expect(await svc.dispatch([1001, 'good', 1, 1, 0, 0, 0, 'getCityInfo'], LOCAL)).toEqual([
      0,
      'not_user_city',
    ]);
    expect(calls).toHaveLength(0);
  });
});

@AmfService('Login')
@Injectable()
class FakeLogin {
  @AmfMethod()
  doLogin(param: unknown[]) {
    return ['login', ...param];
  }

  @GlobalCommand()
  loadUserInfo() {
    return 'info';
  }

  @DialogCommand('recruitHero')
  recruit() {
    return 'hero';
  }
}

@Global()
@Module({ providers: [{ provide: LangService, useValue: lang }], exports: [LangService] })
class TestLangModule {}

describe('HandlerRegistry', () => {
  it('discovers decorated commands and service methods', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule, TestLangModule],
      providers: [HandlerRegistry, FakeLogin],
    }).compile();
    await moduleRef.init();
    const registry = moduleRef.get(HandlerRegistry);
    expect(registry.commandNames()).toEqual(['loadUserInfo', 'recruitHero']);
    expect(registry.command('recruitHero')?.kind).toBe('dialog');
    expect(registry.command('recruitHero')?.invoke({ uid: 1, cid: 2, ...LOCAL }, [])).toBe('hero');
    expect(await registry.serviceMethod('Login', 'doLogin')?.invoke([1, 2], LOCAL)).toEqual([
      'login',
      1,
      2,
    ]);
  });

  it('rejects duplicate command names', () => {
    const registry = new HandlerRegistry(null as never, null as never, null as never);
    const cmd = { name: 'x', kind: 'global' as const, owner: 'a', invoke: () => null };
    registry.addCommand(cmd);
    expect(() => registry.addCommand({ ...cmd, owner: 'b' })).toThrow(/registered by a and b/);
  });
});
