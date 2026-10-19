import { describe, expect, it } from 'vitest';
import { parseGatewayResponse } from './legacy-client.ts';

describe('parseGatewayResponse', () => {
  it('strips leading BOMs emitted by legacy includes', () => {
    expect(parseGatewayResponse('x', '\uFEFF\uFEFF[1,2,"1001"]')).toEqual([1, 2, '1001']);
  });

  it('reports PHP fatal errors instead of a JSON parse error', () => {
    expect(() => parseGatewayResponse('Login.doLogin', '<b>Fatal error</b>: boom')).toThrow(
      /non-JSON response: <b>Fatal error/,
    );
  });
});
