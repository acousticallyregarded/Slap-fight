import type { GameConfig } from './config';
import { ChatPipeline } from './chat';
import { FunTracker, emptyFun, type FunState } from './fun';
import { applySample, initialMilestoneState, marketStatus, nextMilestone, type MilestoneState } from './milestones';
import { BoundedSeenSet, TradePipeline, slapIntensity, type PriceLookup } from './tradePipeline';
import type {
  ChatReaction,
  ConnectionState,
  FeedTrade,
  GameEvent,
  GameEventInput,
  MarketCapSample,
  MarketState,
  Mode,
  RawChatMessage,
  RawSwap,
  Side,
  Snapshot,
} from './types';

/** Everything persisted per (mode, mint). */
export interface PersistedState {
  version: 1;
  milestones: MilestoneState;
  slaps: { buy: number; sell: number };
  seen: string[];
  /** eventId -> side for swaps that produced a slap (for corrections). */
  slapped: [string, Side][];
  recentTrades: FeedTrade[];
  lastSample: MarketCapSample | null;
  /** Adapter reconnect cursors, e.g. last processed signature. */
  cursors: Record<string, string>;
  /** Combo streak, today's record, recent volume (added later; may be missing in older saves). */
  fun?: FunState;
}

export interface EngineStore {
  load(key: string): PersistedState | null;
  save(key: string, state: PersistedState): void;
  remove(key: string): void;
}

export const emptyState = (): PersistedState => ({
  version: 1,
  milestones: initialMilestoneState(),
  slaps: { buy: 0, sell: 0 },
  seen: [],
  slapped: [],
  recentTrades: [],
  lastSample: null,
  cursors: {},
  fun: emptyFun(),
});

export interface EngineOptions {
  mode: Mode;
  config: () => GameConfig;
  prices: PriceLookup;
  store: EngineStore;
  now?: () => number;
}

export type SwapLog = { disposition: string; eventId?: string; usd?: string | null; reason?: string };

/**
 * One engine per mode. Demo and live never share an engine or a storage key,
 * so resetting demo progress cannot touch live progress.
 */
export class GameEngine {
  readonly mode: Mode;
  private cfg: () => GameConfig;
  private store: EngineStore;
  private now: () => number;
  private state!: PersistedState;
  private key!: string;
  private seen!: BoundedSeenSet;
  private slapped!: Map<string, Side>;
  private trades!: TradePipeline;
  private chat!: ChatPipeline;
  private seq = 0;
  private listeners = new Set<(e: GameEvent) => void>();
  private recentReactions: ChatReaction[] = [];
  private connections: Record<string, ConnectionState> = {};
  private market: MarketState = { sample: null, stale: false, invalidReason: 'no market-cap data' };
  private lastPendingCount = 0;
  private fun!: FunTracker;
  private lastHype = 0;
  private lastCheers = '';
  readonly log: SwapLog[] = [];

  constructor(private opts: EngineOptions) {
    this.mode = opts.mode;
    this.cfg = opts.config;
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  static keyFor(mode: Mode, mint: string) {
    return `${mode}:${mint || 'unset'}`;
  }

  /** Call after the configured mint changes: progress is scoped to the mint. */
  reload() {
    this.load();
    this.emit({ type: 'reset', snapshot: this.snapshot() });
  }

  private load() {
    this.key = GameEngine.keyFor(this.mode, this.cfg().token.mint);
    this.state = this.store.load(this.key) ?? emptyState();
    this.seen = new BoundedSeenSet(this.state.seen);
    this.slapped = new Map(this.state.slapped);
    this.trades = new TradePipeline(this.cfg, this.opts.prices, this.seen);
    this.state.fun ??= emptyFun();
    this.fun = new FunTracker(() => this.state.fun!, () => this.cfg().fun, this.now);
    this.chat = new ChatPipeline(this.cfg);
    this.chat.onCheer = (side, sender) => this.fun.cheer(side, sender) && this.emitFun();
    this.recentReactions = [];
    this.market = marketStatus(this.cfg(), this.state.lastSample, this.now());
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: GameEventInput) {
    const ev = { ...e, seq: ++this.seq } as GameEvent;
    for (const l of this.listeners) l(ev);
  }

  private persist() {
    this.state.seen = this.seen.toArray();
    this.state.slapped = [...this.slapped].slice(-5000);
    this.store.save(this.key, this.state);
  }

  // ---- trades -----------------------------------------------------------

  ingestSwap(raw: RawSwap): SwapLog {
    const r = this.trades.process(raw, this.now());
    const entry: SwapLog = { disposition: r.disposition, eventId: r.swap?.eventId, usd: r.swap?.usdValue, reason: r.reason };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.handleResult(r, raw);
    this.reportPending();
    return entry;
  }

  private handleResult(r: ReturnType<TradePipeline['process']>, raw: RawSwap) {
    if (r.disposition === 'slap' && r.swap) {
      const s = r.swap;
      const trade: FeedTrade = {
        eventId: s.eventId,
        side: s.side,
        usdValue: s.usdValue!,
        quoteAmount: s.quoteAmount,
        quoteAsset: s.quoteAsset,
        timestamp: s.timestamp,
        trader: raw.trader,
        signature: s.transactionSignature,
      };
      this.state.recentTrades = [trade, ...this.state.recentTrades].slice(0, 25);
      if (this.state.milestones.unlockedStage >= this.cfg().milestones.thresholdsUsd.length) {
        // Past the final milestone the rivalry is over: trades start a
        // celebration instead of a slap, and slap counts stay where they ended.
        const extra = this.fun.celebrate(trade, this.state.milestones.unlockedStage);
        this.persist();
        this.emit({ type: 'celebrate', side: s.side, trade, ...extra });
        this.emitFun();
        return;
      }
      this.state.slaps[s.side] += 1;
      this.slapped.set(s.eventId, s.side);
      const extras = this.fun.slap(trade, this.state.milestones.unlockedStage);
      this.persist();
      this.emit({
        type: 'slap',
        attacker: s.side,
        trade,
        intensity: slapIntensity(s.usdValue!, this.cfg().trades.slapThresholdUsd),
        ...extras,
      });
      this.emitFun();
    } else if (r.disposition === 'below-threshold') {
      this.persist(); // remember the id so a redelivery is still a duplicate
    } else if (r.disposition === 'corrected' && r.swap) {
      const side = this.slapped.get(r.swap.eventId);
      if (side) {
        // Consistent policy: counters reflect swaps that are still valid. The
        // animation that already played is not reversed; the feed says why.
        this.state.slaps[side] = Math.max(0, this.state.slaps[side] - 1);
        this.slapped.delete(r.swap.eventId);
        this.state.recentTrades = this.state.recentTrades.map((t) => (t.eventId === r.swap!.eventId ? { ...t, corrected: true } : t));
        this.fun.corrected(r.swap.eventId);
        this.persist();
        this.emit({ type: 'correction', eventId: r.swap.eventId, side, note: 'Transaction was not finalized; slap count corrected.' });
      } else this.persist();
    } else if (r.disposition === 'invalid') {
      this.persist();
    }
  }

  /** Call when a new quote price sample arrives. */
  retryPendingPrices() {
    for (const { result, raw } of this.trades.retryPending(this.now())) this.handleResult(result, raw);
    this.reportPending();
  }

  private pendingPriceCount() {
    let n = 0;
    for (const p of this.trades.pending.values()) if (p.reason === 'price') n++;
    return n;
  }

  get lastSeq() {
    return this.seq;
  }

  pendingSwaps() {
    return [...this.trades.pending.values()];
  }

  private reportPending() {
    const n = this.pendingPriceCount();
    if (n !== this.lastPendingCount) {
      this.lastPendingCount = n;
      this.emit({ type: 'pending', pendingPriceCount: n });
    }
  }

  // ---- market cap -------------------------------------------------------

  ingestMarketCap(sample: MarketCapSample) {
    const cfg = this.cfg();
    const { market, unlocked } = applySample(cfg, this.state.milestones, sample, this.now());
    this.state.lastSample = sample;
    this.market = market;
    this.persist();
    this.emit({ type: 'market', market, nextMilestone: nextMilestone(cfg, this.state.milestones.unlockedStage) });
    const total = cfg.milestones.thresholdsUsd.length;
    for (const u of unlocked) this.emit({ type: 'outfitUnlock', stage: u.stage, threshold: u.threshold, final: u.stage === total });
  }

  private emitFun() {
    const fun = this.fun.snapshot();
    this.lastHype = fun.hype;
    this.lastCheers = JSON.stringify(fun.cheers);
    this.emit({ type: 'fun', fun });
  }

  /** Periodic staleness check; also lets the hype meter and cheer bar cool down. */
  tick() {
    const f = this.fun.snapshot();
    if (Math.abs(f.hype - this.lastHype) >= 0.01 || (f.hype === 0 && this.lastHype !== 0) || JSON.stringify(f.cheers) !== this.lastCheers) this.emitFun();
    const m = marketStatus(this.cfg(), this.state.lastSample, this.now());
    if (m.stale !== this.market.stale || m.invalidReason !== this.market.invalidReason) {
      this.market = m;
      if (m.stale || m.invalidReason) this.state.milestones.run = null;
      this.emit({ type: 'market', market: m, nextMilestone: nextMilestone(this.cfg(), this.state.milestones.unlockedStage) });
    }
  }

  // ---- chat ------------------------------------------------------------

  ingestChat(msg: RawChatMessage) {
    const out = this.chat.process(msg, this.now());
    if (out.result === 'reaction') {
      this.recentReactions = [out.reaction, ...this.recentReactions].slice(0, 15);
      this.emit({ type: 'chatReaction', reaction: out.reaction });
    }
    return out.result;
  }

  // ---- connections & cursors ------------------------------------------

  setConnection(name: string, state: ConnectionState) {
    if (this.connections[name] === state) return;
    this.connections = { ...this.connections, [name]: state };
    this.emit({ type: 'connection', connections: this.connections });
  }

  getCursor(name: string): string | undefined {
    return this.state.cursors[name];
  }

  setCursor(name: string, value: string) {
    this.state.cursors[name] = value;
    this.persist();
  }

  // ---- snapshot & reset -------------------------------------------------

  snapshot(): Snapshot {
    const cfg = this.cfg();
    return {
      mode: this.mode,
      token: { name: cfg.token.name, symbol: cfg.token.symbol, mint: cfg.token.mint },
      unlockedStage: this.state.milestones.unlockedStage,
      slaps: { ...this.state.slaps },
      market: this.market,
      nextMilestone: nextMilestone(cfg, this.state.milestones.unlockedStage),
      milestones: [...cfg.milestones.thresholdsUsd],
      connections: { ...this.connections },
      recentTrades: this.state.recentTrades.slice(0, 12),
      recentReactions: this.recentReactions.slice(0, 8),
      pendingPriceCount: this.pendingPriceCount(),
      fun: this.fun.snapshot(),
      serverTime: this.now(),
    };
  }

  /** Clears this engine's progress only. Refuses to run on live. */
  resetProgress() {
    if (this.mode !== 'demo') throw new Error('Only demo progress can be reset.');
    this.store.remove(this.key);
    this.load();
    this.emit({ type: 'reset', snapshot: this.snapshot() });
  }
}
