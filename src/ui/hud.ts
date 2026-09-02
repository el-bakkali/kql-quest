import { virtualInput } from '../game/virtualInput';

let root: HTMLDivElement | null = null;
let bannerTimer = 0;

function el<T extends HTMLElement>(selector: string): T {
  return root!.querySelector(selector) as T;
}

function build() {
  root = document.createElement('div');
  root.className = 'game-hud';
  root.hidden = true;
  root.innerHTML = `
    <div class="hud-stats">
      <span class="hud-world"></span>
      <span class="hud-pips"></span>
      <span class="hud-xp"></span>
    </div>
    <button class="hud-prompt" type="button" hidden></button>
    <div class="hud-banner" hidden></div>
    <div class="hud-complete" hidden></div>`;
  document.body.appendChild(root);

  // Tapping the prompt is the discoverable way in on a phone.
  root.querySelector('.hud-prompt')!.addEventListener('click', () => {
    virtualInput.interact = true;
    window.setTimeout(() => {
      virtualInput.interact = false;
    }, 220);
  });
}

export function mountHud() {
  if (root) return;
  const existing = document.querySelector<HTMLDivElement>('.game-hud');
  if (existing) {
    root = existing;
    return;
  }
  build();
}

export function setHudVisible(visible: boolean) {
  mountHud();
  root!.hidden = !visible;
  if (!visible) {
    el('.hud-prompt').hidden = true;
    el('.hud-banner').hidden = true;
    el('.hud-complete').hidden = true;
  }
}

export function setHudStats(world: string, cleared: number, total: number, xp: number, shards: number) {
  mountHud();
  el('.hud-world').textContent = world;
  el('.hud-pips').textContent = '\u25c6'.repeat(cleared) + '\u25c7'.repeat(Math.max(0, total - cleared));
  el('.hud-xp').textContent = `${xp} XP  ·  ${shards} shards`;
}

export function setHudPrompt(text: string | null) {
  mountHud();
  const prompt = el('.hud-prompt');
  if (text) prompt.textContent = text;
  prompt.hidden = !text;
}

export function showHudBanner(text: string) {
  mountHud();
  const banner = el('.hud-banner');
  banner.textContent = text;
  banner.hidden = false;
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    banner.hidden = true;
  }, 3600);
}

export function showHudComplete(text: string | null) {
  mountHud();
  const complete = el('.hud-complete');
  if (text) complete.textContent = text;
  complete.hidden = !text;
}
