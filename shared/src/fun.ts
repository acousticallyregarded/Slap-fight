import Decimal from 'decimal.js';
import type { FeedTrade, Side } from './types';

/**
 * Show extras layered on top of the rules: combo streaks, whale slaps and the
 * day's biggest slap, the hype meter (recent qualifying volume) and the chat
 * cheer tally. None of it changes what counts as a slap or an unlock: one
 * qualifying trade is still one slap, and chat still never moves trades or
 * outfits. The engine owns this state so every viewer sees the same numbers.
 */
export interface FunConfig {
  /** Slaps in a row by one side before it counts as a combo. */
  comboMin: number;
  /** A qualifying trade at or above this USD value is a whale slap. */
  whaleUsd: string;
  /** The hype meter looks at qualifying volume over this window. */
  hypeWindowMs: number;
  /** Qualifying USD volume within the window that fills the hype meter. */
  hypeFullUsd: number;
  /** Chat cheers ("go buy", "go sell") count toward the crowd bar for this long. */
  cheerWindowMs: number;
  /** One viewer's cheers count at most once per this interval per team. */
  cheerSenderCooldownMs: number;
}

export const DEFAULT_FUN: FunConfig = {
  comboMin: 3,
  whaleUsd: '1000',
  hypeWindowMs: 5 * 60_000,
  hypeFullUsd: 5_000,
  cheerWindowMs: 2 * 60_000,
  cheerSenderCooldownMs: 10_000,
};

export interface BestSlap {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  trade: FeedTrade;
  /** Outfit stage when it landed (for the share card). */
  stage: number;
}

/** Persisted with the rest of the engine state. */
export interface FunState {
  streak: { side: Side | null; count: number };
  best: BestSlap | null;
  /** [timestamp ms, usd] of recent qualifying trades. */
  volume: [number, number][];
}

export const emptyFun = (): FunState => ({ streak: { side: null, count: 0 }, best: null, volume: [] });

/** What viewers see. */
export interface FunSnapshot {
  streak: { side: Side | null; count: number };
  /** Today's biggest slap (UTC day), or null. */
  bestToday: BestSlap | null;
  /** 0..1 */
  hype: number;
  volumeUsd: number;
  cheers: { buy: number; sell: number };
  /** Streak length that counts as a combo. */
  comboMin: number;
}

/** What a slap adds to the show. */
export interface SlapExtras {
  /** Slaps in a row by this side, including this one. */
  combo: number;
  /** The other side's streak this slap ended (0 when it was below a combo). */
  broke: number;
  whale: boolean;
  /** A new biggest slap of the day. */
  record: boolean;
}

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class FunTracker {
  private cheerLog: [number, Side][] = [];
  private cheerReady = new Map<string, number>();

  constructor(private state: () => FunState, private cfg: () => FunConfig, private now: () => number) {}

  /** A qualifying trade that slapped: updates the streak, volume and record. */
  slap(trade: FeedTrade, stage: number): SlapExtras {
    const s = this.state();
    const c = this.cfg();
    let broke = 0;
    if (s.streak.side === trade.side) s.streak.count += 1;
    else {
      if (s.streak.count >= c.comboMin) broke = s.streak.count;
      s.streak = { side: trade.side, count: 1 };
    }
    const record = this.addVolume(trade, stage);
    return { combo: s.streak.count, broke, whale: this.isWhale(trade), record };
  }

  /** A qualifying trade after the final milestone (a celebration, not a slap). */
  celebrate(trade: FeedTrade, stage: number) {
    return { whale: this.isWhale(trade), record: this.addVolume(trade, stage) };
  }

  /** A slap whose transaction was not finalized: it no longer holds the record. */
  corrected(eventId: string) {
    const s = this.state();
    if (s.best?.trade.eventId === eventId) s.best = null;
  }

  /** A chat cheer for a team. Returns false when it did not count (same viewer again too soon). */
  cheer(side: Side, sender: string): boolean {
    const now = this.now();
    const key = `${side}:${sender}`;
    if ((this.cheerReady.get(key) ?? 0) > now) return false;
    this.cheerReady.set(key, now + this.cfg().cheerSenderCooldownMs);
    if (this.cheerReady.size > 5000) for (const [k, v] of this.cheerReady) if (v <= now) this.cheerReady.delete(k);
    this.cheerLog.push([now, side]);
    this.prune(now);
    return true;
  }

  snapshot(): FunSnapshot {
    const now = this.now();
    this.prune(now);
    const s = this.state();
    const c = this.cfg();
    const volumeUsd = s.volume.reduce((a, [, u]) => a + u, 0);
    const cheers = { buy: 0, sell: 0 };
    for (const [, side] of this.cheerLog) cheers[side]++;
    return {
      streak: { ...s.streak },
      bestToday: s.best && s.best.day === utcDay(now) ? s.best : null,
      hype: Math.max(0, Math.min(1, volumeUsd / Math.max(1, c.hypeFullUsd))),
      volumeUsd: Math.round(volumeUsd * 100) / 100,
      cheers,
      comboMin: c.comboMin,
    };
  }

  private isWhale(t: FeedTrade) {
    try {
      return new Decimal(t.usdValue).gte(this.cfg().whaleUsd);
    } catch {
      return false;
    }
  }

  private addVolume(trade: FeedTrade, stage: number): boolean {
    const s = this.state();
    const now = this.now();
    const usd = Number(trade.usdValue);
    if (Number.isFinite(usd)) s.volume.push([now, usd]);
    this.prune(now);
    const day = utcDay(now);
    const best = s.best && s.best.day === day ? s.best : null;
    if (!best || new Decimal(trade.usdValue).gt(best.trade.usdValue)) {
      s.best = { day, trade, stage };
      // The day's first slap sets the mark quietly; beating it is the news.
      return !!best;
    }
    return false;
  }

  private prune(now: number) {
    const s = this.state();
    const c = this.cfg();
    const v = s.volume.findIndex(([t]) => now - t <= c.hypeWindowMs);
    if (v !== 0) s.volume.splice(0, v < 0 ? s.volume.length : v);
    const ch = this.cheerLog.findIndex(([t]) => now - t <= c.cheerWindowMs);
    if (ch !== 0) this.cheerLog.splice(0, ch < 0 ? this.cheerLog.length : ch);
  }
}
