import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/app-config';
import { GameError } from './game-error';
import { LangService } from './lang.service';
import { sprintf } from './sprintf';

describe('sprintf', () => {
  it('formats %s, %d, %% and positional arguments', () => {
    expect(sprintf('%s后才能安抚百姓。', '3分钟')).toBe('3分钟后才能安抚百姓。');
    expect(sprintf('%d%% of %s', 12.7, 'x')).toBe('12% of x');
    expect(sprintf('%2$s-%1$s', 'a', 'b')).toBe('b-a');
    expect(sprintf('%s and %s', 'only')).toBe('only and ');
  });

  it('formats %.0f like PHP (half away from zero)', () => {
    expect(sprintf('损失黄金%.0f。', 1234)).toBe('损失黄金1234。');
    expect(sprintf('损失%.0f/%.0f/%.0f', 1234.5, 1234.4, -2.5)).toBe('损失1235/1234/-3');
    expect(sprintf('%sf=%.2f', 'v', 3.14159)).toBe('vf=3.14');
  });
});

describe('LangService', () => {
  const lang = new LangService({
    doLogin: { account_temp_locked: '你的帐号已经被封禁，%s后才能重新登录。' },
    openfunc: ['sendCommand'],
  });

  it('resolves nested keys with arguments', () => {
    expect(lang.t('doLogin.account_temp_locked', '1小时')).toBe(
      '你的帐号已经被封禁，1小时后才能重新登录。',
    );
  });

  it('falls back to the key when the text is missing', () => {
    expect(lang.t('doLogin.nope')).toBe('doLogin.nope');
  });

  it('formats game errors', () => {
    expect(lang.messageOf(GameError.lang('doLogin.account_temp_locked', '2天'))).toContain('2天');
    expect(lang.messageOf(GameError.raw('invalid_user_auth'))).toBe('invalid_user_auth');
    expect(lang.value<string[]>('openfunc')).toEqual(['sendCommand']);
  });
});

describe('loadConfig', () => {
  it('applies defaults and coerces types', () => {
    const c = loadConfig({ PORT: '4000', TICK_ENABLED: 'false' });
    expect(c.PORT).toBe(4000);
    expect(c.TICK_ENABLED).toBe(false);
    expect(c.TICK_INTERVAL_MS).toBe(3000);
    expect(c.LANG_FILE).toMatch(/legacy\/lang\/zh_CN\.json$/);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/invalid environment/);
  });
});
