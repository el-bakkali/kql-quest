import Phaser from 'phaser';

interface Limb {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  lag: number;
}

const HAND_LAG = 11;
const FOOT_LAG = 17;
/** The art is drawn small so it stays crisp; the character reads better scaled up. */
const BASE_SCALE = 1.3;

/**
 * Rayman-style avatar: the hands and feet are detached and chase the body with a
 * spring lag, which is what sells the floaty character animation. Physics lives on
 * a separate invisible body in PlayScene; this is purely visual.
 */
export class Avatar {
  readonly container: Phaser.GameObjects.Container;

  private readonly shadow: Phaser.GameObjects.Image;
  private readonly torso: Phaser.GameObjects.Image;
  private readonly head: Phaser.GameObjects.Image;
  private readonly tuft: Phaser.GameObjects.Image;
  private readonly limbs: Record<'handL' | 'handR' | 'footL' | 'footR', Limb>;

  private facing = 1;
  private phase = 0;
  private squash = 0;
  private wasGrounded = true;
  private bobOffset = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.shadow = scene.add.image(0, 30, 'p-shadow');

    const limb = (lx: number, ly: number, key: string, lag: number): Limb => ({
      sprite: scene.add.image(lx, ly, key),
      x: lx,
      y: ly,
      targetX: lx,
      targetY: ly,
      lag,
    });

    this.limbs = {
      footL: limb(-7, 21, 'p-foot', FOOT_LAG),
      footR: limb(7, 21, 'p-foot', FOOT_LAG),
      handL: limb(-16, 6, 'p-hand', HAND_LAG),
      handR: limb(16, 6, 'p-hand', HAND_LAG),
    };

    this.torso = scene.add.image(0, 6, 'p-torso');
    this.head = scene.add.image(0, -20, 'p-head');
    this.tuft = scene.add.image(17, -38, 'spark').setBlendMode(Phaser.BlendModes.ADD).setScale(1.1);

    this.container = scene.add.container(x, y, [
      this.shadow,
      this.limbs.footL.sprite,
      this.limbs.footR.sprite,
      this.limbs.handL.sprite,
      this.torso,
      this.head,
      this.tuft,
      this.limbs.handR.sprite,
    ]);
    this.container.setDepth(10);

    scene.tweens.add({
      targets: this.tuft,
      alpha: { from: 0.45, to: 1 },
      scale: { from: 0.85, to: 1.35 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  get facingSign() {
    return this.facing;
  }

  setAlpha(alpha: number) {
    this.container.setAlpha(alpha);
  }

  destroy() {
    this.container.destroy();
  }

  update(x: number, y: number, vx: number, vy: number, onGround: boolean, delta: number) {
    const dt = Math.min(delta, 50) / 1000;
    const speed = Math.abs(vx);
    const running = onGround && speed > 20;

    if (speed > 12) this.facing = vx > 0 ? 1 : -1;

    this.phase += dt * (running ? 8.5 + speed * 0.018 : 2.6);
    const swing = Math.sin(this.phase);

    if (onGround && !this.wasGrounded) this.squash = 1;
    this.wasGrounded = onGround;
    this.squash = Math.max(0, this.squash - dt * 5.5);

    this.bobOffset = running ? Math.abs(swing) * 2.4 : swing * 1.5;

    const { handL, handR, footL, footR } = this.limbs;

    if (!onGround) {
      const rising = vy < 0;
      handL.targetX = -18;
      handR.targetX = 18;
      handL.targetY = rising ? -7 : 3;
      handR.targetY = rising ? -7 : 3;
      footL.targetX = -6;
      footR.targetX = 7;
      footL.targetY = rising ? 15 : 22;
      footR.targetY = rising ? 17 : 22;
    } else if (running) {
      handL.targetX = -14 + swing * 8;
      handR.targetX = 14 + swing * 8;
      handL.targetY = 5 - swing * 3;
      handR.targetY = 5 + swing * 3;
      footL.targetX = -7 + swing * 5;
      footR.targetX = 7 - swing * 5;
      footL.targetY = 21 - Math.max(0, swing) * 8;
      footR.targetY = 21 - Math.max(0, -swing) * 8;
    } else {
      handL.targetX = -16;
      handR.targetX = 16;
      handL.targetY = 6 + this.bobOffset;
      handR.targetY = 6 + this.bobOffset;
      footL.targetX = -7;
      footR.targetX = 7;
      footL.targetY = 21;
      footR.targetY = 21;
    }

    for (const part of Object.values(this.limbs)) {
      const t = 1 - Math.exp(-part.lag * dt);
      part.x += (part.targetX - part.x) * t;
      part.y += (part.targetY - part.y) * t;
      part.sprite.setPosition(part.x, part.y);
    }

    handL.sprite.setRotation((handL.x - handL.targetX) * 0.03);
    handR.sprite.setRotation((handR.x - handR.targetX) * 0.03);

    this.torso.setY(6 + this.bobOffset * 0.35);
    this.head.setY(-20 + this.bobOffset * 0.7);
    this.tuft.setPosition(17, this.head.y - 18);

    this.shadow.setY(30);
    this.shadow.setAlpha(onGround ? 0.85 : 0.3);
    this.shadow.setScale(onGround ? 1 : 0.7);

    const stretch = Phaser.Math.Clamp(vy / 1500, -0.14, 0.2);
    const scaleY = 1 + stretch - this.squash * 0.24;
    const scaleX = 1 - stretch * 0.6 + this.squash * 0.2;

    this.container.setPosition(x, y + this.bobOffset * 0.4);
    this.container.setScale(this.facing * scaleX * BASE_SCALE, scaleY * BASE_SCALE);
    this.container.setRotation(Phaser.Math.Clamp(vx / 4200, -0.09, 0.09) * this.facing);
  }
}
