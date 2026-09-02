import Phaser from 'phaser';
import { gradientRect, lerpColor, paletteFor, type Palette } from './palette';
import { TILE } from './worldDefs';

const WORLDS = [1, 2];

function bake(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics, rnd: Phaser.Math.RandomDataGenerator) => void,
) {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  draw(g, new Phaser.Math.RandomDataGenerator([key]));
  g.generateTexture(key, w, h);
  g.destroy();
}

function radialGlow(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number) {
  const steps = 26;
  for (let i = steps; i > 0; i--) {
    const t = i / steps;
    g.fillStyle(color, 0.055 * (1 - t) + 0.012);
    g.fillCircle(cx, cy, r * t);
  }
}

function speckle(
  g: Phaser.GameObjects.Graphics,
  rnd: Phaser.Math.RandomDataGenerator,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  count: number,
  alpha = 0.35,
) {
  g.fillStyle(color, alpha);
  for (let i = 0; i < count; i++) {
    g.fillCircle(x + rnd.between(0, w), y + rnd.between(0, h), rnd.between(1, 2));
  }
}

/** Organic grass/crystal crown along the top edge of a ground tile. */
function crown(g: Phaser.GameObjects.Graphics, palette: Palette, variant: number, width: number) {
  const bumps = [
    [0, 5, 9, 4, 6, 3, 8],
    [4, 7, 3, 8, 5, 9, 4],
    [7, 3, 6, 5, 9, 4, 7],
  ][variant % 3];

  g.fillStyle(palette.capBottom, 1);
  g.fillRect(0, 6, width, 9);
  bumps.forEach((height, i) => {
    const x = (i * width) / (bumps.length - 1);
    g.fillCircle(x, 8, height * 0.62);
  });

  g.fillStyle(palette.capTop, 1);
  g.fillRect(0, 5, width, 4);
  bumps.forEach((height, i) => {
    const x = (i * width) / (bumps.length - 1);
    g.fillCircle(x, 7, height * 0.45);
  });

  g.fillStyle(lerpColor(palette.capTop, 0xffffff, 0.45), 0.75);
  bumps.forEach((height, i) => {
    const x = (i * width) / (bumps.length - 1);
    g.fillCircle(x, 6 - height * 0.12, height * 0.22);
  });
}

function bakeWorldTiles(scene: Phaser.Scene, world: number) {
  const palette = paletteFor(world);

  for (let v = 0; v < 3; v++) {
    bake(scene, `cap-${world}-${v}`, TILE, TILE, (g, rnd) => {
      gradientRect(g, 0, 0, TILE, TILE, palette.soilTop, palette.soilBottom, 12);
      speckle(g, rnd, 0, 14, TILE, TILE - 14, palette.soilBottom, 10, 0.5);
      speckle(g, rnd, 0, 14, TILE, TILE - 14, lerpColor(palette.soilTop, 0xffffff, 0.25), 6, 0.18);
      crown(g, palette, v, TILE);
    });
  }

  bake(scene, `soil-${world}`, TILE, TILE, (g, rnd) => {
    gradientRect(g, 0, 0, TILE, TILE, palette.soilTop, palette.soilBottom, 10);
    g.fillStyle(lerpColor(palette.soilTop, 0x000000, 0.35), 0.5);
    g.fillRect(0, 9, TILE, 2);
    g.fillRect(0, 23, TILE, 3);
    g.fillStyle(lerpColor(palette.soilTop, 0xffffff, 0.3), 0.14);
    g.fillRect(0, 11, TILE, 1);
    g.fillRect(0, 26, TILE, 1);
    speckle(g, rnd, 0, 0, TILE, TILE, palette.soilBottom, 12, 0.4);
    g.fillStyle(lerpColor(palette.soilTop, 0xffffff, 0.2), 0.14);
    g.fillEllipse(rnd.between(6, 26), rnd.between(4, 20), rnd.between(6, 12), rnd.between(4, 8));
    g.fillEllipse(rnd.between(6, 26), rnd.between(14, 28), rnd.between(5, 10), rnd.between(3, 7));
  });

  bake(scene, `slab-${world}`, TILE, 20, (g) => {
    g.fillStyle(palette.soilBottom, 1);
    g.fillRoundedRect(0, 3, TILE, 16, 6);
    gradientRect(g, 1, 4, TILE - 2, 10, palette.soilTop, palette.soilBottom, 6);
    g.fillStyle(palette.capBottom, 1);
    g.fillRoundedRect(0, 1, TILE, 8, 4);
    g.fillStyle(palette.capTop, 1);
    g.fillRoundedRect(1, 0, TILE - 2, 5, 3);
    g.fillStyle(palette.accent, 0.55);
    g.fillRect(3, 18, TILE - 6, 2);
  });

  for (let v = 0; v < 3; v++) {
    bake(scene, `flora-${world}-${v}`, 26, 26, (g) => {
      if (world === 1) {
        const blades: Array<[number, number, number, number]> = [
          [12, 26, 4, 8],
          [7, 26, -5, 13],
          [17, 26, 6, 11],
        ];
        blades.forEach(([x, y, dx, len], i) => {
          g.fillStyle(i === v % 3 ? palette.capTop : palette.capBottom, 1);
          g.fillTriangle(x - 2, y, x + 2, y, x + dx, y - len - 6);
        });
        g.fillStyle(lerpColor(palette.capTop, 0xffffff, 0.5), 0.9);
        g.fillCircle(12 + v * 2, 6 + v, 2);
      } else {
        const shards: Array<[number, number, number, number]> = [
          [13, 26, 5, 16],
          [7, 26, 3, 11],
          [19, 26, 4, 13],
        ];
        shards.forEach(([x, y, w, h]) => {
          g.fillStyle(palette.capBottom, 1);
          g.fillTriangle(x - w, y, x + w, y, x, y - h);
          g.fillStyle(palette.capTop, 0.85);
          g.fillTriangle(x - w * 0.4, y, x + w * 0.4, y, x, y - h * 0.75);
        });
        g.fillStyle(lerpColor(palette.capTop, 0xffffff, 0.6), 0.9);
        g.fillCircle(13, 10, 2);
      }
    });
  }

  bake(scene, `rock-${world}`, 34, 22, (g, rnd) => {
    g.fillStyle(palette.soilBottom, 1);
    g.fillPoints(
      [
        { x: 2, y: 22 },
        { x: 6, y: 10 },
        { x: 14, y: 3 },
        { x: 24, y: 6 },
        { x: 32, y: 15 },
        { x: 33, y: 22 },
      ],
      true,
    );
    g.fillStyle(lerpColor(palette.soilTop, 0xffffff, 0.22), 0.8);
    g.fillPoints(
      [
        { x: 8, y: 12 },
        { x: 15, y: 5 },
        { x: 22, y: 8 },
        { x: 16, y: 13 },
      ],
      true,
    );
    speckle(g, rnd, 4, 8, 26, 12, palette.soilBottom, 6, 0.5);
  });

  bake(scene, `spike-${world}`, TILE, 20, (g) => {
    for (let i = 0; i < 4; i++) {
      const x = i * 8;
      g.fillStyle(lerpColor(palette.ridgeNear, 0xffffff, 0.35), 1);
      g.fillTriangle(x, 20, x + 4, 1, x + 8, 20);
      g.fillStyle(lerpColor(palette.ridgeNear, 0xffffff, 0.7), 0.9);
      g.fillTriangle(x + 2, 20, x + 4, 3, x + 5, 20);
    }
    g.fillStyle(palette.soilBottom, 1);
    g.fillRect(0, 17, TILE, 3);
  });

  bake(scene, `glow-${world}`, 160, 160, (g) => radialGlow(g, 80, 80, 78, palette.accent));
}

function bakeCharacter(scene: Phaser.Scene) {
  const HOOD = 0x1b3a5c;
  const HOOD_DARK = 0x122942;
  const TRIM = 0x22d3ee;
  const SKIN = 0xffd9b8;

  bake(scene, 'p-shadow', 44, 14, (g) => {
    for (let i = 6; i > 0; i--) {
      g.fillStyle(0x000000, 0.06);
      g.fillEllipse(22, 7, 40 * (i / 6), 12 * (i / 6));
    }
  });

  bake(scene, 'p-torso', 28, 30, (g) => {
    g.fillStyle(HOOD_DARK, 1);
    g.fillRoundedRect(1, 2, 26, 26, 10);
    gradientRect(g, 3, 5, 22, 20, HOOD, HOOD_DARK, 10);
    g.fillStyle(HOOD, 1);
    g.fillRoundedRect(3, 2, 22, 11, 6);
    g.fillStyle(TRIM, 0.95);
    g.fillRoundedRect(7, 10, 14, 3, 2);
    g.fillStyle(TRIM, 1);
    g.fillRect(13, 16, 2, 7);
    g.fillRect(10, 19, 8, 2);
    g.fillStyle(0xffffff, 0.12);
    g.fillEllipse(9, 13, 8, 13);
  });

  bake(scene, 'p-head', 40, 44, (g) => {
    // the tuft sits above the skull so it never covers the face
    g.fillStyle(0x14263d, 1);
    g.fillTriangle(13, 16, 27, 6, 39, 0);
    g.fillTriangle(12, 13, 24, 3, 33, 2);
    g.fillStyle(TRIM, 0.95);
    g.fillCircle(38, 1, 2.8);

    g.fillStyle(0x0d1b2e, 1);
    g.fillCircle(20, 25, 16);
    g.fillStyle(SKIN, 1);
    g.fillCircle(20, 25, 14.6);
    g.fillStyle(lerpColor(SKIN, 0xffffff, 0.45), 0.55);
    g.fillCircle(15, 19, 7.5);

    // hood edge framing the face
    g.fillStyle(0x14263d, 1);
    g.fillEllipse(20, 12, 31, 14);
    g.fillStyle(HOOD, 1);
    g.fillEllipse(20, 11, 28, 11);

    g.fillStyle(0x0b1220, 1);
    g.fillRoundedRect(7, 22, 26, 9, 4);
    g.fillStyle(TRIM, 1);
    g.fillCircle(14, 26.5, 2.8);
    g.fillCircle(26, 26.5, 2.8);
    g.fillStyle(0xffffff, 0.95);
    g.fillCircle(13, 25.4, 1.2);
    g.fillCircle(25, 25.4, 1.2);
    g.fillStyle(0xffffff, 0.16);
    g.fillRect(9, 23, 22, 2);

    g.fillStyle(0xc98b6b, 0.4);
    g.fillEllipse(20, 35, 8, 3);
  });

  bake(scene, 'p-hand', 18, 18, (g) => {
    g.fillStyle(0x0d1b2e, 1);
    g.fillCircle(9, 9, 8);
    g.fillStyle(0xf1f5f9, 1);
    g.fillCircle(9, 9, 6.6);
    g.fillStyle(TRIM, 0.9);
    g.fillRoundedRect(3, 11, 12, 3, 1.5);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(6.5, 6.5, 2);
  });

  bake(scene, 'p-foot', 22, 14, (g) => {
    g.fillStyle(0x0d1b2e, 1);
    g.fillRoundedRect(0, 2, 22, 12, 5);
    g.fillStyle(0xf1f5f9, 1);
    g.fillRoundedRect(0, 9, 22, 5, 2.5);
    g.fillStyle(TRIM, 0.9);
    g.fillRect(4, 5, 9, 2);
  });
}

function bakeProps(scene: Phaser.Scene) {
  bake(scene, 'terminal-body', 52, 76, (g) => {
    g.fillStyle(0x0a1220, 1);
    g.fillTriangle(10, 76, 42, 76, 34, 48);
    g.fillTriangle(18, 76, 34, 48, 18, 48);
    g.fillStyle(0x16243c, 1);
    g.fillRoundedRect(12, 44, 28, 10, 3);
    g.fillStyle(0x1c2c48, 1);
    g.fillRoundedRect(1, 0, 50, 50, 8);
    g.fillStyle(0x0f1a2c, 1);
    g.fillRoundedRect(4, 3, 44, 42, 6);
    g.fillStyle(0x2b3f63, 1);
    g.fillRoundedRect(1, 0, 50, 5, 3);
    g.fillStyle(0x0a1220, 1);
    g.fillCircle(8, 47, 2);
    g.fillCircle(44, 47, 2);
  });

  bake(scene, 'terminal-screen-off', 40, 36, (g) => {
    g.fillStyle(0x111d33, 1);
    g.fillRoundedRect(0, 0, 40, 36, 4);
    g.fillStyle(0x33415c, 0.85);
    g.fillRect(5, 7, 20, 2);
    g.fillRect(5, 14, 26, 2);
    g.fillRect(5, 21, 16, 2);
    g.fillRect(5, 28, 22, 2);
  });

  bake(scene, 'terminal-screen-on', 40, 36, (g) => {
    g.fillStyle(0x06251c, 1);
    g.fillRoundedRect(0, 0, 40, 36, 4);
    g.fillStyle(0x4ade80, 1);
    g.fillRect(5, 7, 26, 2);
    g.fillRect(5, 14, 18, 2);
    g.fillRect(5, 21, 30, 2);
    g.fillRect(5, 28, 12, 2);
    g.fillStyle(0xbbf7d0, 1);
    g.fillRect(20, 28, 5, 2);
  });

  bake(scene, 'shard', 26, 30, (g) => {
    g.fillStyle(0xf59e0b, 1);
    g.fillPoints(
      [
        { x: 13, y: 0 },
        { x: 25, y: 12 },
        { x: 13, y: 30 },
        { x: 1, y: 12 },
      ],
      true,
    );
    g.fillStyle(0xfbbf24, 1);
    g.fillPoints(
      [
        { x: 13, y: 3 },
        { x: 21, y: 12 },
        { x: 13, y: 26 },
      ],
      true,
    );
    g.fillStyle(0xfff7d6, 0.95);
    g.fillPoints(
      [
        { x: 13, y: 5 },
        { x: 17, y: 12 },
        { x: 13, y: 20 },
        { x: 9, y: 12 },
      ],
      true,
    );
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(11, 9, 1.6);
  });

  bake(scene, 'drone', 44, 30, (g) => {
    g.fillStyle(0x3b1e6e, 1);
    g.fillEllipse(22, 17, 40, 18);
    g.fillStyle(0x6d28d9, 1);
    g.fillEllipse(22, 15, 34, 13);
    g.fillStyle(0x0b1220, 1);
    g.fillEllipse(22, 16, 16, 10);
    g.fillStyle(0xf472b6, 1);
    g.fillCircle(22, 16, 4);
    g.fillStyle(0xffe4f3, 1);
    g.fillCircle(20.5, 14.5, 1.6);
    g.fillStyle(0x4c1d95, 1);
    g.fillRoundedRect(4, 2, 14, 4, 2);
    g.fillRoundedRect(26, 2, 14, 4, 2);
    g.fillStyle(0xa78bfa, 0.5);
    g.fillEllipse(11, 4, 20, 4);
    g.fillEllipse(33, 4, 20, 4);
    g.fillStyle(0xf472b6, 0.35);
    g.fillEllipse(22, 26, 26, 7);
  });

  bake(scene, 'gate-post', 22, 168, (g) => {
    g.fillStyle(0x0b1220, 1);
    g.fillRoundedRect(0, 0, 22, 168, 6);
    gradientRect(g, 2, 2, 18, 164, 0x334869, 0x16233a, 20);
    g.fillStyle(0x64748b, 0.8);
    for (let y = 8; y < 160; y += 22) g.fillRect(3, y, 16, 3);
  });

  bake(scene, 'gate-field', 56, 160, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle(0xf87171, 0.18 + (i % 2) * 0.08);
      g.fillRect(0, i * 20, 56, 18);
    }
    g.fillStyle(0xfecaca, 0.7);
    g.fillRect(0, 0, 56, 3);
    g.fillRect(0, 157, 56, 3);
  });

  bake(scene, 'spark', 10, 10, (g) => {
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(5, 5, 5);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(5, 5, 2.6);
  });

  bake(scene, 'dust', 16, 16, (g) => {
    for (let i = 5; i > 0; i--) {
      g.fillStyle(0xffffff, 0.1);
      g.fillCircle(8, 8, (8 * i) / 5);
    }
  });

  bake(scene, 'mote', 8, 8, (g) => {
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(4, 4, 4);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 1.6);
  });
}

export function createTextures(scene: Phaser.Scene) {
  bakeCharacter(scene);
  bakeProps(scene);
  for (const world of WORLDS) bakeWorldTiles(scene, world);
}
