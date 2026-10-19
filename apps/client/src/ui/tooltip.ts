import { reactive, type Directive } from 'vue';
import { DESIGN_WIDTH } from '@hot/shared';

/** Flex `toolTip`: plain text, or Flex htmlText for custom tips (WorldMapTip etc.). */
export type TipValue = string | { html: string } | null | undefined;

export const tooltip = reactive({ visible: false, text: '', html: '', x: 0, y: 0 });

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

function show(el: TipElement, e: MouseEvent) {
  const value = el._tip;
  if (!value || (typeof value === 'string' && !value.trim())) {
    tooltip.visible = false;
    return;
  }
  const p = stagePoint(el, e.clientX, e.clientY);
  tooltip.text = typeof value === 'string' ? value : '';
  tooltip.html = typeof value === 'string' ? '' : value.html;
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
