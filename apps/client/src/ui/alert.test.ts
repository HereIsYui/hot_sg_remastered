import { describe, expect, it } from 'vitest';
import { alertState, closeAlert, prefersModal, showAlert } from './alert';

describe('alert', () => {
  it('resolves with the clicked button', async () => {
    const result = showAlert('确定吗', '', ['yes', 'no']);
    const item = alertState.items.at(-1)!;
    expect(item.buttons).toEqual(['yes', 'no']);
    closeAlert(item.id, 'no');
    await expect(result).resolves.toBe('no');
    expect(alertState.items).toHaveLength(0);
  });

  it('routes texts with digits or whitespace to the modal alert like BloodWar.alert', () => {
    expect(prefersModal('建造完成')).toBe(false);
    expect(prefersModal('获得黄金100')).toBe(true);
    expect(prefersModal('a b')).toBe(true);
  });
});
