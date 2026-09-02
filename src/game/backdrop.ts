import Phaser from 'phaser';
import { lerpColor, paletteFor } from './palette';

interface Point {
  x: number;
  y: number;
}

/**
 * Horizon lines are world coordinates, not screen fractions, so the scenery sits in
 * the right place no matter how tall or wide the viewport turns out to be.
 */
const HORIZON_FAR = 292;
const HORIZON_MID = 352;
const HORIZON_NEAR = 402;
const FILL_BOTTOM = 2000;

const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

function rgba(value: number, alpha: number) {
  const color = Phaser.Display.Color.IntegerToColor(value);
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})`;
}

/** The sky lives in CSS behind a transparent canvas: infinitely crisp, zero draw cost. */
export function applySkyCss(world: number) {
  const palette = paletteFor(world);
  const host = document.getElementById('game');
  if (!host) return;
  host.style.background = [
    `radial-gradient(circle at 78% 15%, ${rgba(palette.sun, 0.95)} 0%, ${rgba(palette.sun, 0.5)} 1.6%, ${rgba(palette.sunGlow, 0.2)} 7%, ${rgba(palette.sunGlow, 0)} 30%)`,
    `linear-gradient(180deg, ${hex(palette.skyTop)} 0%, ${hex(palette.skyMid)} 56%, ${hex(palette.skyBottom)} 100%)`,
  ].join(', ');
}

function ridgePoints(width: number, baseY: number, amplitude: number, frequency: number, phase: number): Point[] {
  const points: Point[] = [];
  for (let x = 0; x <= width; x += 12) {
    const n =
      Math.sin(x * frequency + phase) * 0.55 +
      Math.sin(x * frequency * 2.17 + phase * 1.7) * 0.28 +
      Math.sin(x * frequency * 0.43 + phase * 0.6) * 0.17;
    points.push({ x, y: baseY - n * amplitude });
  }
  return points;
}

function fillRidge(g: Phaser.GameObjects.Graphics, points: Point[], width: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillPoints([{ x: 0, y: FILL_BOTTOM }, ...points, { x: width, y: FILL_BOTTOM }], true);
}

function heightAt(points: Point[], x: number): number {
  const index = Phaser.Math.Clamp(Math.round(x / 12), 0, points.length - 1);
  return points[index].y;
}

export function tree(
  g: Phaser.GameObjects.Graphics,
  rnd: Phaser.Math.RandomDataGenerator,
  x: number,
  groundY: number,
  height: number,
  color: number,
  broadleaf: boolean,
) {
  g.fillStyle(color, 1);
  const trunk = Math.max(2, height * 0.05);
  g.fillRect(x - trunk / 2, groundY - height * 0.32, trunk, height * 0.34);

  if (broadleaf) {
    const crownR = height * 0.3;
    const top = groundY - height * 0.62;
    g.fillCircle(x, top, crownR);
    g.fillCircle(x - crownR * 0.75, top + crownR * 0.42, crownR * 0.72);
    g.fillCircle(x + crownR * 0.78, top + crownR * 0.38, crownR * 0.68);
    g.fillCircle(x - crownR * 0.2, top - crownR * 0.5, crownR * 0.6);
    return;
  }

  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const spread = height * (0.3 - t * 0.19) * rnd.realInRange(0.9, 1.12);
    const baseY = groundY - height * (0.28 + t * 0.19);
    const tipY = groundY - height * (0.55 + t * 0.185);
    g.fillTriangle(x - spread, baseY, x + spread, baseY, x + rnd.realInRange(-2, 2), tipY);
  }
}

export interface Backdrop {
  motes: Phaser.GameObjects.Particles.ParticleEmitter;
}

export function buildBackdrop(
  scene: Phaser.Scene,
  world: number,
  worldWidth: number,
  viewW: number,
): Backdrop {
  const palette = paletteFor(world);
  const rnd = new Phaser.Math.RandomDataGenerator([`backdrop-${world}`]);
  const travel = Math.max(0, worldWidth - viewW);
  // Parallax layers only move a fraction of the camera, so they need less width.
  const span = (factor: number) => viewW + travel * factor + 600;

  const farWidth = span(0.12);
  const far = scene.add.graphics().setScrollFactor(0.12, 1).setDepth(-92);
  const farPts = ridgePoints(farWidth, HORIZON_FAR, 92, 0.0062, 1.4);
  fillRidge(far, farPts, farWidth, lerpColor(palette.ridgeFar, palette.haze, 0.28));

  const hazeWidth = span(0.16);
  const haze = scene.add.graphics().setScrollFactor(0.16, 1).setDepth(-88);
  for (let i = 0; i < 30; i++) {
    haze.fillStyle(palette.haze, 0.045);
    haze.fillEllipse(
      rnd.between(0, hazeWidth),
      HORIZON_FAR + rnd.between(6, 76),
      rnd.between(240, 520),
      rnd.between(22, 48),
    );
  }

  const midWidth = span(0.3);
  const mid = scene.add.graphics().setScrollFactor(0.3, 1).setDepth(-84);
  const midPts = ridgePoints(midWidth, HORIZON_MID, 64, 0.0098, 4.2);
  fillRidge(mid, midPts, midWidth, palette.ridgeMid);
  const treeColor = lerpColor(palette.ridgeMid, palette.canopy, 0.6);
  for (let x = 20; x < midWidth; x += rnd.between(34, 86)) {
    tree(mid, rnd, x, heightAt(midPts, x) + 5, rnd.between(34, 62), treeColor, rnd.frac() < 0.28);
  }

  const nearWidth = span(0.52);
  const near = scene.add.graphics().setScrollFactor(0.52, 1).setDepth(-78);
  const nearPts = ridgePoints(nearWidth, HORIZON_NEAR, 48, 0.0145, 2.1);
  fillRidge(near, nearPts, nearWidth, palette.ridgeNear);
  for (let x = 14; x < nearWidth; x += rnd.between(46, 110)) {
    tree(near, rnd, x, heightAt(nearPts, x) + 4, rnd.between(52, 92), palette.canopy, rnd.frac() < 0.3);
  }

  // Emitted around the emitter, which PlayScene parks on the camera each frame.
  const motes = scene.add
    .particles(0, 0, 'mote', {
      x: { min: -700, max: 700 },
      y: { min: -420, max: 420 },
      lifespan: 7000,
      frequency: 120,
      quantity: 1,
      speedX: { min: -12, max: 12 },
      speedY: { min: -22, max: -6 },
      scale: { min: 0.25, max: 0.85 },
      alpha: { start: 0.8, end: 0 },
      tint: palette.mote,
      blendMode: 'ADD',
    })
    .setDepth(-40);

  return { motes };
}

/** Dark leaf clusters that pass in front of the player. */
export function buildForeground(scene: Phaser.Scene, world: number, worldWidth: number, viewW: number) {
  const palette = paletteFor(world);
  const rnd = new Phaser.Math.RandomDataGenerator([`fg-${world}`]);
  const factor = 1.22;
  const width = viewW + Math.max(0, worldWidth - viewW) * factor + 600;

  const bushes = scene.add.graphics().setScrollFactor(factor, 1).setDepth(40);
  const leafColor = lerpColor(palette.canopy, 0x000000, 0.5);

  for (let x = rnd.between(200, 520); x < width; x += rnd.between(620, 1100)) {
    const base = 606;
    const scale = rnd.realInRange(0.62, 0.95);

    bushes.fillStyle(leafColor, 0.95);
    for (let i = 0; i < 9; i++) {
      const angle = Phaser.Math.DegToRad(-172 + i * 18 + rnd.between(-6, 6));
      const reach = rnd.realInRange(52, 104) * scale;
      bushes.fillEllipse(
        x + Math.cos(angle) * reach,
        base + Math.sin(angle) * reach * 1.25,
        rnd.realInRange(54, 96) * scale,
        rnd.realInRange(34, 58) * scale,
      );
    }
    bushes.fillEllipse(x, base, 190 * scale, 96 * scale);

    for (let i = 0; i < 3; i++) {
      const bx = x + rnd.between(-70, 70) * scale;
      const h = rnd.realInRange(60, 120) * scale;
      bushes.fillTriangle(bx - 4, base - 40, bx + 4, base - 40, bx + rnd.between(-18, 18), base - 40 - h);
    }
  }
}
