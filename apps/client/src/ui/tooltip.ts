import { reactive, type Directive } from 'vue';
import { DESIGN_WIDTH } from '@hot/shared';
import type { ArmorTip } from '../game/armor';

/** One line of a ResourceRelatedToolTip; `ok` false paints the needed amount red. */
export interface ResourceTipRow {
  type: string;
  need: string;
  current: string;
  ok: boolean;
}

/** `Tooltip.ResourceRelatedToolTip`: costs and conditions of building, upgrading, demolishing. */
export interface ResourceTip {
  title: string;
  description: string;
  /** Column titles and the time label (`setResourceTitle`); the build titles by default. */
  headers?: { type: string; need: string; current: string; time: string };
  /** `setUpgradeTime`: the formatted duration, or null to hide the bottom line. */
  time: string | null;
  rows: ResourceTipRow[];
}

/** `Tooltip.GoodsTip`: an item's name over its htmlText description. */
export interface GoodsTip {
  title: string;
  text: string;
}

/**
 * Flex `toolTip`: plain text, Flex htmlText for custom tips (WorldMapTip etc.), a
 * ResourceRelatedToolTip built when the pointer arrives, or a GoodsTip.
 */
export type TipValue =
  | string
  | { html: string }
  | { resource: () => ResourceTip | string | null }
  | { goods: GoodsTip }
  | { skill: GoodsTip }
  | { armor: () => ArmorTip | null }
  | null
  | undefined;

export const tooltip = reactive({
  visible: false,
  text: '',
  html: '',
  resource: null as ResourceTip | null,
  goods: null as GoodsTip | null,
  skill: null as GoodsTip | null,
  armor: null as ArmorTip | null,
  x: 0,
  y: 0,
});

/** Converts a pointer position to the 1000x600 design coordinates of the enclosing stage. */
export function stagePoint(
  el: Element,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const stage = el.closest('.stage') ?? el;
  const rect = stage.getBoundingClientRect();
  const scale = rect.width / DESIGN_WIDTH || 1;
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

interface TipElement extends HTMLElement {
  _tip?: TipValue;
  _tipCleanup?: () => void;
}

/** Pointer events already answered by a nested tip; containers further up leave them alone. */
const claimed = new WeakSet<Event>();

function show(el: TipElement, e: MouseEvent) {
  if (claimed.has(e)) return;
  let value: TipValue | ResourceTip | { armorTip: ArmorTip | null } = el._tip;
  if (value && typeof value === 'object' && 'resource' in value) value = value.resource();
  if (value && typeof value === 'object' && 'armor' in value) {
    const armorTip = value.armor();
    value = armorTip && { armorTip };
  }
  if (!value || (typeof value === 'string' && !value.trim())) {
    tooltip.visible = false;
    return;
  }
  claimed.add(e);
  const p = stagePoint(el, e.clientX, e.clientY);
  tooltip.text = typeof value === 'string' ? value : '';
  tooltip.html = typeof value === 'object' && 'html' in value ? value.html : '';
  tooltip.resource = typeof value === 'object' && 'rows' in value ? value : null;
  tooltip.goods = typeof value === 'object' && 'goods' in value ? value.goods : null;
  tooltip.skill = typeof value === 'object' && 'skill' in value ? value.skill : null;
  tooltip.armor = typeof value === 'object' && 'armorTip' in value ? value.armorTip : null;
  tooltip.x = p.x + 10;
  tooltip.y = p.y + 20;
  tooltip.visible = true;
}

export const vTip: Directive<TipElement, TipValue> = {
  mounted(el, binding) {
    el._tip = binding.value;
    const move = (e: MouseEvent) => show(el, e);
    const leave = () => {
      tooltip.visible = false;
    };
    el.addEventListener('mouseenter', move);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', leave);
    el._tipCleanup = () => {
      el.removeEventListener('mouseenter', move);
      el.removeEventListener('mousemove', move);
      el.removeEventListener('mouseleave', leave);
    };
  },
  updated(el, binding) {
    el._tip = binding.value;
  },
  unmounted(el) {
    el._tipCleanup?.();
    tooltip.visible = false;
  },
};
