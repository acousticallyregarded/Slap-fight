import { Assets, BlurFilter, Container, Graphics, Sprite, Texture, loadTextures } from 'pixi.js';
import { blend, sampleClip } from './CharacterRig';
import { CLIPS, IDLE, ease, type Clip, type Pose, type StateName } from './pose';
import { SELL_LAYERS, type CharacterStyle, type SellLayer } from './styles';

// Rig metadata and part images produced by tools/art/prepare.py.
const META = import.meta.glob('../assets/rig/*.json', { eager: true, import: 'default' }) as Record<string, RigMeta>;
const FILES = import.meta.glob('../assets/rig/*/*.webp', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;

// Decode part images through <img>, not fetch(): hosts with a strict content
// policy (such as the published standalone demo) block fetching data: URLs.
loadTextures.config!.preferCreateImageBitmap = false;
loadTextures.config!.preferWorkers = false;

type XY = [number, number];

/** Source pixels to rig units, sized to the arena framing. */
const ART_SCALE = 0.9;

export interface RigPart {
  name: string;
  file: string;
  /** Top-left of the part in source-image pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation pivot in source-image pixels (defaults to the parent's). */
  pivot?: XY;
  parent?: string;
  z?: number;
  /** Outfit stages this part is shown in (all stages when absent). */
  stages?: number[];
  /** Sell garment that falls away when the next stage unlocks. */
  garment?: SellLayer;
  /** Which pose channel rotates this part. */
  drive?: 'head' | 'nearFore';
}

export interface RigMeta {
  sources: string[];
  hip: XY;
  stages: number;
  parts: RigPart[];
  face: {
    center: XY;
    cheekIn: XY;
    headTop?: XY;
    eyes?: { x: number; y: number; w: number; angle: number; skin: string; lash: string }[];
    mouth?: { x: number; y: number; w: number; angle: number; skin: string; lip: string };
    cheeks?: XY[];
  };
}

export function illustratedMeta(id: string): RigMeta | null {
  return META[`../assets/rig/${id}.json`] ?? null;
}

/**
 * Forearm swing per state, in radians toward the opponent (0 = as drawn).
 * The illustrations hold the slapping forearm raised, so a swing about the
 * elbow reads as the windup and the open-handed strike.
 */
const ARM: Partial<Record<StateName, [number, number][]>> = {
  slapWindup: [[480, -0.28]],
  slapStrike: [[150, 1.2], [380, 1.0]],
  glare: [[350, 0]],
  recover: [[400, 0]],
  wave: [[300, 0.35], [560, 0.05], [820, 0.35], [1080, 0.05], [1340, 0.35], [1700, 0.1]],
  cheer: [[180, -0.15], [420, 0.3], [700, 0.05], [950, 0.3], [1500, 0.1]],
  fingerWag: [[380, 0.25], [600, 0.4], [800, 0.15], [1000, 0.4], [1200, 0.15], [1600, 0.2]],
  acknowledge: [[300, 0.3], [1300, 0.25]],
  laugh: [[200, 0.08], [540, 0], [860, 0.08], [1250, 0]],
  smugVictory: [[300, -0.12], [1400, -0.1]],
  peace: [[380, -0.12], [1500, -0.1]],
  reducedSlapAttack: [[300, 0.45]],
};

interface Playing {
  clip: Clip;
  from: Pose;
  armFrom: number;
  elapsed: number;
  speed: number;
  marksFired: Set<string>;
  onMark?: (name: string) => void;
  resolve: () => void;
  returning: null | { from: Pose; armFrom: number; elapsed: number; ms: number };
}

interface Overlays {
  eyesClosed: Graphics[];
  blush: Graphics;
  mouthOpen: Graphics;
}

/**
 * A cutout puppet built from finished illustrations (art/source). Each
 * outfit stage is its own illustration, split into a body, a head and the
 * slapping forearm (tools/art/prepare.py). The same pose clips as the drawn
 * rig drive it: body lean and lunge, head tilt, the forearm swing, and
 * expression overlays painted in the illustration's own colours.
 */
export class IllustratedRig extends Container {
  readonly style: CharacterStyle;
  state: StateName = 'idle';
  pose: Pose = { ...IDLE };
  outfitStage = 0;
  fxLayer: Container | null = null;
  ready: Promise<void>;
  private body = new Container();
  /** Source-image space: 1 unit = 1 source pixel, mirrored back for Sell. */
  private art = new Container();
  private parts = new Map<string, Container>();
  private pivots = new Map<string, XY>();
  private heads: { c: Container; o: Overlays; stages?: number[] }[] = [];
  private forearms: Container[] = [];
  private arm = 0;
  private playing: Playing | null = null;
  private time = Math.random() * 10;
  private nextBlink = 1.5 + Math.random() * 2;
  private blinkT = -1;
  private dropping: { g: Container; vx: number; vy: number; vr: number; life: number; fade: boolean }[] = [];
  private dir: 1 | -1;

  constructor(style: CharacterStyle, private meta: RigMeta) {
    super();
    this.style = style;
    // The arena mirrors Sell so +x faces centre stage; the illustration keeps
    // its original orientation, which already faces centre stage.
    this.dir = style.id === 'sell' ? -1 : 1;
    this.art.scale.set(this.dir * ART_SCALE, ART_SCALE);
    this.art.position.set(-this.dir * meta.hip[0] * ART_SCALE, -meta.hip[1] * ART_SCALE);
    this.body.addChild(this.art);
    this.addChild(this.body);
    this.ready = this.build();
  }

  private async build() {
    const m = this.meta;
    const textures = await Promise.all(m.parts.map((p) => Assets.load<Texture>(FILES[`../assets/rig/${this.style.id}/${p.file}`])));
    const byName = new Map(m.parts.map((p) => [p.name, p]));
    const pivotOf = (p: RigPart): XY => p.pivot ?? (p.parent ? pivotOf(byName.get(p.parent)!) : [0, 0]);
    m.parts.forEach((p, i) => {
      const c = new Container();
      c.label = p.name;
      c.zIndex = p.z ?? i;
      const pv = pivotOf(p);
      const parentPv: XY = p.parent ? pivotOf(byName.get(p.parent)!) : [0, 0];
      c.position.set(pv[0] - parentPv[0], pv[1] - parentPv[1]);
      const sp = new Sprite(textures[i]);
      sp.position.set(p.x - pv[0], p.y - pv[1]);
      c.addChild(sp);
      this.parts.set(p.name, c);
      this.pivots.set(p.name, pv);
    });
    for (const p of m.parts) {
      const c = this.parts.get(p.name)!;
      const parent = p.parent ? this.parts.get(p.parent)! : this.art;
      parent.sortableChildren = true;
      parent.addChild(c);
      if (p.drive === 'head') this.heads.push({ c, o: this.buildOverlays(c, this.pivots.get(p.name)!), stages: p.stages });
      if (p.drive === 'nearFore') this.forearms.push(c);
    }
    this.setOutfitStage(this.outfitStage);
  }

  /** Expression overlays on a head, painted in the illustration's own skin and line colours. */
  private buildOverlays(host: Container, origin: XY): Overlays {
    const f = this.meta.face;
    const at = (x: number, y: number) => [x - origin[0], y - origin[1]] as XY;
    const o: Overlays = { eyesClosed: [], blush: new Graphics(), mouthOpen: new Graphics() };

    for (const [x, y] of f.cheeks ?? []) {
      const [cx, cy] = at(x, y);
      o.blush.ellipse(cx, cy, 15, 8).fill({ color: '#ff6f8e', alpha: 0.45 });
      for (let i = -1; i <= 1; i++) o.blush.moveTo(cx + i * 6 - 3, cy + 3).lineTo(cx + i * 6 + 2, cy - 3).stroke({ width: 1.3, color: '#e0506e', alpha: 0.7 });
    }
    o.blush.filters = [new BlurFilter({ strength: 2.5, quality: 2 })];
    o.blush.alpha = 0;
    o.blush.zIndex = 1000;
    host.addChild(o.blush);

    for (const e of f.eyes ?? []) {
      const g = new Graphics();
      const [cx, cy] = at(e.x, e.y);
      g.position.set(cx, cy);
      g.rotation = e.angle;
      const w = e.w;
      // Lid: skin over the open eye, then a closed lash line.
      g.ellipse(0, -1, w * 0.64, w * 0.42).fill({ color: e.skin });
      g.moveTo(-w * 0.58, -1).quadraticCurveTo(0, w * 0.28, w * 0.6, -3).stroke({ width: 3.2, color: e.lash, cap: 'round' });
      g.moveTo(w * 0.52, -2).lineTo(w * 0.72, -7).stroke({ width: 2.2, color: e.lash, cap: 'round' });
      g.filters = [new BlurFilter({ strength: 1.2, quality: 2 })];
      g.visible = false;
      g.zIndex = 1001;
      host.addChild(g);
      o.eyesClosed.push(g);
    }

    const mo = f.mouth;
    if (mo) {
      const g = o.mouthOpen;
      const [cx, cy] = at(mo.x, mo.y);
      g.position.set(cx, cy);
      g.rotation = mo.angle;
      const w = mo.w;
      g.ellipse(0, 1, w * 0.62, w * 0.34).fill({ color: mo.skin });
      g.moveTo(-w * 0.34, -2).quadraticCurveTo(0, -w * 0.18, w * 0.34, -2).quadraticCurveTo(w * 0.2, w * 0.36, 0, w * 0.38).quadraticCurveTo(-w * 0.2, w * 0.36, -w * 0.34, -2).closePath()
        .fill({ color: '#6b1f2b' }).stroke({ width: 1.6, color: mo.lip });
      g.ellipse(0, w * 0.24, w * 0.16, w * 0.08).fill({ color: '#d96a78' });
      g.filters = [new BlurFilter({ strength: 0.6, quality: 2 })];
      g.visible = false;
      g.zIndex = 1002;
      host.addChild(g);
    }
    return o;
  }

  // ---------------------------------------------------------------- outfits

  private shownStage() {
    return Math.min(this.outfitStage, this.meta.stages - 1);
  }

  /** Shows the illustration for a stage immediately (joining viewers, resets). */
  setOutfitStage(stage: number) {
    this.outfitStage = stage;
    const s = this.shownStage();
    for (const p of this.meta.parts) {
      const c = this.parts.get(p.name);
      if (c && p.stages) c.visible = p.stages.includes(s);
    }
  }

  /**
   * Unlocks a stage: the garment cut from the previous stage's illustration
   * falls away while the next illustration, fully dressed in its own right,
   * takes its place in the same frame. Returns the world position for FX.
   */
  dropLayer(stage: number, reduced: boolean): { x: number; y: number } | null {
    const layer = SELL_LAYERS[stage - 1];
    const piece = this.meta.parts.find((p) => p.garment === layer);
    const c = piece ? this.parts.get(piece.name) : undefined;
    let center: { x: number; y: number } | null = null;
    if (c && !c.destroyed && c.parent?.visible) {
      const b = c.getBounds();
      center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (this.fxLayer) {
        // Spin about the garment's own centre, not the image corner.
        this.fxLayer.reparentChild(c);
        const wrap = new Container();
        wrap.position.copyFrom(this.fxLayer.toLocal(center));
        this.fxLayer.addChild(wrap);
        c.position.set(c.x - wrap.x, c.y - wrap.y);
        wrap.addChild(c);
        this.parts.delete(piece!.name);
        // Garments slide outward and drop, away from the face and the other character.
        const outward = Math.sign(this.x) || this.dir * -1;
        this.dropping.push({
          g: wrap,
          vx: reduced ? 0 : outward * (120 + Math.random() * 60),
          vy: reduced ? 0 : 40 + Math.random() * 40,
          vr: reduced ? 0 : outward * (0.6 + Math.random() * 0.6),
          life: 0,
          fade: reduced,
        });
      }
    }
    this.setOutfitStage(Math.max(this.outfitStage, stage));
    // Swapping illustrations resets the new head and arm to the current pose.
    this.applyPose(this.pose, reduced);
    return center ?? this.art.toGlobal({ x: this.meta.hip[0], y: this.meta.hip[1] - 200 });
  }

  // -------------------------------------------------------------- animation

  play(name: StateName, speed = 1, onMark?: (m: string) => void): Promise<void> {
    if (name === 'idle') return Promise.resolve();
    const clip = CLIPS[name];
    this.playing?.resolve();
    this.state = name;
    return new Promise((resolve) => {
      this.playing = { clip, from: { ...this.pose }, armFrom: this.arm, elapsed: 0, speed, marksFired: new Set(), onMark, resolve, returning: null };
    });
  }

  get busy() {
    return this.playing !== null;
  }

  update(dtMs: number, reducedMotion: boolean) {
    this.time += dtMs / 1000;
    const p = this.playing;
    if (p) {
      let target: Pose;
      if (!p.returning) {
        p.elapsed += dtMs * p.speed;
        for (const [m, t] of Object.entries(p.clip.marks ?? {})) {
          if (!p.marksFired.has(m) && p.elapsed >= t) {
            p.marksFired.add(m);
            p.onMark?.(m);
          }
        }
        const t = Math.min(p.elapsed, p.clip.duration);
        target = sampleClip(p.clip, p.from, t);
        this.arm = sampleArm(ARM[p.clip.name], p.armFrom, t, p.clip.name === 'slapStrike' ? 'in' : 'inOut');
        if (p.elapsed >= p.clip.duration) {
          if (p.clip.returnMs > 0) p.returning = { from: target, armFrom: this.arm, elapsed: 0, ms: p.clip.returnMs };
          else {
            this.playing = null;
            p.resolve();
          }
        }
      } else {
        const r = p.returning;
        r.elapsed += dtMs * p.speed;
        const k = ease('inOut', Math.min(1, r.elapsed / r.ms));
        target = blend(r.from, IDLE, k);
        this.arm = r.armFrom * (1 - k);
        if (r.elapsed >= r.ms) {
          this.playing = null;
          this.state = 'idle';
          target = { ...IDLE };
          this.arm = 0;
          p.resolve();
        }
      }
      this.pose = target;
    }
    this.applyPose(this.pose, reducedMotion);
    this.updateDropping(dtMs);
  }

  private applyPose(pose: Pose, reduced: boolean) {
    const t = this.time;
    const breathe = reduced ? 0 : Math.sin(t * 2.1);
    // Cutout parts reach less far than drawn limbs, so lunges carry further.
    this.body.position.set(pose.x * 1.6, pose.y + breathe * 1.2);
    this.body.scale.set(1, 1 + breathe * 0.004);
    this.body.rotation = pose.lean * 1.2;

    const headRot = clamp(pose.headRot * 0.4 + (pose.headTurn - IDLE.headTurn) * 0.03, -0.14, 0.14);
    const sway = reduced ? 0 : Math.sin(t * 1.3) * 0.008;
    for (const h of this.heads) h.c.rotation = this.dir * (headRot + sway);
    // Swing toward the opponent: clockwise in the illustration for Buy, the mirror for Sell.
    for (const f of this.forearms) {
      f.rotation = this.dir * this.arm;
      f.scale.set(1 + Math.max(0, this.arm - 0.6) * 0.12);
    }

    // Blink timer.
    if (this.blinkT < 0 && this.time > this.nextBlink) this.blinkT = 0;
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += 1 / 60;
      blink = this.blinkT < 0.09 ? 0 : 1;
      if (this.blinkT > 0.12) {
        this.blinkT = -1;
        this.nextBlink = this.time + 2 + Math.random() * 3;
      }
    }
    const closed = pose.eyes === 'happy' || pose.eyes === 'wince' || pose.eyeOpen * blink < 0.3;
    const mouthOpen = pose.mouth === 'open' || pose.mouth === 'o' || pose.mouth === 'laugh' || pose.mouth === 'grit';
    for (const { o } of this.heads) {
      o.eyesClosed.forEach((g, i) => (g.visible = closed || (pose.eyes === 'wink' && i === 0)));
      o.blush.alpha = Math.min(1, pose.blush);
      o.mouthOpen.visible = mouthOpen;
    }
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

  private facePoint(p: XY) {
    const s = this.shownStage();
    const head = this.heads.find((h) => !h.stages || h.stages.includes(s));
    if (!head) return this.art.toGlobal({ x: p[0], y: p[1] });
    const origin = this.pivots.get(head.c.label)!;
    return head.c.toGlobal({ x: p[0] - origin[0], y: p[1] - origin[1] });
  }

  cheekGlobal() {
    return this.facePoint(this.meta.face.cheekIn);
  }

  headGlobal() {
    const f = this.meta.face;
    return this.facePoint(f.headTop ?? [f.center[0], f.center[1] - 120]);
  }

  // Parity with the drawn rig's asset-slot API (illustrated rigs are already final art).
  applyTextures(_: unknown) {}
  slotNames() {
    return this.meta.parts.map((p) => p.name);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function sampleArm(keys: [number, number][] | undefined, from: number, t: number, e: 'in' | 'inOut'): number {
  if (!keys) return from * Math.max(0, 1 - t / 300);
  let prevT = 0;
  let prevV = from;
  for (const [kt, v] of keys) {
    if (t >= kt) {
      prevT = kt;
      prevV = v;
      continue;
    }
    return prevV + (v - prevV) * ease(e, (t - prevT) / (kt - prevT || 1));
  }
  return prevV;
}
