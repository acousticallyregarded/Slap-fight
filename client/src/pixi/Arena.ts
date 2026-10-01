import { Application, Assets, Container, Graphics, Text } from 'pixi.js';
import type { CharacterId } from '@bvs/shared';
import { CharacterRig, type SlotTexture } from './CharacterRig';
import { IllustratedRig, illustratedMeta } from './IllustratedRig';
import { SpriteActs } from './SpriteActs';

export type Rig = CharacterRig | IllustratedRig;

/** Illustrated rigs when their assets exist (tools/art/prepare.py), drawn rigs otherwise. */
export function makeRig(id: 'buy' | 'sell'): Rig {
  const meta = illustratedMeta(id);
  return meta ? new IllustratedRig(STYLES[id], meta) : new CharacterRig(STYLES[id]);
}
import { burst, grad, radial, sparkle } from './draw';
import { STYLES } from './styles';

const CHAR_X = 272;
const FLOOR_CUT = 150;

interface Particle {
  g: Container;
  vx: number;
  vy: number;
  vr: number;
  life: number;
  max: number;
  grow?: number;
  gravity?: number;
  /** Confetti: sways side to side as it falls. */
  flutter?: number;
}

/**
 * The Pixi scene: neon arena, podium, two rigs and effects. Knows nothing
 * about trades or chat; the Director tells it what to perform.
 */
export class Arena {
  app!: Application;
  world = new Container();
  private bg = new Container();
  private lights: Graphics[] = [];
  private crowd = new Graphics();
  fx = new Container();
  private bubbles = new Container();
  rigs!: Record<CharacterId, Rig>;
  /** Hand-drawn slap and chat animations per outfit stage (tools/art/sprites.py). */
  acts!: SpriteActs;
  reducedMotion = false;
  private host!: HTMLElement;
  private particles: Particle[] = [];
  private shakeT = 0;
  private shakeAmp = 0;
  private t = 0;
  private activeBubbles = new Map<CharacterId, { c: Container; life: number; max: number }>();
  private ambient: { g: Graphics; side: CharacterId; base: { x: number; y: number }; jump: number }[] = [];
  /** 0..1: recent trade volume. Brightens the lights and livens up the crowd. */
  private hype = 0;
  private hypeShown = 0;
  /** Share of chat cheers for Buy (0..1); glow sticks take team colours by it. */
  private cheerShare = 0.5;
  private crowdBounce = 0;
  /** Camera push-in for whale slaps. */
  private zoom = { k: 1, from: 1, to: 1, t: 0, dur: 0, focus: { x: 0, y: 0 } };
  private base = { s: 1, x: 0, y: 0 };
  private flashG = new Graphics();
  private resizeObserver: ResizeObserver | null = null;

  static async create(host: HTMLElement) {
    const a = new Arena();
    await a.init(host);
    return a;
  }

  private async init(host: HTMLElement) {
    this.app = new Application();
    await this.app.init({
      resizeTo: host,
      background: '#0a0620',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(this.app.canvas);
    this.host = host;
    this.app.canvas.setAttribute('aria-label', 'Buy vs. Sell arena');
    this.app.stage.addChild(this.world);
    this.world.addChild(this.bg);
    this.drawBackground();

    const buy = makeRig('buy');
    const sell = makeRig('sell');
    buy.position.set(-CHAR_X, 0);
    sell.position.set(CHAR_X, 0);
    sell.scale.x = -1; // mirrored so +x faces centre stage
    buy.fxLayer = this.fx;
    sell.fxLayer = this.fx;
    this.rigs = { buy, sell };
    this.acts = new SpriteActs(this.app.ticker, FLOOR_CUT - 2);
    this.acts.preload(0);
    this.world.addChild(buy, sell, this.acts.layer);
    this.drawStageFront();
    this.world.addChild(this.fx, this.bubbles);
    this.flashG.rect(-3000, -3000, 6000, 6000).fill({ color: '#ffffff' });
    this.flashG.alpha = 0;
    this.world.addChild(this.flashG);

    void this.loadArtManifest();
    this.app.ticker.add((tk) => this.tick(tk.deltaMS));
    this.layout();
    this.app.renderer.on('resize', () => this.layout());
    // The stage can change size without the window resizing (the side panel grows, the HUD wraps).
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.app.resize());
      ro.observe(host);
      this.resizeObserver = ro;
    }
  }

  /**
   * Optional illustrated art: assets/manifest.json maps slot names to PNGs
   * (docs/ASSETS.md). Missing manifest or files leave the drawn parts in place.
   */
  private async loadArtManifest() {
    let manifest: Record<string, Record<string, { src: string; x: number; y: number; anchorX?: number; anchorY?: number; scale?: number }>>;
    try {
      const res = await fetch('assets/manifest.json');
      if (!res.ok) return;
      manifest = await res.json();
    } catch {
      return;
    }
    for (const who of ['buy', 'sell'] as const) {
      const entries = manifest[who] ?? {};
      const textures: Record<string, SlotTexture> = {};
      await Promise.all(
        Object.entries(entries).map(async ([slot, e]) => {
          try {
            textures[slot] = { ...e, texture: await Assets.load('assets/' + e.src) };
          } catch {
            console.warn(`Art for ${who}.${slot} failed to load; keeping the drawn part.`);
          }
        }),
      );
      this.rigs[who].applyTextures(textures);
    }
  }

  /** Fits the characters' heads, torsos and outfits generously in any aspect ratio. */
  layout() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const portrait = h > w;
    const viewW = portrait ? 940 : 1080;
    const top = -590;
    const bottom = FLOOR_CUT + 10;
    const s = Math.min(w / viewW, h / (bottom - top));
    this.world.scale.set(s);
    this.world.position.set(w / 2, h - bottom * s + (h - (bottom - top) * s) * -0.0);
    // Keep the scene vertically anchored to the bottom, centred horizontally.
    const used = (bottom - top) * s;
    if (used < h) this.world.position.y = h - bottom * s - (h - used) * 0.35;
    this.base = { s, x: this.world.position.x, y: this.world.position.y };
    this.applyZoom();
  }

  private applyZoom() {
    const { k, focus } = this.zoom;
    const { s, x, y } = this.base;
    // Scale about the focus point so it stays where it is on screen.
    this.world.scale.set(s * k);
    this.world.position.set(x - focus.x * s * (k - 1), y - focus.y * s * (k - 1));
  }

  /** Pushes the camera in on a world point (whale slaps), then eases back out after `holdMs`. */
  zoomTo(focus: { x: number; y: number }, k: number, inMs: number, holdMs: number) {
    if (this.reducedMotion) return;
    this.zoom = { k: this.zoom.k, from: this.zoom.k, to: k, t: 0, dur: inMs, focus };
    setTimeout(() => (this.zoom = { ...this.zoom, from: this.zoom.k, to: 1, t: 0, dur: 450 }), inMs + holdMs);
  }

  /** A white flash over the whole stage. */
  flash(strength = 0.7) {
    if (this.reducedMotion) strength *= 0.3;
    this.flashG.alpha = strength;
  }

  setHype(h: number) {
    this.hype = Math.max(0, Math.min(1, h));
  }

  /** Team share of recent chat cheers (0..1 for Buy). */
  setCheers(buy: number, sell: number) {
    this.cheerShare = buy + sell ? buy / (buy + sell) : 0.5;
    this.recolorSticks();
  }

  /** A team's glow sticks jump (a chat cheer came in). */
  crowdCheer(side: CharacterId) {
    for (const s of this.ambient) if (s.side === side) s.jump = 0.6 + Math.random() * 0.3;
    this.crowdBounce = Math.max(this.crowdBounce, 0.5);
  }

  private recolorSticks() {
    const n = this.ambient.length;
    const buyCount = Math.round(this.cheerShare * n);
    // Interleave so both teams stay spread across the crowd.
    const order = [...this.ambient.keys()].sort((a, b) => ((a * 7) % n) - ((b * 7) % n));
    order.forEach((idx, i) => {
      const s = this.ambient[idx];
      const side: CharacterId = i < buyCount ? 'buy' : 'sell';
      if (s.side === side) return;
      s.side = side;
      s.g.clear().roundRect(-3, -22, 6, 26, 3).fill({ color: side === 'buy' ? '#3cf5d2' : '#ff4f8b' });
    });
  }

  private drawBackground() {
    const bg = new Graphics();
    bg.rect(-1400, -1100, 2800, 1800).fill(grad([[0, '#12072e'], [0.55, '#1c0a3d'], [1, '#07031a']]));
    this.bg.addChild(bg);

    // Neon rings behind the podium: turquoise for Buy, crimson for Sell.
    const rings = new Graphics();
    for (const [r, a] of [[430, 0.18], [360, 0.35]] as const) {
      rings.arc(0, -210, r, Math.PI / 2, (Math.PI * 3) / 2).stroke({ width: 26, color: '#14f1c9', alpha: a * 0.35 });
      rings.arc(0, -210, r, Math.PI / 2, (Math.PI * 3) / 2).stroke({ width: 5, color: '#5ffbe0', alpha: a + 0.25 });
      rings.arc(0, -210, r, -Math.PI / 2, Math.PI / 2).stroke({ width: 26, color: '#ff2d6f', alpha: a * 0.35 });
      rings.arc(0, -210, r, -Math.PI / 2, Math.PI / 2).stroke({ width: 5, color: '#ff6aa0', alpha: a + 0.25 });
    }
    this.bg.addChild(rings);

    // Spotlight cones.
    for (const [x, color] of [[-520, '#2de2c0'], [520, '#ff3d7f'], [-150, '#a78bfa'], [150, '#a78bfa']] as const) {
      const cone = new Graphics();
      cone.poly([0, 0, -140, 1100, 140, 1100]).fill(grad([[0, color], [1, 'rgba(0,0,0,0)']]));
      cone.alpha = 0.12;
      cone.position.set(x, -760);
      this.lights.push(cone);
      this.bg.addChild(cone);
    }

    // Crowd silhouettes with glow sticks.
    const c = this.crowd;
    for (let row = 0; row < 2; row++) {
      for (let i = -14; i <= 14; i++) {
        const x = i * 52 + (row % 2) * 26 + Math.sin(i * 7.3) * 8;
        const y = 70 + row * 46;
        c.circle(x, y - 34, 17).fill({ color: row ? '#0c0620' : '#150a30' });
        c.roundRect(x - 26, y - 20, 52, 90, 20).fill({ color: row ? '#0c0620' : '#150a30' });
      }
    }
    this.bg.addChild(c);
    for (let i = 0; i < 28; i++) {
      const stick = new Graphics();
      const left = i % 2 === 0;
      const side: CharacterId = left ? 'buy' : 'sell';
      stick.roundRect(-3, -22, 6, 26, 3).fill({ color: left ? '#3cf5d2' : '#ff4f8b' });
      const base = { x: (left ? -1 : 1) * (90 + ((i * 97) % 620)), y: 40 + ((i * 31) % 55) };
      stick.position.set(base.x, base.y);
      stick.alpha = 0.85;
      this.ambient.push({ g: stick, side, base, jump: 0 });
      this.bg.addChild(stick);
    }

    // Stage floor.
    const floor = new Graphics();
    floor.ellipse(0, 150, 760, 110).fill(grad([[0, '#2a1160'], [1, '#0d0626']]));
    floor.ellipse(0, 150, 760, 110).stroke({ width: 4, color: '#b794f4', alpha: 0.6 });
    floor.ellipse(0, 150, 520, 70).stroke({ width: 2, color: '#f0abfc', alpha: 0.35 });
    this.bg.addChild(floor);

    // Central slap podium.
    const pod = new Graphics();
    pod.poly([-96, -40, 96, -40, 124, 260, -124, 260]).fill(grad([[0, '#2b1266'], [1, '#12072e']]));
    pod.poly([-96, -40, 96, -40, 124, 260, -124, 260]).stroke({ width: 3, color: '#f0abfc', alpha: 0.8 });
    pod.roundRect(-118, -64, 236, 30, 10).fill(grad([[0, '#14f1c9'], [0.5, '#a78bfa'], [1, '#ff2d6f']], 'h'));
    for (let i = 0; i < 3; i++) pod.moveTo(-100 + i * 6, 20 + i * 70).lineTo(100 - i * 6, 20 + i * 70).stroke({ width: 2, color: '#f0abfc', alpha: 0.35 });
    pod.circle(0, 90, 58).fill(radial([[0, '#ffffff'], [0.3, '#ffd6f5'], [1, '#7c3aed']]));
    pod.circle(0, 90, 58).stroke({ width: 4, color: '#ffffff', alpha: 0.9 });
    this.bg.addChild(pod);
    const vs = new Text({
      text: 'VS',
      style: { fontFamily: 'Impact, "Arial Black", sans-serif', fontSize: 64, fill: '#2a0a4a', fontWeight: '900', letterSpacing: 2 },
    });
    vs.anchor.set(0.5);
    vs.position.set(0, 92);
    this.bg.addChild(vs);
  }

  private drawStageFront() {
    const front = new Graphics();
    front.rect(-1400, FLOOR_CUT, 2800, 600).fill(grad([[0, '#150935'], [1, '#07031a']]));
    front.moveTo(-1400, FLOOR_CUT).lineTo(1400, FLOOR_CUT).stroke({ width: 5, color: '#f0abfc', alpha: 0.9 });
    front.moveTo(-1400, FLOOR_CUT + 10).lineTo(1400, FLOOR_CUT + 10).stroke({ width: 2, color: '#14f1c9', alpha: 0.6 });
    this.world.addChild(front);
  }

  private tick(dt: number) {
    const ms = Math.min(dt, 50);
    this.t += ms / 1000;
    for (const r of Object.values(this.rigs)) r.update(ms, this.reducedMotion);
    // Hype eases toward its target; everything lively scales with it.
    this.hypeShown += (this.hype - this.hypeShown) * Math.min(1, ms / 600);
    const h = this.hypeShown;
    const sweep = 0.4 + h * 1.4;
    this.lights.forEach((l, i) => {
      l.alpha = 0.1 + h * 0.32 + (h > 0.6 ? Math.max(0, Math.sin(this.t * 6 + i * 2)) * 0.12 * h : 0);
      if (!this.reducedMotion) l.rotation = Math.sin(this.t * sweep + i * 1.7) * (0.18 + h * 0.14);
    });
    this.crowdBounce = Math.max(0, this.crowdBounce - ms / 1500);
    const bounce = this.reducedMotion ? 0 : Math.max(h, this.crowdBounce);
    this.crowd.y = -Math.abs(Math.sin(this.t * (3 + h * 5))) * 7 * bounce;
    this.ambient.forEach((s, i) => {
      s.jump = Math.max(0, s.jump - ms / 900);
      s.g.alpha = 0.55 + h * 0.4 + s.jump * 0.3;
      if (this.reducedMotion) return;
      const wave = Math.sin(this.t * (2 + h * 5) + i);
      s.g.rotation = wave * (0.4 + h * 0.4);
      s.g.y = s.base.y - Math.abs(wave) * 10 * bounce - Math.sin(s.jump * Math.PI) * 40;
    });
    if (this.flashG.alpha > 0) this.flashG.alpha = Math.max(0, this.flashG.alpha - ms / 260);
    if (this.zoom.dur > 0 && this.zoom.t < this.zoom.dur) {
      this.zoom.t = Math.min(this.zoom.dur, this.zoom.t + ms);
      const e = 1 - Math.pow(1 - this.zoom.t / this.zoom.dur, 3);
      this.zoom.k = this.zoom.from + (this.zoom.to - this.zoom.from) * e;
      this.applyZoom();
    }
    this.updateParticles(ms / 1000);
    this.updateBubbles(ms);
    if (this.shakeT > 0 && !this.reducedMotion) {
      this.shakeT -= ms;
      const k = Math.max(0, Math.min(1, this.shakeT / 180)) * this.shakeAmp;
      this.world.pivot.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    } else this.world.pivot.set(0, 0);
  }

  private toWorld(p: { x: number; y: number }) {
    return this.world.toLocal(p);
  }

  /** Marks the stage while a sprite animation plays as a wide shot, so overlays over the heads can step back. */
  setWideShot(on: boolean) {
    this.host.parentElement?.classList.toggle('wide-shot', on);
  }

  /** Stylized, non-graphic impact star. Bigger trades get bigger sparkle, not harder contact. */
  impact(defender: CharacterId, intensity: number, at?: { x: number; y: number }, whale = false) {
    const p = at ?? this.toWorld(this.rigs[defender].cheekGlobal());
    const scale = (0.9 + intensity * 0.6) * (whale ? 1.45 : 1);
    const star = new Container();
    const g = new Graphics();
    burst(g, 10, 78 * scale, 36 * scale, '#fff36b', '#2a0a4a');
    burst(g, 10, 44 * scale, 22 * scale, '#ffffff');
    star.addChild(g);
    const label = new Text({
      text: whale ? 'MEGA SLAP!!' : intensity > 0.4 ? 'SLAP!!' : 'SLAP!',
      style: { fontFamily: 'Impact, "Arial Black", sans-serif', fontSize: 34 * scale, fill: '#ff2d6f', stroke: { color: '#ffffff', width: 6 }, fontWeight: '900' },
    });
    label.anchor.set(0.5);
    label.rotation = -0.15;
    star.addChild(label);
    star.position.set(p.x, p.y);
    star.scale.set(0.2);
    this.fx.addChild(star);
    this.particles.push({ g: star, vx: 0, vy: -20, vr: 0, life: 0, max: 0.75, grow: 1 });
    const n = this.reducedMotion ? 0 : 5 + Math.round(intensity * 7) + (whale ? 14 : 0);
    for (let i = 0; i < n; i++) this.spark(p.x, p.y, i % 2 ? '#fff36b' : '#ffffff', 220 + intensity * 180);
    if (intensity > 0.3 && !this.reducedMotion) {
      const ring = new Graphics().circle(0, 0, 60).stroke({ width: 6, color: '#fff36b' });
      ring.position.set(p.x, p.y);
      this.fx.addChild(ring);
      this.particles.push({ g: ring, vx: 0, vy: 0, vr: 0, life: 0, max: 0.5, grow: 3 });
    }
    if (whale && !this.reducedMotion) {
      for (const [r, c] of [[60, '#ffffff'], [90, '#fff36b']] as const) {
        const ring = new Graphics().circle(0, 0, r).stroke({ width: 8, color: c });
        ring.position.set(p.x, p.y);
        this.fx.addChild(ring);
        this.particles.push({ g: ring, vx: 0, vy: 0, vr: 0, life: 0, max: 0.7, grow: 5 });
      }
    }
    this.shake(whale ? 26 : 8 + intensity * 8, whale ? 420 : 180);
  }

  /** Confetti raining over the whole stage for about `seconds`. */
  confetti(seconds: number, perSecond = 60) {
    const colors = [0x14f1c9, 0xff2d6f, 0xfff36b, 0xc084fc, 0xffffff, 0x5eead4, 0xff9ecb];
    const total = Math.round((this.reducedMotion ? 10 : perSecond) * seconds);
    for (let i = 0; i < total; i++) {
      setTimeout(() => {
        const g = new Graphics().rect(-6, -3.5, 12, 7).fill({ color: colors[i % colors.length] });
        g.position.set((Math.random() - 0.5) * 1150, -640 - Math.random() * 40);
        g.rotation = Math.random() * Math.PI;
        this.fx.addChild(g);
        this.particles.push({
          g, vx: (Math.random() - 0.5) * 120, vy: 140 + Math.random() * 160, vr: (Math.random() - 0.5) * 10,
          life: 0, max: 3.2 + Math.random(), flutter: Math.random() * Math.PI * 2,
        });
      }, (i / total) * seconds * 1000);
    }
  }

  sparkleBurst(p: { x: number; y: number } | null, count = 14, colors = ['#fff7ae', '#f0abfc', '#ffffff']) {
    if (!p) return;
    const w = this.toWorld(p);
    const n = this.reducedMotion ? 4 : count;
    for (let i = 0; i < n; i++) this.spark(w.x + (Math.random() - 0.5) * 80, w.y + (Math.random() - 0.5) * 80, colors[i % colors.length], 160);
  }

  private spark(x: number, y: number, color: string, speed: number) {
    const g = sparkle(new Graphics(), 7 + Math.random() * 8, color);
    g.position.set(x, y);
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.6);
    this.fx.addChild(g);
    this.particles.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: (Math.random() - 0.5) * 6, life: 0, max: 0.55 + Math.random() * 0.3, gravity: 200 });
  }

  shake(amp: number, ms = 180) {
    if (this.reducedMotion) return;
    this.shakeAmp = amp;
    this.shakeT = ms;
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life += dt;
      p.g.x += p.vx * dt + (p.flutter !== undefined ? Math.sin(p.life * 5 + p.flutter) * 60 * dt : 0);
      p.g.y += p.vy * dt;
      p.vy += (p.gravity ?? 0) * dt;
      p.g.rotation += p.vr * dt;
      const k = p.life / p.max;
      if (p.grow) {
        const s = p.grow === 1 ? Math.min(1, 0.2 + k * 5) * (1 + 0.1 * Math.sin(k * 10)) : 0.4 + k * p.grow;
        p.g.scale.set(s);
      }
      p.g.alpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
    }
    const dead = this.particles.filter((p) => p.life >= p.max);
    for (const d of dead) d.g.destroy({ children: true });
    if (dead.length) this.particles = this.particles.filter((p) => p.life < p.max);
  }

  /** Preset speech bubble (fixed library text only). */
  bubble(who: CharacterId, text: string, ms = 1800) {
    this.activeBubbles.get(who)?.c.destroy({ children: true });
    const c = new Container();
    const label = new Text({ text, style: { fontFamily: '"Baloo 2", "Trebuchet MS", sans-serif', fontSize: 30, fill: '#2a0a4a', fontWeight: '800' } });
    label.anchor.set(0.5);
    const w = label.width + 40;
    const g = new Graphics();
    g.roundRect(-w / 2, -30, w, 60, 28).fill({ color: '#ffffff' }).stroke({ width: 4, color: who === 'buy' ? '#14f1c9' : '#ff2d6f' });
    const dir = who === 'buy' ? 1 : -1;
    g.poly([dir * -10, 26, dir * 18, 26, dir * -24, 56]).fill({ color: '#ffffff' });
    c.addChild(g, label);
    this.bubbles.addChild(c);
    this.activeBubbles.set(who, { c, life: 0, max: ms });
  }

  private updateBubbles(ms: number) {
    for (const [who, b] of this.activeBubbles) {
      b.life += ms;
      const head = this.acts.head(who) ?? this.toWorld(this.rigs[who].headGlobal());
      b.c.position.set(head.x + (who === 'buy' ? 70 : -70), head.y - 10);
      b.c.alpha = b.life < 150 ? b.life / 150 : b.life > b.max - 250 ? Math.max(0, (b.max - b.life) / 250) : 1;
      if (b.life >= b.max) {
        b.c.destroy({ children: true });
        this.activeBubbles.delete(who);
      }
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.app.destroy(true, { children: true });
  }
}
