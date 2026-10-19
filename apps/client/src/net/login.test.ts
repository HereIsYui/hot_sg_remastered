import { describe, expect, it, vi } from 'vitest';
import type { Transport } from './http';
import { CLIENT_VERSION, LoginService, parseLogin, parseQueue } from './login';

describe('LoginService', () => {
  it('posts doLogin in the original parameter layout', async () => {
    const transport = vi.fn<Transport>(async () => [1, 2, '1001', '55', '', 0, false, false, 3]);
    const result = await new LoginService(transport).doLogin('ling', 'pw');
    expect(transport).toHaveBeenCalledWith('/api/service/Login/doLogin', [
      CLIENT_VERSION,
      0,
      'uuyx',
      'ling',
      'pw',
    ]);
    expect(result).toEqual({
      kind: 'ok',
      uid: 1001,
      sid: 55,
      cardId: '',
      isAdult: 0,
      showRule: false,
      showVip: false,
      vipUrl: null,
      lastUpdateServerId: 3,
    });
  });
});

describe('parseLogin', () => {
  it('handles failures, faults and the queue', () => {
    expect(parseLogin([0, '版本过低'])).toEqual({ kind: 'error', message: '版本过低' });
    expect(parseLogin({ faultCode: 'AMFPHP_RUNTIME_ERROR', faultString: 'x' })).toEqual({
      kind: 'error',
      message: 'x',
    });
    expect(parseLogin([1, 1, 7, 8, 3])).toEqual({ kind: 'queued', uid: 7, sid: 8, ahead: 3 });
    expect(parseLogin([-100])).toEqual({ kind: 'redirect', code: -100 });
  });

  it('reads the last update id after the VIP url when shown', () => {
    expect(parseLogin([1, 2, 1, 2, 'c', 1, true, true, 'http://vip', 9])).toMatchObject({
      showRule: true,
      vipUrl: 'http://vip',
      lastUpdateServerId: 9,
    });
  });
});

describe('parseQueue', () => {
  it('maps checkQueue replies', () => {
    expect(parseQueue([0])).toEqual({ kind: 'invalid' });
    expect(parseQueue([1, 0])).toEqual({ kind: 'ready' });
    expect(parseQueue([1, 1, 4])).toEqual({ kind: 'queued', ahead: 4 });
  });
});
