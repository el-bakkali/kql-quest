import Phaser from 'phaser';
import { CASE_SUMMARY, CASE_TITLE, LEVELS, levelsForWorld, WORLDS } from '../../data/levels';
import { progress } from '../../engine/progress';
import { setHudVisible } from '../../ui/hud';
import { applySkyCss, tree } from '../backdrop';
import { lerpColor, paletteFor } from '../palette';
import { sfx } from '../sfx';
import { isTouchDevice } from '../virtualInput';
import { measure } from '../viewport';

interface Design {
  w: number;
  h: number;
  columns: number;
  cardW: number;
  cardH: number;
  cardY: number;
  gap: number;
}

const LANDSCAPE: Design = { w: 960, h: 544, columns: 3, cardW: 276, cardH: 252, cardY: 142, gap: 22 };
const PORTRAIT: Design = { w: 620, h: 1100, columns: 1, cardW: 520, cardH: 252, cardY: 190, gap: 16 };

export class MenuScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private design: Design = LANDSCAPE;

  constructor() {
    super('Menu');
  }
  create() {
    applySkyCss(1);
    setHudVisible(false);

    this.build();
    this.scale.on('resize', this.onResize, this);
    // One deferred pass catches a viewport that settled after the scene started.
    this.time.delayedCall(60, () => this.onResize());
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  private onResize() {
    if (!this.root) return;
    const wantsPortrait = measure(this.scale).portrait;
    if (wantsPortrait !== (this.design === PORTRAIT)) {
      this.rebuild();
      return;
    }
    this.layout();
  }

  private rebuild() {
    this.root.destroy(true);
    this.build();
  }

  private build() {
    const viewport = measure(this.scale);
    this.design = viewport.portrait ? PORTRAIT : LANDSCAPE;
    const design = this.design;

    this.root = this.add.container(0, 0);
    this.drawScenery(design);

    this.text(design.w / 2, design === PORTRAIT ? 96 : 58, 'KQL QUEST', {
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: design === PORTRAIT ? '48px' : '58px',
      color: '#7dd3fc',
    })
      .setOrigin(0.5)
      .setShadow(0, 0, '#0ea5e9', 22);

    this.text(design.w / 2, design === PORTRAIT ? 142 : 100, 'Run. Jump. Query. Learn Kusto the hard-to-forget way.', {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '16px',
      color: '#cbd5e1',
      align: 'center',
      wordWrap: { width: design.w - 60 },
    }).setOrigin(0.5);

    this.text(design.w / 2, design === PORTRAIT ? 172 : 126, CASE_TITLE.toUpperCase(), {
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: '12px',
      color: '#f472b6',
    }).setOrigin(0.5);

    const startX = (design.w - (design.cardW * design.columns + design.gap * (design.columns - 1))) / 2;
    WORLDS.forEach((world, index) => {
      const { x, y } = this.slot(design, startX, index);
      this.buildWorldCard(world, x, y);
    });
    const caseSlot = this.slot(design, startX, WORLDS.length);
    this.buildCaseFile(caseSlot.x, caseSlot.y);

    const footerY = design === PORTRAIT ? 1012 : 422;
    const solved = progress.current.solved.length;

    // The hills behind this area are light, so the text needs a plate to stay legible.
    const plate = this.add.graphics();
    this.root.add(plate);
    plate.fillStyle(0x040a15, 0.62);
    plate.fillRoundedRect(design.w / 2 - 300, footerY - 22, 600, design === PORTRAIT ? 104 : 108, 12);

    this.text(
      design.w / 2,
      footerY,
      `${solved} / ${LEVELS.length} terminals cleared      ${progress.current.xp} XP      ${progress.current.shards} data shards`,
      { fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: '14px', color: '#fbbf24' },
    ).setOrigin(0.5);

    this.text(
      design.w / 2,
      footerY + (design === PORTRAIT ? 44 : 46),
      isTouchDevice()
        ? 'Tap a world to start\nPad moves you  \u2022  JUMP twice to double jump  \u2022  USE opens a terminal'
        : 'Move  A / D or \u2190 \u2192      Jump  W / Space (twice to double jump)\nTerminal  E      Respawn  R      Menu  M',
      {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: '#94a3b8',
        align: 'center',
        lineSpacing: 7,
        wordWrap: { width: design.w - 40 },
      },
    ).setOrigin(0.5);

    this.button(design.w - 92, 28, 148, 30, 'Reset progress', 0x7f1d1d, () => {
      progress.reset();
      this.scene.restart();
    });

    this.layout();
  }

  private slot(design: Design, startX: number, index: number) {
    const column = index % design.columns;
    const row = Math.floor(index / design.columns);
    return {
      x: startX + column * (design.cardW + design.gap),
      y: design.cardY + row * (design.cardH + design.gap),
    };
  }

  /** Scale the whole design to fit whatever the device gives us, then centre it. */
  private layout() {
    const viewport = measure(this.scale);
    const design = this.design;
    const scale = Math.min(viewport.worldW / design.w, viewport.worldH / design.h);

    this.cameras.main.setZoom(viewport.zoom);
    this.root.setScale(scale);
    this.root.setPosition((-design.w / 2) * scale, (-design.h / 2) * scale);
    this.cameras.main.centerOn(0, 0);
  }

  private text(x: number, y: number, value: string, style: Phaser.Types.GameObjects.Text.TextStyle) {
    const item = this.add.text(x, y, value, style);
    this.root.add(item);
    return item;
  }

  private drawScenery(design: Design) {
    const palette = paletteFor(1);
    const rnd = new Phaser.Math.RandomDataGenerator(['menu-scenery']);
    const g = this.add.graphics();
    this.root.add(g);

    // Bleed past the design box so the hills reach the screen edges at any aspect.
    const bleed = 500;
    const left = -bleed;
    const right = design.w + bleed;

    g.fillStyle(0x030711, 0.34);
    g.fillRect(left, -bleed, right - left, design.h + bleed * 2);

    const ridge = (baseY: number, amplitude: number, frequency: number, color: number) => {
      const points: Phaser.Types.Math.Vector2Like[] = [{ x: left, y: design.h + bleed }];
      for (let x = left; x <= right; x += 10) {
        const n = Math.sin(x * frequency) * 0.6 + Math.sin(x * frequency * 2.3 + 1.1) * 0.4;
        points.push({ x, y: baseY - n * amplitude });
      }
      points.push({ x: right, y: design.h + bleed });
      g.fillStyle(color, 1);
      g.fillPoints(points, true);
      return points;
    };

    ridge(design.h * 0.72, 48, 0.007, lerpColor(palette.ridgeFar, palette.haze, 0.3));
    const mid = ridge(design.h * 0.82, 40, 0.012, palette.ridgeMid);
    ridge(design.h * 0.92, 30, 0.02, palette.ridgeNear);

    for (let x = left + 16; x < right; x += rnd.between(40, 96)) {
      const index = Phaser.Math.Clamp(Math.round((x - left) / 10) + 1, 1, mid.length - 2);
      tree(
        g,
        rnd,
        x,
        (mid[index].y as number) + 6,
        rnd.between(30, 58),
        lerpColor(palette.ridgeMid, palette.canopy, 0.6),
        rnd.frac() < 0.3,
      );
    }
  }

  private buildWorldCard(world: (typeof WORLDS)[number], x: number, y: number) {
    const design = this.design;
    const levels = levelsForWorld(world.id);
    const cleared = levels.filter((l) => progress.isSolved(l.id)).length;
    const unlocked = progress.isWorldUnlocked(world.id);
    const palette = paletteFor(world.id);

    const card = this.add.graphics();
    this.root.add(card);
    card.fillStyle(0x060d1b, 0.96);
    card.fillRoundedRect(x, y, design.cardW, design.cardH, 14);
    card.lineStyle(2, unlocked ? world.accent : 0x334155, unlocked ? 0.9 : 0.4);
    card.strokeRoundedRect(x, y, design.cardW, design.cardH, 14);
    card.fillStyle(unlocked ? palette.accent : 0x334155, unlocked ? 0.16 : 0.06);
    card.fillRoundedRect(x + 1, y + 1, design.cardW - 2, 60, 13);

    this.text(x + 20, y + 16, `WORLD ${world.id}`, {
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: '12px',
      color: unlocked ? '#7dd3fc' : '#475569',
    });

    this.text(x + 20, y + 33, world.name, {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '23px',
      color: unlocked ? '#f1f5f9' : '#64748b',
    });

    this.text(x + 20, y + 74, world.tagline, {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '13px',
      color: unlocked ? '#94a3b8' : '#475569',
      wordWrap: { width: design.cardW - 40 },
      lineSpacing: 3,
    });

    levels.forEach((level, index) => {
      const done = progress.isSolved(level.id);
      this.text(x + 20, y + 118 + index * 18, `${done ? '\u25c6' : '\u25c7'}  ${level.name}`, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '13px',
        color: done ? '#4ade80' : unlocked ? '#94a3b8' : '#475569',
      });
    });

    const label = !unlocked
      ? 'Locked \u2014 clear World 1'
      : cleared === levels.length
        ? 'Replay world'
        : cleared > 0
          ? `Continue  (${cleared}/${levels.length})`
          : 'Enter world';

    const enter = () => {
      sfx.open();
      this.cameras.main.fadeOut(280, 0, 0, 0);
      this.time.delayedCall(300, () => this.scene.start('Play', { world: world.id }));
    };

    if (unlocked) {
      // The whole card is a hit target, which matters a lot on a phone.
      const hit = this.add
        .rectangle(x + design.cardW / 2, y + design.cardH / 2, design.cardW, design.cardH, 0x000000, 0)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerdown', enter);
      this.root.add(hit);
    }

    this.button(
      x + design.cardW / 2,
      y + design.cardH - 26,
      design.cardW - 40,
      36,
      label,
      unlocked ? 0x0e7490 : 0x111c2f,
      enter,
      unlocked,
    );
  }

  private buildCaseFile(x: number, y: number) {
    const design = this.design;
    const revealed = LEVELS.filter((l) => progress.isSolved(l.id));
    const complete = revealed.length === LEVELS.length;

    const card = this.add.graphics();
    this.root.add(card);
    card.fillStyle(0x060d1b, 0.96);
    card.fillRoundedRect(x, y, design.cardW, design.cardH, 14);
    card.lineStyle(2, complete ? 0x4ade80 : 0xf472b6, 0.75);
    card.strokeRoundedRect(x, y, design.cardW, design.cardH, 14);
    card.fillStyle(complete ? 0x4ade80 : 0xf472b6, 0.14);
    card.fillRoundedRect(x + 1, y + 1, design.cardW - 2, 60, 13);

    this.text(x + 20, y + 16, 'CASE FILE', {
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: '12px',
      color: complete ? '#86efac' : '#f9a8d4',
    });

    this.text(x + 20, y + 33, `Evidence  ${revealed.length} / ${LEVELS.length}`, {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '23px',
      color: '#f1f5f9',
    });

    const body = complete
      ? CASE_SUMMARY
      : revealed.length === 0
        ? 'No evidence recovered yet. Clear a terminal to log your first finding.'
        : `Latest finding\n\n\u201c${revealed[revealed.length - 1].clue}\u201d`;

    this.text(x + 20, y + 76, body, {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '13px',
      color: complete ? '#bbf7d0' : '#cbd5e1',
      wordWrap: { width: design.cardW - 40 },
      lineSpacing: 5,
    });
  }

  private button(
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    color: number,
    onClick: () => void,
    enabled = true,
  ) {
    const box = this.add.rectangle(cx, cy, w, h, color, 1).setStrokeStyle(1, 0x38bdf8, enabled ? 0.7 : 0.15);
    this.root.add(box);

    const text = this.add
      .text(cx, cy, label, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '14px',
        color: enabled ? '#e2e8f0' : '#64748b',
      })
      .setOrigin(0.5);
    this.root.add(text);

    if (!enabled) return;

    box.setInteractive({ useHandCursor: true });
    box.on('pointerover', () => box.setScale(1.03));
    box.on('pointerout', () => box.setScale(1));
    box.on('pointerdown', onClick);
  }
}
