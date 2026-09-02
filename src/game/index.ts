import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { PlayScene } from './scenes/PlayScene';
import { pixelRatio } from './viewport';

export function startGame(parent: HTMLElement): Phaser.Game {
  const ratio = pixelRatio();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    // Sizing is manual: RESIZE mode ignores zoom, so it cannot render above 1x.
    // The backing store is CSS pixels times the device ratio, and zoom scales the
    // canvas back down in CSS. Phaser must own that zoom, otherwise its pointer
    // maths is off by the device ratio and nothing is clickable.
    scale: {
      mode: Phaser.Scale.NONE,
      width: Math.max(1, parent.clientWidth) * ratio,
      height: Math.max(1, parent.clientHeight) * ratio,
      zoom: 1 / ratio,
    },
    // The sky is a CSS gradient behind the canvas, so it stays crisp at any size.
    transparent: true,
    physics: {
      default: 'arcade',
      // Gravity is applied per-body so drones can float.
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [BootScene, MenuScene, PlayScene],
  });

  const fit = () => {
    const cssWidth = Math.max(1, parent.clientWidth);
    const cssHeight = Math.max(1, parent.clientHeight);
    const dpr = pixelRatio();
    const zoom = 1 / dpr;
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(cssHeight * dpr);

    const scale = game.scale;
    const zoomChanged = Math.abs(scale.zoom - zoom) > 1e-6;
    if (zoomChanged) scale.setZoom(zoom);

    // Resizing reallocates the WebGL drawing buffer, so only do it when it matters.
    if (zoomChanged || scale.gameSize.width !== targetWidth || scale.gameSize.height !== targetHeight) {
      scale.resize(targetWidth, targetHeight);
    } else {
      scale.refresh();
    }
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    fit();
    requestAnimationFrame(fit);
  });
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));
  window.addEventListener('scroll', () => game.scale.updateBounds(), { passive: true });
  window.visualViewport?.addEventListener('resize', fit);
  // The container can change size without the window doing so, e.g. when embedded.
  new ResizeObserver(fit).observe(parent);

  if (import.meta.env.DEV) {
    (window as unknown as { __game: Phaser.Game }).__game = game;
  }

  return game;
}
