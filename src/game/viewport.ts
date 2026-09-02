import Phaser from 'phaser';

/** World pixels we aim to show vertically, whatever the screen is. */
const TARGET_VIEW_H = 500;
/** Never show less world than this horizontally, even on a tall phone. */
const MIN_VIEW_W = 620;

export interface Viewport {
  /** Canvas backing-store size, in render pixels. */
  width: number;
  height: number;
  /** Camera zoom: render pixels per world pixel. */
  zoom: number;
  /** Visible world area, in world pixels. */
  worldW: number;
  worldH: number;
  /** Multiply HUD-ish things by this so they stay physically consistent. */
  uiScale: number;
  portrait: boolean;
}

/** Capped: a 3x phone gains nothing visible but pays triple the fill cost. */
export function pixelRatio(): number {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
}

export function measure(scale: Phaser.Scale.ScaleManager): Viewport {
  const width = Math.max(1, scale.gameSize.width);
  const height = Math.max(1, scale.gameSize.height);
  const ratio = pixelRatio();

  const zoom = Math.min(height / TARGET_VIEW_H, width / MIN_VIEW_W);
  const cssHeight = height / ratio;

  return {
    width,
    height,
    zoom,
    worldW: width / zoom,
    worldH: height / zoom,
    // Nudge UI up on short screens so it stays readable.
    uiScale: ratio * (cssHeight < 460 ? 1.12 : 1),
    portrait: height > width,
  };
}
