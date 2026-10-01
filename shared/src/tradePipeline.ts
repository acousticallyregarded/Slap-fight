import Decimal from 'decimal.js';
import type { GameConfig } from './config';
import type { ConfirmationStatus, NormalizedSwap, RawSwap, SwapDisposition } from './types';

export interface QuotePrice {
  /** USD per 1 unit of the quote asset, decimal string. */
  usd: string;
  /** Time the price applies to. */
  at: number;
  source: string;
}

/** Returns a verified timestamp-appropriate price, or null when none can be verified. */
export interface PriceLookup {
  priceAt(asset: string, timestamp: number): QuotePrice | null;
}

export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
}

const RANK: Record<ConfirmationStatus, number> = { processed: 0, confirmed: 1, finalized: 2, failed: -1, dropped: -1 };

export interface PipelineResult {
  disposition: SwapDisposition;
  swap?: NormalizedSwap;
  reason?: string;
}

export function eventIdFor(signature: string, swapIndex: number): string {
  return `${signature}:${swapIndex}`;
}

/**
 * Validates, deduplicates, prices and thresholds swaps. Pure aside from the
 * injected stores so it runs identically in the server and the in-browser demo.
 */
export class TradePipeline {
  /** Trades waiting on a verified price or on confirmation, keyed by eventId. */
  readonly pending = new Map<string, { raw: RawSwap; since: number; reason: 'price' | 'confirmation' }>();

  constructor(
    private config: () => GameConfig,
    private prices: PriceLookup,
    private seen: SeenStore,
  ) {}

  process(raw: RawSwap, now = Date.now()): PipelineResult {
    const cfg = this.config();
    if (!raw || typeof raw.transactionSignature !== 'string' || !raw.transactionSignature) {
      return { disposition: 'invalid', reason: 'missing signature' };
    }
    if (!Number.isInteger(raw.swapIndex) || raw.swapIndex < 0) return { disposition: 'invalid', reason: 'bad swap index' };
    if (raw.side !== 'buy' && raw.side !== 'sell') return { disposition: 'invalid', reason: 'bad side' };
    if (!cfg.token.mint || raw.mint !== cfg.token.mint) return { disposition: 'wrong-mint', reason: 'unrelated token' };

    const eventId = eventIdFor(raw.transactionSignature, raw.swapIndex);

    if (raw.confirmationStatus === 'failed' || raw.confirmationStatus === 'dropped') {
      this.pending.delete(eventId);
      const marker = `${eventId}#corrected`;
      if (this.seen.has(marker)) return { disposition: 'duplicate' };
      if (this.seen.has(eventId)) {
        this.seen.add(marker);
        return { disposition: 'corrected', swap: this.normalize(raw, eventId, null) };
      }
      // Never played: remember it so a late 'confirmed' delivery of the same swap cannot slap.
      this.seen.add(eventId);
      this.seen.add(marker);
      return { disposition: 'invalid', reason: 'transaction failed' };
    }

    if (this.seen.has(eventId)) return { disposition: 'duplicate' };

    let amount: Decimal;
    try {
      amount = new Decimal(raw.quoteAmount);
    } catch {
      return { disposition: 'invalid', reason: 'bad quote amount' };
    }
    if (!amount.isFinite() || amount.isNegative()) return { disposition: 'invalid', reason: 'bad quote amount' };

    if (RANK[raw.confirmationStatus] < RANK[cfg.trades.requiredConfirmation]) {
      this.pending.set(eventId, { raw, since: this.pending.get(eventId)?.since ?? now, reason: 'confirmation' });
      return { disposition: 'pending-confirmation', swap: this.normalize(raw, eventId, null) };
    }

    const usd = this.usdValue(raw, amount);
    if (!usd) {
      this.pending.set(eventId, { raw, since: this.pending.get(eventId)?.since ?? now, reason: 'price' });
      return { disposition: 'pending-price', swap: this.normalize(raw, eventId, null) };
    }
    this.pending.delete(eventId);
    this.seen.add(eventId);
    const swap = this.normalize(raw, eventId, usd.toString());
    if (usd.lessThan(new Decimal(cfg.trades.slapThresholdUsd))) return { disposition: 'below-threshold', swap };
    return { disposition: 'slap', swap };
  }

  /** Re-attempts pending trades (after a new price sample arrives). Order preserved by timestamp. */
  retryPending(now = Date.now()): { result: PipelineResult; raw: RawSwap }[] {
    const items = [...this.pending.values()].filter((p) => p.reason === 'price').sort((a, b) => a.raw.timestamp - b.raw.timestamp);
    const out: { result: PipelineResult; raw: RawSwap }[] = [];
    for (const p of items) {
      const r = this.process(p.raw, now);
      if (r.disposition !== 'pending-price') out.push({ result: r, raw: p.raw });
    }
    return out;
  }

  /** Pending trades older than the timeout. They stay pending (never guessed) but are reported. */
  overdue(now = Date.now()): RawSwap[] {
    const limit = this.config().trades.pendingPriceTimeoutMs;
    return [...this.pending.values()].filter((p) => now - p.since > limit).map((p) => p.raw);
  }

  private usdValue(raw: RawSwap, amount: Decimal): Decimal | null {
    const cfg = this.config();
    const asset = raw.quoteAsset.toUpperCase();
    if (cfg.trades.usdStableAssets.map((a) => a.toUpperCase()).includes(asset)) return amount;
    const p = this.prices.priceAt(asset, raw.timestamp);
    if (!p) return null;
    if (Math.abs(p.at - raw.timestamp) > cfg.trades.priceToleranceMs) return null;
    let px: Decimal;
    try {
      px = new Decimal(p.usd);
    } catch {
      return null;
    }
    if (!px.isFinite() || px.lte(0)) return null;
    return amount.times(px);
  }

  private normalize(raw: RawSwap, eventId: string, usdValue: string | null): NormalizedSwap {
    return {
      eventId,
      transactionSignature: raw.transactionSignature,
      swapIndex: raw.swapIndex,
      mint: raw.mint,
      side: raw.side,
      quoteAmount: raw.quoteAmount,
      quoteAsset: raw.quoteAsset,
      usdValue,
      timestamp: raw.timestamp,
      confirmationStatus: raw.confirmationStatus,
    };
  }
}

/** Visual intensity grows with size but never changes the contact itself. 0..1 */
export function slapIntensity(usd: string, threshold: string): number {
  const ratio = new Decimal(usd).div(new Decimal(threshold)).toNumber();
  if (!(ratio > 1)) return 0;
  return Math.min(1, Math.log10(ratio) / 2); // 10x -> 0.5, 100x -> 1
}

export function formatUsd(v: string | number, cents = true): string {
  const d = new Decimal(v);
  const fixed = d.toFixed(cents ? 2 : 0, Decimal.ROUND_DOWN);
  const [i, f] = fixed.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${f ? '.' + f : ''}`;
}

/** Bounded insertion-ordered set used for idempotency (persisted by the host). */
export class BoundedSeenSet implements SeenStore {
  private set: Set<string>;
  constructor(initial: string[] = [], private max = 50_000) {
    this.set = new Set(initial);
  }
  has(id: string) {
    return this.set.has(id);
  }
  add(id: string) {
    this.set.add(id);
    if (this.set.size > this.max) {
      const first = this.set.values().next().value;
      if (first !== undefined) this.set.delete(first);
    }
  }
  toArray() {
    return [...this.set];
  }
}
