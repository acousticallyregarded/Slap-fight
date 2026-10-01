import { formatUsd, type CharacterId, type ChatReaction, type GameEvent } from '@bvs/shared';
import type { Arena } from '../pixi/Arena';
import type { ChatPose } from '../pixi/SpriteActs';
import type { StateName } from '../pixi/pose';
import { LAYER_LABELS, SELL_LAYERS } from '../pixi/styles';
import type { Sfx } from './sfx';

type TradeItem = Extract<GameEvent, { type: 'slap' | 'outfitUnlock' | 'celebrate' }>;

export interface DirectorHooks {
  announce(text: string, tone: 'buy' | 'sell' | 'unlock' | 'final' | 'info'): void;
  landed(attacker: CharacterId): void;
  pending(count: number): void;
  stageShown(stage: number): void;
  /** A slap landed: the attacker's streak (1 = no streak) and the streak it broke, if any. */
  combo(side: CharacterId, count: number, broke: number): void;
  /** Big centre-stage callout text. */
  callout(text: string, tone: CharacterId | 'gold'): void;
  /** Who is ahead on slaps right now, or null when tied. */
  leader(): CharacterId | null;
}

/** Combo callouts by streak length (and every 5 after the last one). */
const COMBO_CALLOUTS: Record<number, string> = { 3: 'COMBO!', 5: 'ON FIRE!', 7: 'UNSTOPPABLE!', 10: 'LEGENDARY!' };
export function comboCallout(n: number, min = 3): string | null {
  if (n < min) return null;
  const word = n === min ? 'COMBO!' : COMBO_CALLOUTS[n] ?? (n > 10 && n % 5 === 0 ? 'GODLIKE!' : null);
  return word ? `${n}x ${word}` : null;
}

/**
 * Playful trash talk from a fixed list (never chat text, never suggestive).
 * `combo` lines play mid-streak, `breaker` when a streak is snapped, `idle`
 * when the leader gets bored waiting for the next trade.
 */
const TAUNTS: Record<CharacterId, Record<'combo' | 'breaker' | 'idle', string[]>> = {
  buy: {
    combo: ['Again? Really?', 'Green candles only!', 'Keep ’em coming!', 'Iron palms, diamond hands!'],
    breaker: ['Streak’s over, Sell!', 'Not today!', 'Buy the dip? I AM the dip!'],
    idle: ['Is that all, Sell?', 'Scoreboard says hi~', 'Waiting on you, Sell!', 'Too easy!'],
  },
  sell: {
    combo: ['Take profits, take slaps!', 'Red is my color!', 'Paper hands hit hardest~', 'Another one!'],
    breaker: ['Nope. My turn!', 'Combo? Cancelled.', 'Sit down, Buy!'],
    idle: ['Tired already, Buy?', 'Check the scoreboard~', 'Your move, Buy!', 'Is the market asleep?'],
  },
};
const IDLE_TAUNT_AFTER_MS = 25_000;
const IDLE_TAUNT_EVERY_MS = 45_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The central animation scheduler. Trades and outfit unlocks play strictly in
 * arrival order and never overlap; chat reactions only fill idle time and are
 * dropped when stale. Nothing is discarded from the trade queue.
 */
export class Director {
  private queue: TradeItem[] = [];
  private chat: { r: ChatReaction; at: number }[] = [];
  private running = false;
  private stopped = false;
  reducedMotion = false;
  maxSpeed = 2.2;
  maxChatAgeMs = 6000;

  comboMin = 3;
  private lastActivity = performance.now();
  private lastTaunt = 0;
  private tauntN = 0;
  private idleTimer: ReturnType<typeof setInterval>;

  constructor(private arena: Arena, private hooks: DirectorHooks, private sfx: Sfx) {
    this.idleTimer = setInterval(() => this.idleTaunt(), 5_000);
  }

  private taunt(who: CharacterId, kind: 'combo' | 'breaker' | 'idle') {
    const list = TAUNTS[who][kind];
    this.arena.bubble(who, list[this.tauntN++ % list.length], 2000);
    this.lastTaunt = performance.now();
  }

  /** The side ahead on slaps throws out a line when nothing has happened for a while. */
  private async idleTaunt() {
    const now = performance.now();
    if (this.running || this.queue.length || this.stopped) return;
    if (now - this.lastActivity < IDLE_TAUNT_AFTER_MS || now - this.lastTaunt < IDLE_TAUNT_EVERY_MS) return;
    const who = this.hooks.leader();
    if (!who) return;
    this.running = true;
    try {
      this.taunt(who, 'idle');
      const stage = this.arena.rigs.buy.outfitStage;
      const pose = this.tauntN % 2 ? 'Laugh' : 'Cheer';
      if (!this.reducedMotion && this.arena.acts.hasChat(stage, [who], pose)) {
        this.arena.setWideShot(true);
        try {
          await this.arena.acts.chat(stage, [who], pose, Object.values(this.arena.rigs));
        } finally {
          this.arena.setWideShot(false);
        }
      } else await this.arena.rigs[who].play(who === 'buy' ? 'cheer' : 'smugVictory');
    } finally {
      this.running = false;
      this.lastActivity = performance.now();
    }
    this.pump();
  }

  enqueue(e: TradeItem) {
    this.queue.push(e);
    this.hooks.pending(this.queue.length);
    this.pump();
  }

  enqueueChat(r: ChatReaction) {
    this.chat.push({ r, at: performance.now() });
    // Never build a long backlog.
    if (this.chat.length > 3) this.chat.splice(0, this.chat.length - 3);
    this.pump();
  }

  /** Immediately show a state (join/reset): no celebration replay. */
  showStage(stage: number) {
    for (const r of Object.values(this.arena.rigs)) r.setOutfitStage(stage);
    this.arena.acts.preload(stage);
    this.hooks.stageShown(stage);
  }

  clear() {
    this.queue = [];
    this.chat = [];
    this.hooks.pending(0);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.idleTimer);
  }

  get speed() {
    return Math.min(this.maxSpeed, 1 + 0.18 * this.queue.length);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped) {
        const next = this.queue.shift();
        if (next) this.lastActivity = performance.now();
        if (next) {
          this.hooks.pending(this.queue.length);
          const speed = this.speed;
          if (next.type === 'slap') await this.slap(next, speed);
          else if (next.type === 'celebrate') await this.celebrate(next, speed);
          else await this.unlock(next, speed);
          continue;
        }
        const c = this.takeChat();
        if (c) {
          await this.react(c);
          continue;
        }
        break;
      }
    } finally {
      this.running = false;
    }
  }

  private takeChat(): ChatReaction | null {
    const now = performance.now();
    while (this.chat.length) {
      const item = this.chat.shift()!;
      if (now - item.at <= this.maxChatAgeMs) return item.r;
    }
    return null;
  }

  private async slap(e: Extract<TradeItem, { type: 'slap' }>, speed: number) {
    const A = e.attacker;
    const D: CharacterId = A === 'buy' ? 'sell' : 'buy';
    const a = this.arena.rigs[A];
    const d = this.arena.rigs[D];
    const usd = formatUsd(e.trade.usdValue);
    const text = e.whale
      ? `WHALE SLAP! ${A.toUpperCase()} — ${usd} ${A}`
      : A === 'buy' ? `BUY lands a slap! — ${usd} buy` : `SELL strikes back! — ${usd} sell`;
    const whale = !!e.whale;
    // What happens the moment the palm lands, whichever animation plays.
    const onHit = () => {
      this.hooks.landed(A);
      this.hooks.combo(A, e.combo ?? 1, e.broke ?? 0);
      const call = comboCallout(e.combo ?? 1, this.comboMin);
      if (e.broke) {
        this.hooks.callout('COMBO BREAKER!', A);
        this.taunt(A, 'breaker');
      } else if (call) {
        this.hooks.callout(call, A);
        this.sfx.combo(e.combo);
        if (e.combo >= this.comboMin) this.taunt(A, 'combo');
      }
      if (whale) this.sfx.whale();
      if (e.record) setTimeout(() => this.hooks.callout('NEW BIGGEST SLAP TODAY!', 'gold'), e.broke || call ? 900 : 350);
    };

    if (this.reducedMotion) {
      this.hooks.announce(text, A);
      await Promise.all([
        a.play('reducedSlapAttack', 1, (m) => m === 'impact' && (onHit(), this.sfx.pop(), this.sfx.voice(D, e.intensity))),
        d.play('reducedSlapDefend'),
      ]);
      return;
    }
    const stage = a.outfitStage;
    if (this.arena.acts.hasSlap(stage, A)) {
      this.hooks.announce(text, A);
      // Whale slaps play at normal speed even under a backlog, with a slow-motion swing.
      const sp = whale ? 1 : speed;
      // The swing starts after the wind-up frames.
      setTimeout(() => this.sfx.whoosh(), (whale ? 500 : 350) / sp);
      if (whale) {
        const p = this.arena.acts.contactPoint(stage, A);
        if (p) this.arena.zoomTo(p, 1.35, 520, 1100);
      }
      this.arena.setWideShot(true);
      try {
        await this.arena.acts.slap(
          stage,
          A,
          sp,
          [a, d],
          (at) => {
            this.arena.impact(D, whale ? 1 : e.intensity, at, whale);
            if (whale) this.arena.flash(0.75);
            this.sfx.slap(whale ? 1 : e.intensity);
            this.sfx.voice(D, whale ? 1 : e.intensity);
            onHit();
          },
          whale && !this.reducedMotion,
        );
      } finally {
        this.arena.setWideShot(false);
      }
      return;
    }
    this.sfx.whoosh();
    const windup = a.play('slapWindup', speed);
    await wait(170 / speed);
    void d.play('notice', speed);
    await windup;
    this.hooks.announce(text, A);
    await a.play('slapStrike', speed, (m) => {
      if (m !== 'impact') return;
      this.arena.impact(D, whale ? 1 : e.intensity, undefined, whale);
      if (whale) this.arena.flash(0.75);
      this.sfx.slap(whale ? 1 : e.intensity);
      this.sfx.voice(D, whale ? 1 : e.intensity);
      onHit();
      void d.play('receiveSlap', speed);
    });
    await wait(520 / speed);
    const glareD = d.play('glare', speed);
    const reactA: StateName = A === 'buy' ? 'glare' : 'glare';
    await Promise.all([glareD, a.play(reactA, speed)]);
    await wait(120 / speed);
    await Promise.all([a.play('recover', speed), d.play('recover', speed)]);
  }

  /** One shared milestone: both characters lose the same layer together. */
  private async unlock(e: Extract<TradeItem, { type: 'outfitUnlock' }>, speed: number) {
    const rigs = Object.values(this.arena.rigs);
    const layer = SELL_LAYERS[e.stage - 1];
    const label = layer ? LAYER_LABELS[layer] : 'Layers';
    const msg = e.final ? 'FINAL OUTFIT UNLOCKED!' : `${formatUsd(e.threshold, false)} unlocked: ${label.toLowerCase()} fall away!`;
    this.hooks.announce(msg, e.final ? 'final' : 'unlock');
    this.sfx.sparkle();
    this.arena.acts.preload(e.stage);
    const s = Math.min(speed, 1.6);
    let shown = false;
    await Promise.all(
      rigs.map((rig) =>
        rig.play('outfitTransition', s, (m) => {
          if (m !== 'release') return;
          const at = rig.dropLayer(e.stage, this.reducedMotion);
          this.arena.sparkleBurst(at, e.final ? 26 : 16);
          if (!shown) {
            this.hooks.stageShown(e.stage);
            // One voice per unlock, taking turns, so the two never talk over each other.
            this.sfx.flirt(e.stage % 2 ? 'sell' : 'buy');
          }
          shown = true;
        }),
      ),
    );
    if (e.final && !this.reducedMotion) {
      for (const rig of rigs) this.arena.sparkleBurst(rig.headGlobal(), 20, ['#ff6aa0', '#c084fc', '#fff7ae', '#5eead4']);
      await wait(400);
    }
    // The final milestone ends the rivalry: a long dance party, and every
    // trade after it starts a shorter one instead of a slap.
    if (e.final) await this.party(6.5, 110);
  }

  private async celebrate(e: Extract<TradeItem, { type: 'celebrate' }>, speed: number) {
    const usd = formatUsd(e.trade.usdValue);
    this.hooks.announce(`${e.whale ? 'WHALE! ' : ''}${e.side.toUpperCase()} keeps the party going! — ${usd} ${e.side}`, e.side);
    if (e.whale) this.sfx.whale();
    if (e.record) this.hooks.callout('NEW BIGGEST TRADE TODAY!', 'gold');
    await this.party(e.whale ? 4.5 : Math.max(1.6, 3.2 / speed), e.whale ? 140 : 70);
  }

  /** Confetti and both characters dancing. */
  private async party(seconds: number, confettiPerSecond: number) {
    const rigs = Object.values(this.arena.rigs);
    const stage = this.arena.rigs.buy.outfitStage;
    this.sfx.sparkle();
    this.arena.confetti(seconds, confettiPerSecond);
    if (this.reducedMotion || !this.arena.acts.hasDance(stage)) {
      await Promise.all(rigs.map((r) => r.play('cheer')));
      return;
    }
    this.arena.setWideShot(true);
    try {
      await this.arena.acts.dance(stage, seconds, rigs);
    } finally {
      this.arena.setWideShot(false);
    }
  }

  private async react(r: ChatReaction) {
    const targets: CharacterId[] = r.target === 'both' ? ['buy', 'sell'] : [r.target];
    const stage = this.arena.rigs.buy.outfitStage;
    const pose = POSE_FOR[r.category];
    if (!this.reducedMotion && this.arena.acts.hasChat(stage, targets, pose)) {
      for (const t of targets) if (r.bubble) this.arena.bubble(t, r.bubble);
      this.sfx.chime();
      if (r.category === 'flirt') this.sfx.flirt(targets[0]);
      this.arena.setWideShot(true);
      try {
        await this.arena.acts.chat(stage, targets, pose, Object.values(this.arena.rigs));
      } finally {
        this.arena.setWideShot(false);
      }
      return;
    }
    const state = STATE_FOR[r.category];
    const plays = targets.map((t) => {
      const st = typeof state === 'function' ? state(t) : state;
      if (r.bubble) this.arena.bubble(t, r.bubble);
      return this.arena.rigs[t].play(st);
    });
    this.sfx.chime();
    if (r.category === 'flirt') this.sfx.flirt(targets[0]);
    await Promise.all(plays);
  }
}

/** Chat poses in the hand-drawn art pack. */
const POSE_FOR: Record<ChatReaction['category'], ChatPose> = {
  greeting: 'Greeting',
  attention: 'Attention',
  compliment: 'Compliment',
  flirt: 'Flirt',
  boundary: 'Boundary',
  buyCheer: 'Cheer',
  sellCheer: 'Cheer',
  laughter: 'Laugh',
  sportsmanship: 'GG',
};

const STATE_FOR: Record<ChatReaction['category'], StateName | ((t: CharacterId) => StateName)> = {
  greeting: 'peace',
  attention: 'wave',
  compliment: 'smileTilt',
  flirt: 'coy',
  boundary: 'fingerWag',
  buyCheer: 'cheer',
  sellCheer: 'smugVictory',
  laughter: 'laugh',
  sportsmanship: 'acknowledge',
};
