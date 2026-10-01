import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { mirrorPath, path } from './draw';
import {
  FORE, NECK_Y, SHOULDER, UPPER, armParts, backHair, blush, bustShading, cloth, drawBrow, drawMouth, eye, face, frontHair, hand, legs, nose, torso,
} from './art';
import {
  CLIPS, DISCRETE_KEYS, IDLE, NUMERIC_KEYS, ease,
  type Brows, type Clip, type EyeMode, type HandShape, type Mouth, type Pose, type StateName,
} from './pose';
import { SELL_LAYERS, type CharacterStyle, type SellLayer } from './styles';

// Rig coordinates: origin at the hips, y down, +x toward the opponent.

type ArmParts = { shoulder: Container; elbow: Container; wrist: Container; hands: Record<HandShape, Container>; sleeves: Container };

interface Playing {
  clip: Clip;
  from: Pose;
  elapsed: number;
  speed: number;
  marksFired: Set<string>;
  onMark?: (name: string) => void;
  resolve: () => void;
  returning: null | { from: Pose; elapsed: number; ms: number };
}

/**
 * A layered 2D rig drawn with cel-shaded vector parts (art.ts). Any part can
 * be replaced by a texture through the asset pipeline (docs/ASSETS.md); the
 * pose/state machine does not depend on how parts are drawn.
 */
export class CharacterRig extends Container {
  readonly style: CharacterStyle;
  state: StateName = 'idle';
  pose: Pose = { ...IDLE };
  private body = new Container();
  private legs = new Container();
  private torso = new Container();
  private garments = new Container();
  private headPivot = new Container();
  private hairBack = new Container();
  private hairBackSway = new Container();
  private face = new Container();
  private features = new Container();
  private eyes: { root: Container; open: Container; iris: Container; happy: Graphics; wince: Graphics; closed: Graphics; side: 1 | -1 }[] = [];
  private brows: Graphics[] = [];
  private browLayer: Container | null = null;
  private mouth = new Graphics();
  private nose = new Graphics();
  private blushG = new Graphics();
  private sweatG = new Graphics();
  private near!: ArmParts;
  private far!: ArmParts;
  private layerParts = new Map<SellLayer, Container[]>();
  private playing: Playing | null = null;
  private time = Math.random() * 10;
  private nextBlink = 1.5 + Math.random() * 2;
  private blinkT = -1;
  private drawn = { mouth: '', eyes: '', brows: '' };
  outfitStage = 0;
  private dropping: { g: Container; vx: number; vy: number; vr: number; life: number; fade: boolean }[] = [];
  fxLayer: Container | null = null;
  /** Named replaceable parts (see docs/ASSETS.md). */
  private slots = new Map<string, Container>();
  private textures: Record<string, SlotTexture> = {};

  constructor(style: CharacterStyle) {
    super();
    this.style = style;
    this.sortableChildren = true;
    this.body.sortableChildren = true;
    this.build();
    this.applyPose(this.pose);
  }

  // ---------------------------------------------------------------- building

  private build() {
    const s = this.style;
    this.legs.addChild(this.slot('legs', legs(s)));
    this.addChild(this.legs);
    this.addChild(this.body);

    this.hairBack.zIndex = 0;
    this.hairBack.position.set(0, NECK_Y);
    this.hairBackSway.addChild(this.slot('backHair', backHair(s)));
    this.hairBack.addChild(this.hairBackSway);
    this.body.addChild(this.hairBack);

    this.far = this.buildArm(-1);
    this.far.shoulder.zIndex = 5;
    this.body.addChild(this.far.shoulder);

    this.torso.zIndex = 10;
    this.torso.addChild(this.slot('torso', torso(s)));
    this.body.addChild(this.torso);

    this.garments.zIndex = 20;
    this.garments.sortableChildren = true;
    this.body.addChild(this.garments);

    this.headPivot.zIndex = 45;
    this.headPivot.position.set(0, NECK_Y);
    this.headPivot.scale.set(1.06);
    this.body.addChild(this.headPivot);
    this.headPivot.addChild(this.face);
    this.buildHead();

    this.near = this.buildArm(1);
    this.near.shoulder.zIndex = 50;
    this.body.addChild(this.near.shoulder);

    this.buildOutfit();
  }

  private buildArm(side: 1 | -1): ArmParts {
    const s = this.style;
    const shoulder = new Container();
    shoulder.position.set(side * SHOULDER.x, SHOULDER.y);
    const { upper, fore } = armParts(s, side);
    const armName = side === 1 ? 'near' : 'far';
    this.slot(`upperArm.${armName}`, upper);
    this.slot(`foreArm.${armName}`, fore);
    const elbow = new Container();
    elbow.position.set(0, UPPER);
    const wrist = new Container();
    wrist.position.set(0, FORE);
    wrist.scale.set(1.22);
    const hands = {
      open: hand(s, 'open'),
      relaxed: hand(s, 'relaxed'),
      fist: hand(s, 'fist'),
      peace: hand(s, 'peace'),
      point: hand(s, 'point'),
    };
    for (const [k, h] of Object.entries(hands)) {
      h.scale.x = side; // thumb toward the body's front
      wrist.addChild(this.slot(`hand.${k}.${armName}`, h));
    }
    const sleeves = new Container();
    shoulder.addChild(upper, elbow, sleeves);
    elbow.addChild(fore, wrist);
    return { shoulder, elbow, wrist, hands, sleeves };
  }

  // ------------------------------------------------------------------ head

  private buildHead() {
    const s = this.style;
    this.face.addChild(this.slot('face', face(s)));
    this.face.addChild(this.features);
    this.blushG = blush();
    this.features.addChild(this.blushG);
    for (const side of [1, -1] as const) {
      const e = eye(s);
      e.root.position.set(side * 25, -64);
      e.root.scale.set(side * 1.28, 1.28);
      this.features.addChild(e.root);
      this.eyes.push({ ...e, side });
    }
    for (let i = 0; i < 2; i++) {
      const b = new Graphics();
      this.brows.push(b);
      this.features.addChild(b);
    }
    this.nose = nose(s);
    this.features.addChild(this.nose);
    this.features.addChild(this.mouth);
    this.face.addChild(this.slot('frontHair', frontHair(s)));
    // Anime convention: brows read through the fringe.
    const browLayer = new Container();
    browLayer.alpha = 0.85;
    for (const b of this.brows) browLayer.addChild(b);
    this.face.addChild(browLayer);
    this.browLayer = browLayer;
    this.sweatG
      .moveTo(0, -12)
      .quadraticCurveTo(10, 4, 0, 8)
      .quadraticCurveTo(-10, 4, 0, -12)
      .fill({ color: '#bfe9ff' })
      .stroke({ width: 2, color: '#5aa9d6' });
    this.sweatG.position.set(-50, -118);
    this.sweatG.visible = false;
    this.face.addChild(this.sweatG);
  }

  // ------------------------------------------------------------ asset slots

  private slot<T extends Container>(name: string, c: T): T {
    this.slots.set(name, c);
    const t = this.textures[name];
    if (t) swapToSprite(c, t);
    return c;
  }

  slotNames() {
    return [...this.slots.keys()];
  }

  /** Replaces drawn parts with illustrated textures. Unlisted parts stay drawn. */
  applyTextures(textures: Record<string, SlotTexture>) {
    this.textures = { ...this.textures, ...textures };
    for (const [name, t] of Object.entries(textures)) {
      const c = this.slots.get(name);
      if (c && !c.destroyed) swapToSprite(c, t);
    }
  }

  // ---------------------------------------------------------------- outfits

  private buildOutfit() {
    for (const c of this.garments.removeChildren()) c.destroy({ children: true });
    for (const arm of [this.near, this.far]) for (const c of arm.sleeves.removeChildren()) c.destroy({ children: true });
    this.layerParts.clear();
    if (this.style.id === 'buy') this.buildBuyOutfit();
    else this.buildSellOutfit();
  }

  private add(z: number, part: Container, parent: Container = this.garments, name?: string) {
    part.zIndex = z;
    parent.addChild(part);
    if (name) this.slot(`garment.${name}`, part);
    return part;
  }

  private sleeve(color: string, shade: string, ink: string, cuff: string, len = 94) {
    for (const arm of [this.near, this.far]) {
      this.add(
        1,
        cloth(color, shade, ink, (g) => {
          g.moveTo(-26, -6).quadraticCurveTo(-32, len * 0.5, -22, len).lineTo(22, len).quadraticCurveTo(32, len * 0.5, 26, -6).quadraticCurveTo(0, -24, -26, -6).closePath();
        }, (g) => {
          g.moveTo(-10, 10).quadraticCurveTo(-14, 50, -8, len - 6).stroke({ width: 2, color: shade });
          g.roundRect(-24, len - 12, 48, 14, 6).fill({ color: cuff });
        }),
        arm.sleeves,
        `sleeve.${arm === this.near ? 'near' : 'far'}`,
      );
    }
    return [this.near.sleeves.children.at(-1)!, this.far.sleeves.children.at(-1)!] as Container[];
  }

  private buildBuyOutfit() {
    const o = this.style.o;
    const ink = '#053b35';
    // High-waisted pleated skirt.
    this.add(1, cloth(o.skirt, o.skirtShade, ink, (g) =>
      mirrorPath(g, [0, -134], [
        { to: [58, -132], c: [30, -138] },
        { to: [104, 30], c: [72, -60] },
        { to: [124, 160], c: [120, 100] },
        { to: [0, 170], c: [64, 176] },
      ]), (g) => {
        for (const x of [-72, -36, 0, 36, 72]) g.moveTo(x * 0.5, -118).quadraticCurveTo(x * 0.9, 20, x * 1.45, 168).stroke({ width: 2.2, color: o.skirtShade });
        g.moveTo(-124, 156).quadraticCurveTo(0, 176, 124, 156).stroke({ width: 5, color: o.trim });
      }), undefined, 'buySkirt');
    // Belt.
    this.add(2, cloth(o.belt, '#b7862b', '#6b4a10', (g) =>
      mirrorPath(g, [0, -140], [{ to: [57, -138], c: [30, -144] }, { to: [60, -116] }, { to: [0, -116], c: [30, -120] }]), (g) => {
        g.roundRect(-12, -140, 24, 24, 4).stroke({ width: 3, color: '#8a6417' });
      }), undefined, 'buyBelt');
    // Halter crop top.
    this.add(3, cloth(o.top, o.topShade, ink, (g) =>
      mirrorPath(g, [0, -246], [
        { to: [24, -300], c: [12, -276] },
        { to: [36, -300] },
        { to: [66, -262], c: [48, -272] },
        { to: [104, -212], c: [106, -254] },
        { to: [44, -160], c: [96, -160] },
        { to: [0, -176], c: [16, -160] },
      ]), (g) => {
        bustShading(g, o.topShade, -238, -180);
        g.moveTo(-96, -168).quadraticCurveTo(-60, -158, -40, -160).quadraticCurveTo(-12, -162, 0, -174).quadraticCurveTo(12, -162, 40, -160).quadraticCurveTo(60, -158, 96, -168).stroke({ width: 3.5, color: o.trim });
        g.circle(0, -246, 6).fill({ color: o.trim });
      }), undefined, 'buyTop');
    // Choker.
    this.add(4, cloth('#0b3b36', '#062a26', '#021816', (g) => g.roundRect(-20, -330, 40, 9, 3), (g) => g.circle(0, -320, 5).fill({ color: o.trim })), undefined, 'buyChoker');
    // Open cropped jacket.
    this.add(5, cloth(o.jacket, o.jacketShade, ink, (g) => {
      for (const side of [1, -1]) {
        path(g, [side * 22, -308], [
          { to: [side * 80, -294], c: [side * 50, -306] },
          { to: [side * 102, -250], c: [side * 104, -282] },
          { to: [side * 104, -196], c: [side * 110, -222] },
          { to: [side * 84, -188] },
          { to: [side * 80, -238], c: [side * 76, -212] },
          { to: [side * 40, -286], c: [side * 58, -270] },
        ]);
      }
    }, (g) => {
      for (const side of [1, -1]) g.moveTo(side * 40, -286).quadraticCurveTo(side * 76, -250, side * 84, -190).stroke({ width: 4, color: o.jacketTrim });
    }), undefined, 'buyJacket');
    this.sleeve(o.jacket, o.jacketShade, ink, o.jacketTrim, 96);
  }

  private buildSellOutfit() {
    const o = this.style.o;
    const reg = (layer: SellLayer, ...parts: Container[]) => this.layerParts.set(layer, [...(this.layerParts.get(layer) ?? []), ...parts]);
    const vInk = '#2a0a52';
    const rInk = '#4a0a14';
    // Base bikini: present from the start, fully opaque, generous coverage.
    this.add(1, cloth(o.bikini, o.bikiniShade, vInk, (g) =>
      path(g, [-98, -26], [
        { to: [98, -26], c: [0, -10] },
        { to: [97, -4] },
        { to: [26, 66], c: [48, 20] },
        { to: [-26, 66] },
        { to: [-97, -4], c: [-48, 20] },
      ]), (g) => g.moveTo(-98, -22).quadraticCurveTo(0, -6, 98, -22).stroke({ width: 4, color: o.bikiniTrim })), undefined, 'bikiniBottom');
    this.add(2, cloth(o.bikini, o.bikiniShade, vInk, (g) => {
      for (const side of [1, -1]) {
        path(g, [side * 3, -244], [
          { to: [side * 62, -266], c: [side * 28, -268] },
          { to: [side * 100, -222], c: [side * 100, -258] },
          { to: [side * 68, -176], c: [side * 100, -180] },
          { to: [side * 3, -192], c: [side * 26, -172] },
        ]);
      }
    }, (g) => {
      bustShading(g, o.bikiniShade, -232, -184);
      for (const side of [1, -1]) {
        g.moveTo(side * 62, -266).quadraticCurveTo(side * 100, -258, side * 100, -222).stroke({ width: 3, color: o.bikiniTrim });
      }
    }), undefined, 'bikiniTop');
    const straps = new Graphics();
    for (const side of [1, -1]) straps.moveTo(side * 32, -262).lineTo(side * 18, -326).stroke({ width: 5, color: o.bikiniTrim, cap: 'round' });
    straps.circle(0, -220, 7).fill({ color: o.gold }).stroke({ width: 1.5, color: '#8a6417' });
    this.add(2, straps, undefined, 'bikiniStraps');

    reg('shorts', this.add(3, cloth(o.shorts, o.shortsShade, '#14052e', (g) =>
      path(g, [-100, -36], [
        { to: [100, -36], c: [0, -22] },
        { to: [112, 86], c: [108, 20] },
        { to: [18, 90] },
        { to: [0, 60], c: [8, 62] },
        { to: [-18, 90], c: [-8, 62] },
        { to: [-112, 86] },
        { to: [-100, -36], c: [-108, 20] },
      ]), (g) => {
        g.moveTo(-100, -26).quadraticCurveTo(0, -12, 100, -26).stroke({ width: 3, color: '#a78bfa' });
        g.moveTo(0, -18).lineTo(0, 52).stroke({ width: 2, color: '#14052e' });
        g.circle(0, -26, 4).fill({ color: o.gold });
        g.moveTo(60, 30).lineTo(96, 60).stroke({ width: 2, color: o.shortsShade });
      }), undefined, 'shorts'));

    reg('cropTop', this.add(4, cloth(o.top, o.topShade, rInk, (g) =>
      path(g, [-98, -262], [
        { to: [-42, -280], c: [-66, -286] },
        { to: [0, -256], c: [-14, -270] },
        { to: [42, -280], c: [14, -270] },
        { to: [98, -262], c: [66, -286] },
        { to: [102, -196], c: [110, -228] },
        { to: [44, -156], c: [96, -158] },
        { to: [0, -172], c: [16, -156] },
        { to: [-44, -156], c: [-16, -156] },
        { to: [-102, -196], c: [-96, -158] },
        { to: [-98, -262], c: [-110, -228] },
      ]), (g) => {
        bustShading(g, o.topShade, -238, -182);
        g.moveTo(-96, -166).quadraticCurveTo(-60, -156, -40, -158).quadraticCurveTo(-12, -160, 0, -172).quadraticCurveTo(12, -160, 40, -158).quadraticCurveTo(60, -156, 96, -166).stroke({ width: 3.5, color: '#a78bfa' });
        g.moveTo(-42, -280).quadraticCurveTo(-14, -270, 0, -256).quadraticCurveTo(14, -270, 42, -280).stroke({ width: 3, color: '#a78bfa' });
        for (let y = -250; y <= -176; y += 18) g.circle(0, y + 10, 2.4).fill({ color: o.gold });
      }), undefined, 'cropTop'));
    const topStraps = new Graphics();
    for (const side of [1, -1]) topStraps.moveTo(side * 46, -278).lineTo(side * 60, -300).stroke({ width: 10, color: o.top, cap: 'round' });
    reg('cropTop', this.add(4, topStraps, undefined, 'cropTopStraps'));

    reg('skirt', this.add(5, cloth(o.skirt, o.skirtShade, rInk, (g) =>
      path(g, [-76, -70], [
        { to: [76, -70], c: [0, -58] },
        { to: [150, 156], c: [124, 40] },
        { to: [0, 182], c: [80, 186] },
        { to: [-150, 156], c: [-80, 186] },
        { to: [-76, -70], c: [-124, 40] },
      ]), (g) => {
        for (const x of [-100, -50, 0, 50, 100]) g.moveTo(x * 0.6, -60).quadraticCurveTo(x * 0.9, 50, x * 1.3, 176).stroke({ width: 2.2, color: o.skirtShade });
        g.moveTo(-150, 154).quadraticCurveTo(0, 184, 150, 154).stroke({ width: 6, color: o.skirtTrim });
      }), undefined, 'skirt'));

    reg('sash', this.add(6, cloth(o.sash, o.sashShade, vInk, (g) => {
      path(g, [-68, -96], [{ to: [68, -96], c: [0, -86] }, { to: [78, -48] }, { to: [-78, -48], c: [0, -38] }]);
      path(g, [-72, -72], [{ to: [-122, -100], c: [-112, -64] }, { to: [-118, -42] }]);
      path(g, [-72, -72], [{ to: [-30, -104], c: [-40, -68] }, { to: [-28, -46] }]);
      path(g, [-78, -62], [{ to: [-110, 80], c: [-104, 0] }, { to: [-90, 70] }, { to: [-70, -58], c: [-82, 0] }]);
    }, (g) => {
      g.circle(-72, -72, 10).fill({ color: o.gold });
      g.moveTo(-60, -72).lineTo(60, -72).stroke({ width: 2, color: o.sashShade });
    }), undefined, 'sash'));

    const jacket = this.add(7, cloth(o.jacket, o.jacketShade, '#0a0220', (g) => {
      for (const side of [1, -1]) {
        path(g, [side * 22, -320], [
          { to: [side * 82, -298], c: [side * 52, -318] },
          { to: [side * 106, -252], c: [side * 108, -288] },
          { to: [side * 106, -206], c: [side * 110, -226] },
          { to: [side * 88, -198] },
          { to: [side * 80, -242], c: [side * 78, -218] },
          { to: [side * 40, -290], c: [side * 56, -276] },
        ]);
      }
    }, (g) => {
      for (const side of [1, -1]) {
        g.moveTo(side * 40, -290).quadraticCurveTo(side * 78, -254, side * 88, -200).stroke({ width: 4, color: o.jacketLining });
        g.moveTo(side * 24, -318).quadraticCurveTo(side * 34, -306, side * 40, -290).stroke({ width: 3, color: o.jacketTrim });
      }
    }), undefined, 'jacket');
    reg('jacket', jacket, ...this.sleeve(o.jacket, o.jacketShade, '#0a0220', o.jacketLining, 90));
  }

  /** Immediately shows the outfit for a stage (joining viewers, resets). No celebration. */
  setOutfitStage(stage: number) {
    if (this.style.id !== 'sell') return;
    this.buildOutfit();
    this.outfitStage = stage;
    SELL_LAYERS.forEach((layer, i) => {
      for (const p of this.layerParts.get(layer) ?? []) p.visible = i >= stage;
    });
  }

  /**
   * Removes one garment layer. Underlying layers were present from the start,
   * so coverage is intact on every frame. Returns the world position for FX.
   */
  dropLayer(stage: number, reduced: boolean): { x: number; y: number } | null {
    const layer = SELL_LAYERS[stage - 1];
    const parts = this.layerParts.get(layer) ?? [];
    this.outfitStage = Math.max(this.outfitStage, stage);
    let center: { x: number; y: number } | null = null;
    for (const p of parts) {
      if (!p.visible || p.destroyed) continue;
      const b = p.getBounds();
      if (!center) center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (!this.fxLayer) {
        p.visible = false;
        continue;
      }
      this.fxLayer.reparentChild(p);
      this.dropping.push({
        g: p,
        vx: reduced ? 0 : (Math.random() - 0.5) * 160 + (layer === 'jacket' ? -80 : 0),
        vy: reduced ? 0 : -180 - Math.random() * 80,
        vr: reduced ? 0 : (Math.random() - 0.5) * 3,
        life: 0,
        fade: reduced,
      });
    }
    this.layerParts.set(layer, []);
    return center;
  }

  // -------------------------------------------------------------- animation

  /** Plays a state clip, blending from the current pose. Resolves when it has returned to idle. */
  play(name: StateName, speed = 1, onMark?: (m: string) => void): Promise<void> {
    if (name === 'idle') return Promise.resolve();
    const clip = CLIPS[name];
    this.playing?.resolve();
    this.state = name;
    return new Promise((resolve) => {
      this.playing = { clip, from: { ...this.pose }, elapsed: 0, speed, marksFired: new Set(), onMark, resolve, returning: null };
    });
  }

  get busy() {
    return this.playing !== null;
  }

  update(dtMs: number, reducedMotion: boolean) {
    this.time += dtMs / 1000;
    let target: Pose = this.pose;
    const p = this.playing;
    if (p) {
      if (!p.returning) {
        p.elapsed += dtMs * p.speed;
        for (const [m, t] of Object.entries(p.clip.marks ?? {})) {
          if (!p.marksFired.has(m) && p.elapsed >= t) {
            p.marksFired.add(m);
            p.onMark?.(m);
          }
        }
        target = sampleClip(p.clip, p.from, Math.min(p.elapsed, p.clip.duration));
        if (p.elapsed >= p.clip.duration) {
          if (p.clip.returnMs > 0) p.returning = { from: target, elapsed: 0, ms: p.clip.returnMs };
          else {
            this.playing = null;
            this.pose = target;
            p.resolve();
          }
        }
      } else {
        const r = p.returning;
        r.elapsed += dtMs * p.speed;
        const k = ease('inOut', Math.min(1, r.elapsed / r.ms));
        target = blend(r.from, IDLE, k);
        if (r.elapsed >= r.ms) {
          this.playing = null;
          this.state = 'idle';
          target = { ...IDLE };
          p.resolve();
        }
      }
    }
    if (p || this.playing) this.pose = target;
    this.applyPose(this.pose, reducedMotion);
    this.updateDropping(dtMs);
  }

  private applyPose(pose: Pose, reduced = false) {
    const t = this.time;
    // Idle breathing and blinking are layered on every state, gently.
    const breathe = reduced ? 0 : Math.sin(t * 2.1);
    this.body.position.set(pose.x, pose.y + breathe * 1.6);
    this.body.rotation = pose.lean + breathe * 0.004;
    this.legs.position.x = pose.x;

    this.headPivot.rotation = pose.headRot + (reduced ? 0 : Math.sin(t * 1.3) * 0.012);
    this.hairBack.rotation = this.headPivot.rotation * 0.9;
    this.hairBack.position.x = pose.headTurn * -4;
    const tail = this.hairBackSway.getChildByLabel?.('ponytail') as Container | null;
    if (tail) tail.rotation = (reduced ? 0 : Math.sin(t * 1.6) * 0.04) - pose.lean * 0.8 - pose.headRot * 0.4;
    this.hairBackSway.skew.x = reduced ? 0 : Math.sin(t * 1.1) * 0.01;

    const turn = pose.headTurn;
    this.features.position.x = turn * 12;
    if (this.browLayer) this.browLayer.position.x = turn * 12;
    this.nose.position.x = turn * 5;
    for (const e of this.eyes) {
      e.root.position.x = e.side * 25 + turn * 2;
      const squash = 1 - 0.22 * Math.max(0, e.side * turn);
      e.root.scale.x = e.side * squash * 1.28;
      e.iris.position.set(pose.lookX * 4 * e.side, pose.lookY * 3);
    }
    // Blink timer.
    if (this.blinkT < 0 && this.time > this.nextBlink) this.blinkT = 0;
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += 1 / 60;
      blink = this.blinkT < 0.07 ? 0.1 : 1;
      if (this.blinkT > 0.12) {
        this.blinkT = -1;
        this.nextBlink = this.time + 2 + Math.random() * 3;
      }
    }
    this.setEyes(pose.eyes, pose.eyeOpen * blink);
    this.setBrows(pose.brows);
    this.setMouth(pose.mouth);
    this.blushG.alpha = pose.blush;
    this.sweatG.visible = pose.sweat;

    this.poseArm(this.near, pose.nearShoulder, pose.nearElbow, pose.nearWrist, pose.nearHand, 1);
    this.poseArm(this.far, pose.farShoulder, pose.farElbow, pose.farWrist, pose.farHand, -1);
    this.far.shoulder.zIndex = pose.farArmFront ? 48 : 5;
  }

  private poseArm(a: ArmParts, sh: number, el: number, wr: number, hand: HandShape, side: 1 | -1) {
    // Forward-positive angles; the near arm is at +x, so forward = counter-clockwise.
    a.shoulder.rotation = -sh;
    a.elbow.rotation = -el;
    a.wrist.rotation = -wr;
    for (const [k, g] of Object.entries(a.hands)) g.visible = k === hand;
    void side;
  }

  private setEyes(mode: EyeMode, open: number) {
    for (const e of this.eyes) {
      const isNear = e.side === 1;
      const m: EyeMode = mode === 'wink' ? (isNear ? 'happy' : 'normal') : mode;
      const closed = (m === 'normal' || m === 'wide') && open < 0.25;
      e.open.visible = (m === 'normal' || m === 'wide') && !closed;
      e.happy.visible = m === 'happy';
      e.wince.visible = m === 'wince';
      e.closed.visible = closed;
      const sy = m === 'wide' ? 1.18 : Math.max(0.3, Math.min(1, open));
      e.open.scale.y = sy;
      e.open.scale.x = m === 'wide' ? 1.06 : 1;
    }
  }

  private setBrows(mode: Brows) {
    if (this.drawn.brows === mode) return;
    this.drawn.brows = mode;
    this.brows.forEach((g, i) => drawBrow(g, this.style, mode, i === 0 ? 1 : -1));
  }

  private setMouth(m: Mouth) {
    if (this.drawn.mouth === m) return;
    this.drawn.mouth = m;
    drawMouth(this.mouth, this.style, m);
  }

  private updateDropping(dtMs: number) {
    const dt = dtMs / 1000;
    for (const d of this.dropping) {
      d.life += dt;
      if (d.fade) d.g.alpha = Math.max(0, 1 - d.life / 0.45);
      else {
        d.vy += 1400 * dt;
        d.g.x += d.vx * dt;
        d.g.y += d.vy * dt;
        d.g.rotation += d.vr * dt;
        if (d.life > 0.6) d.g.alpha = Math.max(0, 1 - (d.life - 0.6) / 0.5);
      }
    }
    const done = this.dropping.filter((d) => d.g.alpha <= 0 || d.life > 1.6);
    for (const d of done) d.g.destroy({ children: true });
    this.dropping = this.dropping.filter((d) => !done.includes(d));
  }

  /** World position of the cheek facing the opponent (impact target). */
  cheekGlobal() {
    return this.face.toGlobal({ x: 46, y: -50 });
  }
  headGlobal() {
    return this.face.toGlobal({ x: 0, y: -175 });
  }
}

export interface SlotTexture {
  texture: Texture;
  /** Position of the sprite's anchor in the slot's local coordinates. */
  x: number;
  y: number;
  anchorX?: number;
  anchorY?: number;
  scale?: number;
}

function swapToSprite(c: Container, t: SlotTexture) {
  for (const ch of c.removeChildren()) ch.destroy({ children: true });
  const sp = new Sprite(t.texture);
  sp.anchor.set(t.anchorX ?? 0.5, t.anchorY ?? 0.5);
  sp.position.set(t.x, t.y);
  sp.scale.set(t.scale ?? 1);
  c.addChild(sp);
}

export function blend(a: Pose, b: Pose, k: number): Pose {
  const out = { ...a } as any;
  for (const key of NUMERIC_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  for (const key of DISCRETE_KEYS) out[key] = k < 0.5 ? a[key] : b[key];
  return out;
}

/** Per-property tracks: each property interpolates between the keys that set it. */
export function sampleClip(clip: Clip, from: Pose, t: number): Pose {
  const out = { ...from } as any;
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  for (const prop of NUMERIC_KEYS) {
    let prevT = 0;
    let prevV = from[prop];
    let e: Parameters<typeof ease>[0] = 'inOut';
    let value = prevV;
    for (const k of keys) {
      if (!(prop in k.p)) continue;
      const v = (k.p as any)[prop] as number;
      if (t >= k.t) {
        prevT = k.t;
        prevV = v;
        value = v;
        continue;
      }
      e = k.ease ?? 'inOut';
      const span = k.t - prevT;
      value = span <= 0 ? v : prevV + (v - prevV) * ease(e, (t - prevT) / span);
      break;
    }
    out[prop] = value;
  }
  for (const prop of DISCRETE_KEYS) {
    for (const k of keys) if (k.t <= t && prop in k.p) out[prop] = (k.p as any)[prop];
  }
  return out;
}
