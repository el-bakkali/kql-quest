import { isTouchDevice, resetVirtualInput, virtualInput, type VirtualAction } from '../game/virtualInput';

let root: HTMLDivElement | null = null;

const BUTTONS: Array<{ action: VirtualAction; label: string; cls: string; aria: string }> = [
  { action: 'left', label: '\u25c0', cls: 'tc-btn tc-left', aria: 'Move left' },
  { action: 'right', label: '\u25b6', cls: 'tc-btn tc-right', aria: 'Move right' },
  { action: 'interact', label: 'USE', cls: 'tc-btn tc-use', aria: 'Use terminal' },
  { action: 'jump', label: 'JUMP', cls: 'tc-btn tc-jump', aria: 'Jump' },
  { action: 'menu', label: '\u2630', cls: 'tc-btn tc-menu', aria: 'Back to menu' },
];

function bind(button: HTMLButtonElement, action: VirtualAction) {
  const press = (event: PointerEvent) => {
    event.preventDefault();
    virtualInput[action] = true;
    button.classList.add('pressed');
    try {
      // Keeps the button held even if the finger slides off its bounds.
      button.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; a rejected pointer id must not break the press.
    }
  };

  const release = (event: PointerEvent) => {
    event.preventDefault();
    virtualInput[action] = false;
    button.classList.remove('pressed');
    try {
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing to release.
    }
  };

  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => {
    virtualInput[action] = false;
    button.classList.remove('pressed');
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

function build() {
  root = document.createElement('div');
  root.className = 'touch-controls';
  root.hidden = true;

  const pad = document.createElement('div');
  pad.className = 'tc-pad';
  const actions = document.createElement('div');
  actions.className = 'tc-actions';

  for (const spec of BUTTONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = spec.cls;
    button.textContent = spec.label;
    button.setAttribute('aria-label', spec.aria);
    bind(button, spec.action);

    if (spec.action === 'left' || spec.action === 'right') pad.appendChild(button);
    else if (spec.action === 'menu') root.appendChild(button);
    else actions.appendChild(button);
  }

  root.append(pad, actions);
  document.body.appendChild(root);

  // A tab switch or a dropped pointer must never leave a direction stuck on.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetVirtualInput();
  });
  window.addEventListener('blur', () => resetVirtualInput());
}

export function mountTouchControls() {
  if (!isTouchDevice() || root) return;
  const existing = document.querySelector<HTMLDivElement>('.touch-controls');
  if (existing) {
    root = existing;
    return;
  }
  build();
}

export function setTouchControlsVisible(visible: boolean) {
  if (!root) return;
  root.hidden = !visible;
  if (!visible) {
    resetVirtualInput();
    root.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
  }
}

/** Pulses the USE button so it is obvious how to open a terminal on a phone. */
export function setUseHighlight(active: boolean) {
  root?.querySelector('.tc-use')?.classList.toggle('ready', active);
}
