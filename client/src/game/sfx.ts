import type { CharacterId } from '@bvs/shared';

// Hit-reaction voice clips (tools/voice/make_voices.py; replaceable, see docs/ASSETS.md).
const VOICE_URLS = import.meta.glob('../assets/voice/*.wav', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;

/** Synthesized effects plus the characters' voice clips. Off until the viewer enables it. */
export class Sfx {
  enabled = false;
  private ctx: AudioContext | null = null;
  private voices: Record<CharacterId, { hits: AudioBuffer[]; big: AudioBuffer | null; flirts: AudioBuffer[] }> = {
    buy: { hits: [], big: null, flirts: [] },
    sell: { hits: [], big: null, flirts: [] },
  };
  private voicesLoading = false;
  private last: Record<string, number> = {};
  private speaking: AudioBufferSourceNode | null = null;

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.crowdBed?.gain.gain.setTargetAtTime(0, this.ctx?.currentTime ?? 0, 0.1);
    if (on && !this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.enabled = false;
      }
    }
    void this.ctx?.resume();
    if (this.ctx && !this.voicesLoading) void this.loadVoices(this.ctx);
  }

  private async loadVoices(ctx: AudioContext) {
    this.voicesLoading = true;
    await Promise.all(
      Object.entries(VOICE_URLS).map(async ([path, url]) => {
        const m = /\/(buy|sell)-(hit|flirt)-(big|\d+)\.wav$/.exec(path);
        if (!m) return;
        try {
          const buf = await ctx.decodeAudioData(await readBytes(url));
          const v = this.voices[m[1] as CharacterId];
          if (m[2] === 'flirt') v.flirts.push(buf);
          else if (m[3] === 'big') v.big = buf;
          else v.hits.push(buf);
        } catch {
          console.warn(`Voice clip ${path} could not be decoded.`);
        }
      }),
    );
  }

  /**
   * The slapped character's reaction: a gasp and a comic "ow", in her own
   * voice, under the slap sound. Never two clips at once; a random variant
   * that differs from the last one; the bigger take for enhanced slaps.
   */
  voice(who: CharacterId, intensity: number) {
    if (!this.enabled || !this.ctx) return;
    const v = this.voices[who];
    this.say(intensity >= 0.6 && v.big ? v.big : this.pick(`${who}-hit`, v.hits), 0.42);
  }

  /** A soft sigh and giggle in her voice: the coy flirt reaction and outfit unlocks. */
  flirt(who: CharacterId) {
    if (!this.enabled || !this.ctx) return;
    this.say(this.pick(`${who}-flirt`, this.voices[who].flirts), 0.38);
  }

  /** A random variant that differs from the last one played. */
  private pick(key: string, list: AudioBuffer[]) {
    if (!list.length) return undefined;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last[key]) i = (i + 1) % list.length;
    this.last[key] = i;
    return list[i];
  }

  /** Plays one voice clip; a new clip cuts off the previous one so voices never overlap. */
  private say(buf: AudioBuffer | undefined, gain: number) {
    if (!buf || !this.ctx) return;
    try {
      this.speaking?.stop();
    } catch {
      /* already ended */
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.ctx.destination);
    src.start(this.ctx.currentTime + 0.04);
    src.onended = () => this.speaking === src && (this.speaking = null);
    this.speaking = src;
  }

  private env(node: AudioNode, gain: number, dur: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    node.connect(g).connect(ctx.destination);
  }

  private noise(dur: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + delay + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.setValueAtTime(gain, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + dur + 0.02);
  }

  slap(intensity: number) {
    if (!this.enabled || !this.ctx) return;
    const n = this.noise(0.14);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    n.connect(f);
    this.env(f, 0.55, 0.14);
    n.start();
    this.tone(880, 0.12, 'triangle', 0.08 + intensity * 0.06, 0.02, 1760);
  }

  whoosh() {
    if (!this.enabled || !this.ctx) return;
    const n = this.noise(0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, this.ctx.currentTime);
    f.frequency.linearRampToValueAtTime(2400, this.ctx.currentTime + 0.3);
    n.connect(f);
    this.env(f, 0.12, 0.3);
    n.start();
  }

  sparkle() {
    if (!this.enabled || !this.ctx) return;
    [1318, 1568, 2093, 2637].forEach((fr, i) => this.tone(fr, 0.25, 'sine', 0.06, i * 0.07));
  }

  chime() {
    if (!this.enabled || !this.ctx) return;
    this.tone(988, 0.15, 'sine', 0.05);
    this.tone(1319, 0.2, 'sine', 0.04, 0.08);
  }

  pop() {
    if (!this.enabled || !this.ctx) return;
    this.tone(600, 0.1, 'square', 0.04, 0, 900);
  }

  /** Whale slap: a deep boom and a crowd roar under the slap. */
  whale() {
    if (!this.enabled || !this.ctx) return;
    this.tone(90, 0.7, 'sine', 0.35, 0, 38);
    this.tone(180, 0.35, 'triangle', 0.12, 0, 60);
    this.crowdCheer(1);
  }

  /** Combo callout: a rising arpeggio that climbs with the streak. */
  combo(count: number) {
    if (!this.enabled || !this.ctx) return;
    const base = 523 * Math.pow(2, Math.min(count - 3, 9) / 12);
    [1, 1.25, 1.5, 2].forEach((m, i) => this.tone(base * m, 0.16, 'square', 0.035, i * 0.06));
  }

  /** A swell of crowd noise (0..1). */
  crowdCheer(strength = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const dur = 0.9 + strength * 0.8;
    const n = this.noise(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06 + strength * 0.12, ctx.currentTime + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    n.connect(f).connect(g).connect(ctx.destination);
    n.start();
  }

  private crowdBed: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  /** Background crowd murmur that grows with the hype meter (0..1). */
  setHype(h: number) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    if (!this.crowdBed) {
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // Brown-ish noise with a slow wobble reads as a distant crowd.
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5 * (0.75 + 0.25 * Math.sin((i / ctx.sampleRate) * Math.PI * 1.5));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700;
      f.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(f).connect(gain).connect(ctx.destination);
      src.start();
      this.crowdBed = { src, gain };
    }
    this.crowdBed.gain.gain.setTargetAtTime(h < 0.02 ? 0 : 0.03 + h * 0.14, ctx.currentTime, 0.8);
  }
}

/** Clip bytes; inlined data: URLs are decoded directly since strict hosts block fetching them. */
async function readBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  return (await fetch(url)).arrayBuffer();
}
