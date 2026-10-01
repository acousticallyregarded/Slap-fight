import { Assets, Container, Sprite, Texture, type Ticker } from 'pixi.js';
import type { CharacterId } from '@bvs/shared';

/** One folder of aligned frames written by tools/art/sprites.py. */
interface Sheet {
  files: string[];
  width: number;
  height: number;
  /** Centre of the boots on the floor, in frame pixels. */
  anchor: [number, number];
  figureHeight: number;
  /** Slap sheets: the palm on the contact frame, relative to the boots. */
  hand?: [number, number];
  /** Reaction sheets: the slapped cheek, relative to the boots. */
  cheek?: [number, number];
}

/** [frame index in the sheet, seconds held]. */
type Frames = [number, number][];

interface StageSet {
  contactSeconds: number;
  defenderDelay: number;
  sheets: Record<string, Sheet>;
  animations: Record<string, { sheet: string; frames: Frames }>;
}

/** Chat pose names in the art pack. */
export type ChatPose = 'Greeting' | 'Attention' | 'Compliment' | 'Flirt' | 'Boundary' | 'Laugh' | 'Cheer' | 'GG';

const SETS = import.meta.glob('../assets/sprites/s*.json', { eager: true, import: 'default' }) as Record<string, StageSet>;
const FILES = import.meta.glob('../assets/sprites/*/*.webp', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;

const NAME: Record<CharacterId, string> = { buy: 'Buy', sell: 'Sell' };
const FADE_MS = 140;
/** Head room above the characters in the wide shot (world units). */
const HEAD_TOP = -530;
/** Chat poses strung together into each character's dance (the pack has no dance frames). */
const DANCE: Record<CharacterId, ChatPose[]> = { buy: ['Cheer', 'Greeting', 'GG', 'Laugh'], sell: ['GG', 'Cheer', 'Laugh', 'Greeting'] };
/** Dance bounces per second. */
const BEAT = 2.2;
/** Where each character stands in a chat wide shot. */
const CHAT_X = 230;

const set = (stage: number): StageSet | undefined => SETS[`../assets/sprites/s${stage}.json`];
const total = (f: Frames) => f.reduce((a, [, d]) => a + d, 0);

function frameAt(f: Frames, t: number) {
  if (t <= 0) return f[0][0];
  let acc = 0;
  for (const [i, d] of f) {
    acc += d;
    if (t < acc) return i;
  }
  return f[f.length - 1][0];
}

interface Part {
  who: CharacterId;
  sheet: Sheet;
  tex: Texture[];
  frames: Frames;
  delay: number;
  x: number;
  /** Dancing: bounce and sway, with this phase offset. */
  dance?: number;
}

/**
 * Plays the hand-drawn animations (slaps and chat poses) of an outfit stage
 * as a full-body wide shot: both illustrated rigs fade out, the frames play
 * on the floor line, and the rigs fade back in afterwards. A stage or
 * direction without art keeps the rig animation.
 */
export class SpriteActs {
  readonly layer = new Container();
  private textures = new Map<string, Promise<Texture[]>>();
  private heads: Partial<Record<CharacterId, { x: number; y: number }>> = {};

  constructor(private ticker: Ticker, private floorY: number) {}

  /** Both sheets a slap by `attacker` needs exist at this stage. */
  hasSlap(stage: number, attacker: CharacterId) {
    const s = set(stage);
    const defender: CharacterId = attacker === 'buy' ? 'sell' : 'buy';
    return !!(s?.animations[`${NAME[attacker]}_Slap`] && s.animations[`${NAME[defender]}_Reaction`]);
  }

  /** Every character's chat sheet exists at this stage and has this pose for the targets. */
  hasChat(stage: number, targets: CharacterId[], pose: ChatPose) {
    const s = set(stage);
    return !!s && (['buy', 'sell'] as const).every((w) => s.sheets[`${NAME[w]}_Chat`]) && targets.every((w) => s.animations[`${NAME[w]}_${pose}`]);
  }

  /** Head position (world) of a character while a wide shot is on screen, for speech bubbles. */
  head(who: CharacterId) {
    return this.heads[who] ?? null;
  }

  /** Starts loading a stage's frames so the first act does not wait on them. */
  preload(stage: number) {
    const s = set(stage);
    if (!s) return;
    for (const n of Object.keys(s.sheets)) void this.load(stage, n);
  }

  private load(stage: number, name: string) {
    const key = `${stage}/${name}`;
    let p = this.textures.get(key);
    if (!p) {
      const sheet = set(stage)!.sheets[name];
      p = Promise.all(sheet.files.map((f) => Assets.load<Texture>(FILES[`../assets/sprites/s${stage}/${f}`])));
      this.textures.set(key, p);
    }
    return p;
  }

  private scaleFor(parts: { sheet: Sheet }[]) {
    const h = parts.reduce((a, p) => a + p.sheet.figureHeight, 0) / parts.length;
    return (this.floorY - HEAD_TOP) / h;
  }

  /**
   * One slap. `contact` fires once, on the contact frame, with the palm's
   * position in the layer's (world) coordinates.
   */
  async slap(stage: number, attacker: CharacterId, speed: number, rigs: Container[], contact: (at: { x: number; y: number }) => void, slowmo = false) {
    const s = set(stage)!;
    const defender: CharacterId = attacker === 'buy' ? 'sell' : 'buy';
    const aAnim = s.animations[`${NAME[attacker]}_Slap`];
    const dAnim = s.animations[`${NAME[defender]}_Reaction`];
    const aSheet = s.sheets[aAnim.sheet];
    const dSheet = s.sheets[dAnim.sheet];
    const k = this.scaleFor([{ sheet: aSheet }, { sheet: dSheet }]);
    // Space the pair so the palm lands on the cheek.
    const hand = aSheet.hand ?? [0, 0];
    const cheek = dSheet.cheek ?? [0, 0];
    const gap = Math.max(120, attacker === 'buy' ? k * (hand[0] - cheek[0]) : k * (cheek[0] - hand[0]));
    const x = { buy: -gap / 2, sell: gap / 2 };
    const [aTex, dTex] = await Promise.all([this.load(stage, aAnim.sheet), this.load(stage, dAnim.sheet)]);
    let hit = false;
    await this.run(
      // The slapping arm passes in front of the face, so the attacker is drawn last.
      [
        { who: defender, sheet: dSheet, tex: dTex, frames: dAnim.frames, delay: s.defenderDelay, x: x[defender] },
        { who: attacker, sheet: aSheet, tex: aTex, frames: aAnim.frames, delay: 0, x: x[attacker] },
      ],
      k,
      speed,
      rigs,
      (t) => {
        if (hit || t < s.contactSeconds) return;
        hit = true;
        contact({ x: x[attacker] + k * hand[0], y: this.floorY + k * hand[1] });
      },
      undefined,
      true,
      // Whale slaps: the swing slows right down into the contact frame, then snaps back.
      slowmo ? (t) => (Math.abs(t - s.contactSeconds + 0.12) < 0.3 ? 0.28 : 1) : undefined,
    );
  }

  /** Both chat sheets exist at this stage, so the pair can dance. */
  hasDance(stage: number) {
    const s = set(stage);
    const ok = (w: CharacterId) => !!s?.animations[`${NAME[w]}_Dance`] || DANCE[w].some((p) => s?.animations[`${NAME[w]}_${p}`]);
    return !!s && (!!s.animations.Pair_Dance || (ok('buy') && ok('sell')));
  }

  /**
   * Both characters dance side by side for `seconds`: the pack's pair dance
   * when it has one, else their cheerful chat poses strung together on a
   * bouncing beat with a little sway.
   */
  async dance(stage: number, seconds: number, rigs: Container[]) {
    const s = set(stage)!;
    const pair = s.animations.Pair_Dance;
    if (pair) {
      // Both characters drawn together in each frame: one sequence, centre stage, looped.
      const sheet = s.sheets[pair.sheet];
      const frames: Frames = [];
      for (let t = 0; t < seconds; t += total(pair.frames)) frames.push(...pair.frames);
      const tex = await this.load(stage, pair.sheet);
      const part: Part = { who: 'buy', sheet, tex, frames, delay: 0, x: 0 };
      await this.run([part], this.scaleFor([part]), 1, rigs, undefined, seconds, false);
      return;
    }
    const parts = await Promise.all(
      (['buy', 'sell'] as const).map(async (w, i) => {
        // Dedicated dance frames when the art pack has them, else chat poses.
        const own = s.animations[`${NAME[w]}_Dance`];
        const sheetName = own ? own.sheet : `${NAME[w]}_Chat`;
        const frames: Frames = own ? [...own.frames] : [];
        if (!own) for (const p of DANCE[w]) {
          const a = s.animations[`${NAME[w]}_${p}`];
          // Poses held for a beat or two, so the moves land on the bounce.
          if (a) for (const [f, d] of a.frames) frames.push([f, Math.min(d, 0.45)]);
        }
        // Loop the routine until the dance ends.
        const one = total(frames);
        const looped: Frames = [];
        for (let t = 0; t < seconds; t += one) looped.push(...frames);
        return { who: w, sheet: s.sheets[sheetName], tex: await this.load(stage, sheetName), frames: looped, delay: 0, x: w === 'buy' ? -CHAT_X : CHAT_X, dance: i * 0.5 };
      }),
    );
    await this.run(parts, this.scaleFor(parts), 1, rigs, undefined, seconds);
  }

  /** A chat pose for the targets; the other character holds her neutral chat pose. */
  async chat(stage: number, targets: CharacterId[], pose: ChatPose, rigs: Container[]) {
    const s = set(stage)!;
    const who = ['buy', 'sell'] as const;
    const parts = await Promise.all(
      who.map(async (w) => {
        const sheetName = `${NAME[w]}_Chat`;
        const anim = targets.includes(w) ? s.animations[`${NAME[w]}_${pose}`] : null;
        const frames: Frames = anim ? anim.frames : [[0, 0.1]];
        return { who: w, sheet: s.sheets[sheetName], tex: await this.load(stage, sheetName), frames, delay: 0, x: w === 'buy' ? -CHAT_X : CHAT_X };
      }),
    );
    await this.run(parts, this.scaleFor(parts), 1, rigs);
  }

  /** The contact point of a stage's slap, in world units (for the camera push-in on whale slaps). */
  contactPoint(stage: number, attacker: CharacterId) {
    const s = set(stage);
    const a = s?.animations[`${NAME[attacker]}_Slap`];
    const d = s?.animations[`${NAME[attacker === 'buy' ? 'sell' : 'buy']}_Reaction`];
    if (!s || !a || !d) return null;
    const aSheet = s.sheets[a.sheet];
    const dSheet = s.sheets[d.sheet];
    const k = this.scaleFor([{ sheet: aSheet }, { sheet: dSheet }]);
    const hand = aSheet.hand ?? [0, 0];
    const cheek = dSheet.cheek ?? [0, 0];
    const gap = Math.max(120, attacker === 'buy' ? k * (hand[0] - cheek[0]) : k * (cheek[0] - hand[0]));
    const ax = attacker === 'buy' ? -gap / 2 : gap / 2;
    return { x: ax + k * hand[0], y: this.floorY + k * hand[1] };
  }

  /** Still frames for a share card: the attacker's contact frame and the defender's recoil, with their spacing. */
  async cardFrames(stage: number, attacker: CharacterId) {
    const s = set(stage);
    const defender: CharacterId = attacker === 'buy' ? 'sell' : 'buy';
    const a = s?.animations[`${NAME[attacker]}_Slap`];
    const d = s?.animations[`${NAME[defender]}_Reaction`];
    if (!s || !a || !d) return null;
    const aSheet = s.sheets[a.sheet];
    const dSheet = s.sheets[d.sheet];
    const aFrame = (aSheet as Sheet & { contactFrame?: number }).contactFrame ?? frameAt(a.frames, s.contactSeconds);
    const dFrame = frameAt(d.frames, s.contactSeconds - s.defenderDelay + 0.08);
    const url = (sheet: string, f: string) => FILES[`../assets/sprites/s${stage}/${f}`];
    const hand = aSheet.hand ?? [0, 0];
    const cheek = dSheet.cheek ?? [0, 0];
    return {
      attacker: { url: url(a.sheet, aSheet.files[aFrame]), sheet: aSheet },
      defender: { url: url(d.sheet, dSheet.files[dFrame]), sheet: dSheet },
      // Boot-to-boot distance (source pixels) that puts the palm on the cheek.
      gap: Math.max(120 / ((this.floorY - HEAD_TOP) / ((aSheet.figureHeight + dSheet.figureHeight) / 2)), attacker === 'buy' ? hand[0] - cheek[0] : cheek[0] - hand[0]),
      hand,
    };
  }

  private async run(parts: Part[], k: number, speed: number, rigs: Container[], onTime?: (t: number) => void, until?: number, trackHeads = true, rate?: (t: number) => number) {
    const sprites = parts.map((p) => {
      const sp = new Sprite(p.tex[p.frames[0][0]]);
      sp.anchor.set(p.sheet.anchor[0] / p.sheet.width, p.sheet.anchor[1] / p.sheet.height);
      sp.scale.set(k);
      sp.position.set(p.x, this.floorY);
      sp.alpha = 0;
      this.layer.addChild(sp);
      if (trackHeads) this.heads[p.who] = { x: p.x, y: this.floorY - k * p.sheet.figureHeight + 40 };
      return sp;
    });
    const end = until ?? Math.max(...parts.map((p) => p.delay + total(p.frames)));
    let t = 0;
    let real = 0;
    let outAt = -1;
    await new Promise<void>((done) => {
      const step = (tk: Ticker) => {
        const ms = Math.min(tk.deltaMS, 50);
        real += ms;
        t += (ms / 1000) * speed * (rate ? rate(t) : 1);
        parts.forEach((p, i) => {
          const sp = sprites[i];
          sp.texture = p.tex[frameAt(p.frames, t - p.delay)];
          if (p.dance !== undefined) {
            const beat = (t * BEAT + p.dance) * Math.PI;
            sp.y = this.floorY - Math.abs(Math.sin(beat)) * 22;
            sp.rotation = Math.sin(beat / 2) * 0.05;
            sp.x = p.x + Math.sin(beat / 2) * 14;
          }
        });
        onTime?.(t);
        let fade = Math.min(1, real / FADE_MS);
        if (t >= end && outAt < 0) outAt = real;
        if (outAt >= 0) fade = Math.max(0, 1 - (real - outAt) / FADE_MS);
        for (const sp of sprites) sp.alpha = fade;
        for (const r of rigs) r.alpha = 1 - fade;
        if (outAt >= 0 && fade <= 0) {
          this.ticker.remove(step);
          done();
        }
      };
      this.ticker.add(step);
    });
    for (const r of rigs) r.alpha = 1;
    for (const sp of sprites) sp.destroy();
    this.heads = {};
  }
}
