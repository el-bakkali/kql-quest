export type VirtualAction = 'left' | 'right' | 'jump' | 'interact' | 'menu';

export type VirtualInput = Record<VirtualAction, boolean>;

export const virtualInput: VirtualInput = {
  left: false,
  right: false,
  jump: false,
  interact: false,
  menu: false,
};

export function resetVirtualInput() {
  virtualInput.left = false;
  virtualInput.right = false;
  virtualInput.jump = false;
  virtualInput.interact = false;
  virtualInput.menu = false;
}

/** True when the primary pointer is a finger. A touch laptop with a mouse is not. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
