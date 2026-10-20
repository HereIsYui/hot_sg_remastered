import { reactive } from 'vue';

/** An entry of `mx.controls.Menu` data: `label`, `data`, optionally disabled. */
export interface MenuItem {
  label: string;
  data: string;
  enabled?: boolean;
}

export const menuState = reactive({
  visible: false,
  items: [] as MenuItem[],
  styleName: '',
  x: 0,
  y: 0,
});

let pending: ((data: string | null) => void) | null = null;

/**
 * `Menu.createMenu(...).show(stageX, stageY)`: a popup menu at a stage point; resolves with the
 * chosen entry's `data`, or null when the menu closes otherwise.
 */
export function showMenu(
  items: MenuItem[],
  x: number,
  y: number,
  styleName = 'PopupMenu',
): Promise<string | null> {
  pending?.(null);
  Object.assign(menuState, { visible: true, items, styleName, x, y });
  return new Promise((resolve) => (pending = resolve));
}

export function closeMenu(data: string | null): void {
  const resolve = pending;
  pending = null;
  menuState.visible = false;
  resolve?.(data);
}
