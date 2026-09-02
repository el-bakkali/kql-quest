import Phaser from 'phaser';

export interface Palette {
  skyTop: number;
  skyMid: number;
  skyBottom: number;
  sun: number;
  sunGlow: number;
  ridgeFar: number;
  ridgeMid: number;
  ridgeNear: number;
  canopy: number;
  capTop: number;
  capBottom: number;
  soilTop: number;
  soilBottom: number;
  accent: number;
  accentSoft: number;
  mote: number;
  haze: number;
}

export const PALETTES: Record<number, Palette> = {
  1: {
    skyTop: 0x071229,
    skyMid: 0x1b4a72,
    skyBottom: 0x7fc0d8,
    sun: 0xfff0c4,
    sunGlow: 0x6fa8cf,
    ridgeFar: 0x3a6f92,
    ridgeMid: 0x24506e,
    ridgeNear: 0x14324a,
    canopy: 0x0d2233,
    capTop: 0x53d9a2,
    capBottom: 0x1f8f68,
    soilTop: 0x2c4a63,
    soilBottom: 0x14273a,
    accent: 0x22d3ee,
    accentSoft: 0x7dd3fc,
    mote: 0xbdf0ff,
    haze: 0x9fd6e8,
  },
  2: {
    skyTop: 0x140b2c,
    skyMid: 0x4b2a72,
    skyBottom: 0xd3799a,
    sun: 0xffd9a8,
    sunGlow: 0xff6f91,
    ridgeFar: 0x6a4790,
    ridgeMid: 0x452e68,
    ridgeNear: 0x291a42,
    canopy: 0x1a1030,
    capTop: 0xc4a6ff,
    capBottom: 0x7c5ce0,
    soilTop: 0x402f66,
    soilBottom: 0x211636,
    accent: 0xa78bfa,
    accentSoft: 0xd8c7ff,
    mote: 0xffd7f0,
    haze: 0xe0a8c8,
  },
};

export const paletteFor = (world: number): Palette => PALETTES[world] ?? PALETTES[1];

export function lerpColor(from: number, to: number, t: number): number {
  const a = Phaser.Display.Color.IntegerToColor(from);
  const b = Phaser.Display.Color.IntegerToColor(to);
  const mix = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, Math.round(t * 100));
  return Phaser.Display.Color.GetColor(mix.r, mix.g, mix.b);
}

/** Renderer-agnostic vertical gradient: fillGradientStyle is WebGL-only. */
export function gradientRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  top: number,
  bottom: number,
  bands = Math.max(2, Math.round(h / 2)),
) {
  const step = h / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle(lerpColor(top, bottom, i / (bands - 1 || 1)), 1);
    g.fillRect(x, y + i * step, w, step + 1);
  }
}
