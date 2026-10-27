import { describe, expect, it } from 'vitest';
import { addResource } from './battle-result';

describe('battle resource carrying', () => {
  it('takes everything when capacity is sufficient', () => {
    expect(addResource('0', '100,200,300,400,500', 2000)).toEqual({
      resource: '100,200,300,400,500',
      rob: { gold: 100, food: 200, wood: 300, rock: 400, iron: 500 },
    });
  });

  it('returns the original payload at zero capacity', () => {
    expect(addResource('1,2,3,4,5', '100,200,300,400,500', 0)).toEqual({
      resource: '1,2,3,4,5',
      rob: { gold: 0, food: 0, wood: 0, rock: 0, iron: 0 },
    });
  });

  it('scales and floors each resource by the remaining capacity', () => {
    expect(addResource('0', '100,200,300,400,500', 750)).toEqual({
      resource: '50,100,150,200,250',
      rob: { gold: 50, food: 100, wood: 150, rock: 200, iron: 250 },
    });
    expect(addResource('10,0,0,0,0', '100,200,300,400,500', 760)).toEqual({
      resource: '60,100,150,200,250',
      rob: { gold: 50, food: 100, wood: 150, rock: 200, iron: 250 },
    });
  });

  it('supports excluding gold and floors fractional shares', () => {
    const city = ['0', '200', '300', '400', '500'].join(',');
    const result = addResource('1,2,3,4,5', city, 351);
    expect(result.resource).toBe('1,50,75,100,125');
    expect(result.rob).toEqual({ gold: 0, food: 48, wood: 72, rock: 96, iron: 120 });
  });
});
