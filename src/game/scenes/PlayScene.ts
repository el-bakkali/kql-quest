import Phaser from 'phaser';
import { getLevel, levelsForWorld, WORLDS } from '../../data/levels';
import { progress } from '../../engine/progress';
import { setHudPrompt, setHudStats, setHudVisible, showHudBanner, showHudComplete } from '../../ui/hud';
import { applySkyCss, buildBackdrop, buildForeground, type Backdrop } from '../backdrop';
import { paletteFor } from '../palette';
import { Avatar } from '../player';
import { sfx } from '../sfx';
import { resetVirtualInput, isTouchDevice, virtualInput, type VirtualAction } from '../virtualInput';
import { measure } from '../viewport';
import { groundTopAt, ROWS, TILE, WORLD_DEFS, type WorldDef } from '../worldDefs';

const SPEED = 250;
const JUMP_VELOCITY = -580;
const GRAVITY = 1300;
const COYOTE_MS = 120;
const JUMP_BUFFER_MS = 130;
const INTERACT_RANGE = 52;

interface TerminalRef {
  container: Phaser.GameObjects.Container;
  screen: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  levelId: string;
}

type PhysicsRect = Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };

export class PlayScene extends Phaser.Scene {
  private def!: WorldDef;
  private worldWidth = 0;
  private player!: PhysicsRect;
  private avatar!: Avatar;
  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private shards!: Phaser.Physics.Arcade.StaticGroup;
  private spikes!: Phaser.Physics.Arcade.StaticGroup;
  private drones!: Phaser.Physics.Arcade.Group;
  private gateField!: Phaser.GameObjects.Image;
  private gateBlocker!: Phaser.GameObjects.Rectangle;
  private terminals: TerminalRef[] = [];
  private backdrop!: Backdrop;
  private builtViewW = 0;
  private builtViewH = 0;
  private resizeTimer?: Phaser.Time.TimerEvent;
  private spawnOverride?: { x: number; y: number };

  private runDust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private landPuff!: Phaser.GameObjects.Particles.ParticleEmitter;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;

  private keys!: Record<'left' | 'right' | 'jump' | 'interact' | 'respawn' | 'menu', Phaser.Input.Keyboard.Key[]>;
  private checkpoint = new Phaser.Math.Vector2();
  private jumpsLeft = 2;
  private lastGroundedAt = -9999;
  private jumpPressedAt = -9999;
  private jumpHeldLast = false;
  private wasGrounded = true;
  private safeUntil = 0;
  private busy = false;
  private gateOpen = false;
  private finished = false;
  private useGlow = false;

  constructor() {
    super('Play');
  }

  init(data: { world?: number; spawnX?: number; spawnY?: number }) {
    this.def = WORLD_DEFS[data.world ?? 1];
    this.terminals = [];
    this.busy = false;
    this.finished = false;
    this.gateOpen = false;
    this.jumpsLeft = 2;
    this.lastGroundedAt = -9999;
    this.jumpPressedAt = -9999;
    this.wasGrounded = true;
    this.spawnOverride =
      data.spawnX !== undefined && data.spawnY !== undefined
        ? { x: data.spawnX, y: data.spawnY }
        : undefined;
  }

  create() {
    const viewport = measure(this.scale);
    this.builtViewW = viewport.worldW;
    this.builtViewH = viewport.worldH;
    this.worldWidth = this.def.columns * TILE;
    const worldHeight = ROWS * TILE;

    applySkyCss(this.def.id);
    this.backdrop = buildBackdrop(this, this.def.id, this.worldWidth, viewport.worldW);

    this.physics.world.setBounds(0, -600, this.worldWidth, worldHeight + 1400);
    this.cameras.main.setBounds(0, -400, this.worldWidth, worldHeight + 900);
    this.cameras.main.setZoom(viewport.zoom);

    this.buildTerrain();
    this.buildDecor();
    this.buildProps();
    this.buildPlayer();
    this.buildParticles();
    buildForeground(this, this.def.id, this.worldWidth, viewport.worldW);
    this.bindKeys();

    setHudVisible(true);
    showHudComplete(null);

    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.player, this.gateBlocker);
    this.physics.add.overlap(this.player, this.shards, (_p, shard) =>
      this.collectShard(shard as Phaser.Physics.Arcade.Sprite),
    );
    this.physics.add.overlap(this.player, this.spikes, () => this.hurt());
    this.physics.add.overlap(this.player, this.drones, () => this.hurt());

    this.refreshGate(true);

    this.cameras.main.startFollow(this.player, true, 0.1, 0.14, 0, 40);
    this.cameras.main.setDeadzone(viewport.worldW * 0.16, viewport.worldH * 0.24);
    this.cameras.main.fadeIn(420, 0, 0, 0);

    resetVirtualInput();
    void import('../../ui/touchControls').then((m) => m.setTouchControlsVisible(true));

    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResize, this);
      this.resizeTimer?.remove();
      resetVirtualInput();
      setHudVisible(false);
      void import('../../ui/touchControls').then((m) => m.setTouchControlsVisible(false));
    });

    void import('../../ui/terminal');
  }

  /** Re-zoom immediately; only rebuild the scenery when the view really changed shape. */
  private onResize() {
    const viewport = measure(this.scale);
    this.cameras.main.setZoom(viewport.zoom);
    this.cameras.main.setDeadzone(viewport.worldW * 0.16, viewport.worldH * 0.24);

    const changed =
      Math.abs(viewport.worldW - this.builtViewW) > 220 ||
      Math.abs(viewport.worldH - this.builtViewH) > 200;
    if (!changed || this.busy) return;

    this.resizeTimer?.remove();
    this.resizeTimer = this.time.delayedCall(220, () => {
      this.scene.restart({ world: this.def.id, spawnX: this.player.x, spawnY: this.player.y });
    });
  }

  // --- construction ------------------------------------------------------

  private buildTerrain() {
    const world = this.def.id;
    this.solids = this.physics.add.staticGroup();
    const worldHeight = ROWS * TILE;

    for (const span of this.def.terrain) {
      if (span.top === null) continue;

      const fillTop = (span.top + 1) * TILE;
      this.add
        .tileSprite(
          span.from * TILE,
          fillTop,
          (span.to - span.from + 1) * TILE,
          worldHeight + 900 - fillTop,
          `soil-${world}`,
        )
        .setOrigin(0, 0)
        .setDepth(0);

      for (let col = span.from; col <= span.to; col++) {
        const variant = (col * 7 + span.top * 3) % 3;
        this.solids
          .create(col * TILE + TILE / 2, span.top * TILE + TILE / 2, `cap-${world}-${variant}`)
          .setDepth(1);
      }
    }

    for (const platform of this.def.platforms) {
      for (let i = 0; i < platform.w; i++) {
        this.solids
          .create((platform.x + i) * TILE + TILE / 2, platform.y * TILE + 10, `slab-${world}`)
          .setDepth(1);
      }
    }
  }

  private buildDecor() {
    const world = this.def.id;
    const rnd = new Phaser.Math.RandomDataGenerator([`decor-${world}`]);
    const blocked = new Set<number>();
    for (const terminal of this.def.terminals) {
      for (let d = -2; d <= 2; d++) blocked.add(terminal.x + d);
    }
    for (const spike of this.def.spikes) {
      for (let i = -1; i <= spike.w; i++) blocked.add(spike.x + i);
    }
    for (let d = -3; d <= 3; d++) blocked.add(this.def.gateX + d);

    for (const span of this.def.terrain) {
      if (span.top === null) continue;
      for (let col = span.from; col <= span.to; col++) {
        if (blocked.has(col)) continue;
        const roll = rnd.frac();
        const x = col * TILE + rnd.between(4, TILE - 4);
        const y = span.top * TILE + 5;
        if (roll < 0.3) {
          this.add
            .image(x, y, `flora-${world}-${rnd.between(0, 2)}`)
            .setOrigin(0.5, 1)
            .setDepth(2)
            .setScale(rnd.realInRange(0.75, 1.25))
            .setFlipX(rnd.frac() > 0.5);
        } else if (roll < 0.37) {
          this.add
            .image(x, y + 2, `rock-${world}`)
            .setOrigin(0.5, 1)
            .setDepth(2)
            .setScale(rnd.realInRange(0.6, 1.1))
            .setFlipX(rnd.frac() > 0.5);
        }
      }
    }

    for (const platform of this.def.platforms) {
      if (rnd.frac() < 0.7) {
        this.add
          .image(
            (platform.x + rnd.between(0, platform.w - 1)) * TILE + TILE / 2,
            platform.y * TILE + 1,
            `flora-${world}-${rnd.between(0, 2)}`,
          )
          .setOrigin(0.5, 1)
          .setDepth(2)
          .setScale(0.8);
      }
    }
  }

  private buildProps() {
    const world = this.def.id;
    const palette = paletteFor(world);

    this.shards = this.physics.add.staticGroup();
    for (const shard of this.def.shards) {
      const sprite: Phaser.Physics.Arcade.Sprite = this.shards.create(
        shard.x * TILE + TILE / 2,
        shard.y * TILE + TILE / 2,
        'shard',
      );
      sprite.setDepth(3).setScale(0.8);
      const halo = this.add
        .image(sprite.x, sprite.y, `glow-${world}`)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.4)
        .setTint(0xfbbf24)
        .setDepth(2);
      sprite.setData('halo', halo);
      this.tweens.add({
        targets: [sprite, halo],
        y: '-=10',
        duration: 1300,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.tweens.add({ targets: sprite, angle: 360, duration: 7000, repeat: -1 });
    }

    this.spikes = this.physics.add.staticGroup();
    for (const spike of this.def.spikes) {
      const top = groundTopAt(this.def, spike.x);
      if (top === null) continue;
      for (let i = 0; i < spike.w; i++) {
        this.spikes
          .create((spike.x + i) * TILE + TILE / 2, top * TILE - 10, `spike-${world}`)
          .setDepth(3);
      }
    }

    this.drones = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const drone of this.def.drones) {
      const sprite = this.drones.create(
        drone.x * TILE + TILE / 2,
        drone.y * TILE + TILE / 2,
        'drone',
      ) as Phaser.Physics.Arcade.Sprite;
      sprite.setDepth(12);
      (sprite.body as Phaser.Physics.Arcade.Body).setSize(34, 18);
      sprite.setData('minX', drone.x * TILE);
      sprite.setData('maxX', (drone.x + drone.range) * TILE);
      sprite.setVelocityX(78);
      this.tweens.add({
        targets: sprite,
        y: sprite.y - 12,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    const worldLevels = levelsForWorld(this.def.id);
    for (const terminal of this.def.terminals) {
      const top = groundTopAt(this.def, terminal.x);
      if (top === null) continue;

      const solved = progress.isSolved(terminal.levelId);
      const cx = terminal.x * TILE + TILE / 2;
      const cy = top * TILE - 38;

      const glow = this.add
        .image(0, 0, `glow-${world}`)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(1.05)
        .setTint(solved ? 0x4ade80 : palette.accent);
      const body = this.add.image(0, 0, 'terminal-body');
      const screen = this.add.image(0, -12, solved ? 'terminal-screen-on' : 'terminal-screen-off');

      const container = this.add.container(cx, cy, [glow, body, screen]).setDepth(4);
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.5, to: 1 },
        scale: { from: 0.95, to: 1.18 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      const level = getLevel(terminal.levelId);
      const index = worldLevels.findIndex((l) => l.id === terminal.levelId) + 1;
      const label = this.makeLabel(cx, cy - 62, `${index}. ${level?.name ?? terminal.levelId}`, solved);

      this.terminals.push({ container, screen, glow, label, levelId: terminal.levelId });
    }

    const gateTop = groundTopAt(this.def, this.def.gateX) ?? 13;
    const gateX = this.def.gateX * TILE + TILE / 2;
    const gateBaseY = gateTop * TILE;

    this.add.image(gateX - 36, gateBaseY - 84, 'gate-post').setDepth(4);
    this.add.image(gateX + 36, gateBaseY - 84, 'gate-post').setDepth(4);
    this.gateField = this.add.image(gateX, gateBaseY - 80, 'gate-field').setDepth(3);
    this.tweens.add({
      targets: this.gateField,
      alpha: { from: 0.65, to: 1 },
      duration: 750,
      yoyo: true,
      repeat: -1,
    });

    this.gateBlocker = this.add.rectangle(gateX, gateBaseY - 80, 22, 160, 0x000000, 0);
    this.physics.add.existing(this.gateBlocker, true);
  }

  private makeLabel(x: number, y: number, text: string, solved: boolean) {
    const label = this.add
      .text(0, 0, text, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '13px',
        color: solved ? '#bbf7d0' : '#e0f2fe',
      })
      .setOrigin(0.5);
    const plate = this.add
      .rectangle(0, 0, label.width + 20, 24, 0x050b16, 0.72)
      .setStrokeStyle(1, solved ? 0x4ade80 : 0x38bdf8, 0.85);
    const container = this.add.container(x, y, [plate, label]).setDepth(5);
    this.tweens.add({
      targets: container,
      y: y - 6,
      duration: 1900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    return container;
  }

  private buildPlayer() {
    const startTop = groundTopAt(this.def, this.def.startX) ?? 13;
    const startX = this.spawnOverride?.x ?? this.def.startX * TILE + TILE / 2;
    const startY = this.spawnOverride?.y ?? startTop * TILE - 70;
    this.checkpoint.set(startX, startY);

    const rect = this.add.rectangle(startX, startY, 22, 52, 0xff0000, 0);
    this.physics.add.existing(rect);
    this.player = rect as PhysicsRect;
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setGravityY(GRAVITY);
    this.player.body.setMaxVelocity(600, 1250);

    this.avatar = new Avatar(this, startX, startY);
  }

  private buildParticles() {
    this.runDust = this.add
      .particles(0, 0, 'dust', {
        lifespan: 420,
        speedX: { min: -40, max: 40 },
        speedY: { min: -60, max: -14 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.5, end: 0 },
        frequency: 55,
        tint: 0xd7ecff,
        emitting: false,
      })
      .setDepth(9);

    this.landPuff = this.add
      .particles(0, 0, 'dust', {
        lifespan: 520,
        speedX: { min: -140, max: 140 },
        speedY: { min: -70, max: -10 },
        scale: { start: 0.8, end: 0 },
        alpha: { start: 0.6, end: 0 },
        tint: 0xd7ecff,
        emitting: false,
      })
      .setDepth(9);

    this.burst = this.add
      .particles(0, 0, 'spark', {
        lifespan: 800,
        speed: { min: 70, max: 260 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);
  }

  private bindKeys() {
    const keyboard = this.input.keyboard!;
    const many = (...codes: number[]) => codes.map((code) => keyboard.addKey(code, false));
    const K = Phaser.Input.Keyboard.KeyCodes;

    this.keys = {
      left: many(K.A, K.LEFT),
      right: many(K.D, K.RIGHT),
      jump: many(K.W, K.UP, K.SPACE),
      interact: many(K.E),
      respawn: many(K.R),
      menu: many(K.M),
    };
  }

  private held(group: Phaser.Input.Keyboard.Key[], action?: VirtualAction) {
    if (action && virtualInput[action]) return true;
    return group.some((key) => key.isDown);
  }

  // --- loop --------------------------------------------------------------

  override update(time: number, delta: number) {
    this.updateDrones();

    const camera = this.cameras.main;
    this.backdrop.motes.setPosition(camera.worldView.centerX, camera.worldView.centerY);

    const body = this.player.body;
    const onGround = body.blocked.down || body.touching.down;

    if (this.busy || this.finished) {
      body.setVelocityX(0);
      this.avatar.update(this.player.x, this.player.y, 0, body.velocity.y, onGround, delta);
      return;
    }

    if (this.held(this.keys.menu, 'menu')) {
      this.scene.start('Menu');
      return;
    }
    if (this.held(this.keys.respawn)) {
      this.respawn();
      return;
    }

    if (onGround) {
      this.lastGroundedAt = time;
      this.jumpsLeft = 2;
    }

    if (onGround && !this.wasGrounded) {
      this.landPuff.emitParticleAt(this.player.x, this.player.y + 26, 8);
      sfx.land();
    }
    this.wasGrounded = onGround;

    const left = this.held(this.keys.left, 'left');
    const right = this.held(this.keys.right, 'right');
    body.setVelocityX(left && !right ? -SPEED : right && !left ? SPEED : 0);

    const jumpHeld = this.held(this.keys.jump, 'jump');
    if (jumpHeld && !this.jumpHeldLast) this.jumpPressedAt = time;
    this.jumpHeldLast = jumpHeld;

    const wantsJump = time - this.jumpPressedAt <= JUMP_BUFFER_MS;
    const canCoyote = time - this.lastGroundedAt <= COYOTE_MS;
    if (wantsJump && (onGround || canCoyote || this.jumpsLeft > 0)) {
      if (!onGround && !canCoyote) this.jumpsLeft--;
      body.setVelocityY(JUMP_VELOCITY);
      this.jumpPressedAt = -9999;
      this.lastGroundedAt = -9999;
      this.landPuff.emitParticleAt(this.player.x, this.player.y + 26, 5);
      sfx.jump();
    }

    // Releasing the jump key early cuts the arc short.
    if (!jumpHeld && body.velocity.y < -190) body.setVelocityY(-190);

    const running = onGround && Math.abs(body.velocity.x) > 30;
    this.runDust.emitting = running;
    if (running) this.runDust.setPosition(this.player.x, this.player.y + 26);

    this.avatar.update(this.player.x, this.player.y, body.velocity.x, body.velocity.y, onGround, delta);
    camera.setFollowOffset(-this.avatar.facingSign * 70, 40);

    if (this.player.y > ROWS * TILE + 90) {
      this.hurt();
      return;
    }

    this.updateProximity();
    this.updateHud();

    if (this.gateOpen && Math.abs(this.player.x - this.gateField.x) < 44) this.completeWorld();
  }

  private updateDrones() {
    for (const child of this.drones.getChildren()) {
      const drone = child as Phaser.Physics.Arcade.Sprite;
      const body = drone.body as Phaser.Physics.Arcade.Body;
      if (drone.x <= drone.getData('minX')) {
        body.setVelocityX(78);
        drone.setFlipX(false);
      } else if (drone.x >= drone.getData('maxX')) {
        body.setVelocityX(-78);
        drone.setFlipX(true);
      }
    }
  }

  private updateProximity() {
    let closest: TerminalRef | null = null;
    let best = INTERACT_RANGE;

    for (const terminal of this.terminals) {
      const dx = Math.abs(terminal.container.x - this.player.x);
      if (dx < best && Math.abs(terminal.container.y - this.player.y) < 100) {
        closest = terminal;
        best = dx;
      }
    }

    if (closest) {
      this.checkpoint.set(closest.container.x, closest.container.y - 10);
      const level = getLevel(closest.levelId);
      const solved = progress.isSolved(closest.levelId);
      const key = isTouchDevice() ? 'USE' : 'E';
      setHudPrompt(
        solved ? `[ ${key} ]   Revisit  ${level?.name}` : `[ ${key} ]   Jack in:  ${level?.name}`,
      );
      this.setUseGlow(true);
      if (this.held(this.keys.interact, 'interact')) void this.openMission(closest);
    } else {
      setHudPrompt(null);
      this.setUseGlow(false);
    }
  }

  private setUseGlow(active: boolean) {
    if (this.useGlow === active) return;
    this.useGlow = active;
    void import('../../ui/touchControls').then((m) => m.setUseHighlight(active));
  }

  private updateHud() {
    const levels = levelsForWorld(this.def.id);
    const cleared = levels.filter((l) => progress.isSolved(l.id)).length;
    const world = WORLDS.find((w) => w.id === this.def.id);
    setHudStats(
      world?.name ?? 'World',
      cleared,
      levels.length,
      progress.current.xp,
      progress.current.shards,
    );
  }

  // --- interaction -------------------------------------------------------

  private async openMission(terminal: TerminalRef) {
    if (this.busy) return;
    const level = getLevel(terminal.levelId);
    if (!level) return;

    this.busy = true;
    setHudPrompt(null);
    this.setUseGlow(false);
    this.runDust.emitting = false;
    this.player.body.setVelocity(0, 0);
    this.physics.pause();

    const touch = await import('../../ui/touchControls');
    touch.setTouchControlsVisible(false);
    resetVirtualInput();

    const keyboard = this.input.keyboard!;
    keyboard.enabled = false;
    keyboard.disableGlobalCapture();
    sfx.open();

    const worldLevels = levelsForWorld(this.def.id);
    const index = worldLevels.findIndex((l) => l.id === level.id) + 1;
    const { openTerminal } = await import('../../ui/terminal');
    const solved = await openTerminal(level, index, worldLevels.length);

    keyboard.enableGlobalCapture();
    keyboard.enabled = true;
    keyboard.resetKeys();
    resetVirtualInput();
    touch.setTouchControlsVisible(true);
    this.physics.resume();
    this.busy = false;
    this.jumpHeldLast = true;
    this.jumpPressedAt = -9999;

    if (solved) this.onSolved(terminal, level.xp);
  }

  private onSolved(terminal: TerminalRef, xp: number) {
    const awarded = progress.solve(terminal.levelId, xp);
    terminal.screen.setTexture('terminal-screen-on');
    terminal.glow.setTint(0x4ade80);
    (terminal.label.list[0] as Phaser.GameObjects.Rectangle).setStrokeStyle(1, 0x4ade80, 0.9);
    (terminal.label.list[1] as Phaser.GameObjects.Text).setColor('#bbf7d0');

    sfx.solved();
    this.cameras.main.flash(260, 34, 197, 94);
    this.burst.emitParticleAt(terminal.container.x, terminal.container.y, 34);

    if (awarded) {
      const popup = this.add
        .text(terminal.container.x, terminal.container.y - 82, `+${xp} XP`, {
          fontFamily: 'Cascadia Code, Consolas, monospace',
          fontSize: '24px',
          color: '#facc15',
        })
        .setOrigin(0.5)
        .setDepth(60);
      this.tweens.add({
        targets: popup,
        y: popup.y - 56,
        alpha: 0,
        duration: 1500,
        ease: 'Cubic.easeOut',
        onComplete: () => popup.destroy(),
      });
    }

    this.refreshGate(false);
  }

  private refreshGate(initial: boolean) {
    const levels = levelsForWorld(this.def.id);
    const allDone = levels.every((l) => progress.isSolved(l.id));
    if (allDone === this.gateOpen && !initial) return;

    this.gateOpen = allDone;
    (this.gateBlocker.body as Phaser.Physics.Arcade.StaticBody).enable = !allDone;

    if (allDone) {
      this.gateField.setTint(0x4ade80);
      this.tweens.add({
        targets: this.gateField,
        alpha: 0.14,
        duration: initial ? 10 : 900,
        ease: 'Cubic.easeOut',
      });
      if (!initial) {
        sfx.gate();
        this.burst.emitParticleAt(this.gateField.x, this.gateField.y, 40);
        showHudBanner('Barrier down. The path east is open.');
      }
    }
  }

  private collectShard(sprite: Phaser.Physics.Arcade.Sprite) {
    if (!sprite.active) return;
    (sprite.getData('halo') as Phaser.GameObjects.Image | undefined)?.destroy();
    sprite.disableBody(true, true);
    progress.collectShard();
    sfx.collect();
    this.burst.emitParticleAt(sprite.x, sprite.y, 14);
  }

  private hurt() {
    if (this.time.now < this.safeUntil || this.busy || this.finished) return;
    sfx.hit();
    this.cameras.main.shake(200, 0.009);
    this.cameras.main.flash(200, 220, 38, 38);
    this.respawn();
  }

  private respawn() {
    this.safeUntil = this.time.now + 1000;
    this.player.body.reset(this.checkpoint.x, this.checkpoint.y);
    this.avatar.setAlpha(0.35);
    this.tweens.add({ targets: this.avatar.container, alpha: 1, duration: 900 });
  }

  private completeWorld() {
    if (this.finished) return;
    this.finished = true;
    this.player.body.setVelocity(0, 0);
    this.runDust.emitting = false;
    sfx.solved();
    this.burst.emitParticleAt(this.player.x, this.player.y, 60);

    setHudPrompt(null);
    showHudComplete(`WORLD ${this.def.id} CLEARED`);

    this.cameras.main.fadeOut(1700, 0, 0, 0);
    this.time.delayedCall(1900, () => {
      showHudComplete(null);
      this.scene.start('Menu');
    });
  }
}
