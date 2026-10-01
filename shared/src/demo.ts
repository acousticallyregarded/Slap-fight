import Decimal from 'decimal.js';
import type { GameEngine } from './engine';
import type { PriceBook } from './priceBook';
import type { ChatCategory, RawChatMessage, RawSwap, Side } from './types';

/** Valid base58 placeholder so demo events pass the same mint validation as live ones. */
export const DEMO_MINT = 'DemoMint1111111111111111111111111111111111';
/** Simulated SOL/USD so demo trades exercise the real quote-conversion path. */
export const DEMO_SOL_USD = '200';

export const DEMO_CHAT_SAMPLES: Record<ChatCategory | 'filtered' | 'noMatch', { text: string; note: string }> = {
  greeting: { text: 'gm hi everyone', note: 'Greeting' },
  attention: { text: 'notice me pls', note: 'Attention' },
  compliment: { text: 'love your outfit, so pretty', note: 'Compliment' },
  flirt: { text: 'waifu material fr', note: 'Mild flirting' },
  boundary: { text: 'take it off lol', note: 'Boundary (moderated)' },
  buyCheer: { text: 'lets go buy!!', note: 'Buy cheer' },
  sellCheer: { text: 'go sell go', note: 'Sell cheer' },
  laughter: { text: 'lmaooo', note: 'Laughter' },
  sportsmanship: { text: 'gg good match', note: 'Good sportsmanship' },
  filtered: { text: 'kys', note: 'Severe (silently filtered)' },
  noMatch: { text: 'this chart looks thin', note: '“hi” inside a word: no reaction' },
};

const SIG_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function fakeSignature(): string {
  let s = 'demo';
  for (let i = 0; i < 84; i++) s += SIG_CHARS[Math.floor(Math.random() * SIG_CHARS.length)];
  return s;
}
function fakeWallet(): string {
  let s = '';
  for (let i = 0; i < 44; i++) s += SIG_CHARS[Math.floor(Math.random() * SIG_CHARS.length)];
  return s;
}

export type DemoLog = (line: string) => void;

/**
 * Generates simulated raw events and feeds them through the exact same engine
 * entry points live adapters use. It never touches engine state directly.
 */
export class DemoSimulator {
  private lastSwap: RawSwap | null = null;
  private offline = false;
  private missed: RawSwap[] = [];
  private delivered: RawSwap[] = [];
  private marketCap = new Decimal(12_500);
  private chatN = 0;
  private feedTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private engine: GameEngine,
    private prices: PriceBook,
    private log: DemoLog = () => {},
    private now: () => number = Date.now,
  ) {
    this.engine.setConnection('swaps', 'demo');
    this.engine.setConnection('marketCap', 'demo');
    this.engine.setConnection('chat', 'demo');
  }

  /** Keeps demo market-cap data fresh so staleness indicators behave like live. */
  startFeed(intervalMs = 10_000) {
    this.stopFeed();
    this.pushMarketCap();
    this.feedTimer = setInterval(() => !this.offline && this.pushMarketCap(), intervalMs);
  }
  stopFeed() {
    if (this.feedTimer) clearInterval(this.feedTimer);
    this.feedTimer = null;
  }

  private priceTick(at: number) {
    this.prices.add('SOL', { usd: DEMO_SOL_USD, at, source: 'demo' });
  }

  trade(side: Side, usd: string, opts: { quoteAsset?: string } = {}): RawSwap {
    const at = this.now();
    const quoteAsset = opts.quoteAsset ?? 'SOL';
    if (quoteAsset === 'SOL') this.priceTick(at);
    const quoteAmount = quoteAsset === 'SOL' ? new Decimal(usd).div(DEMO_SOL_USD).toString() : usd;
    const raw: RawSwap = {
      transactionSignature: fakeSignature(),
      swapIndex: 0,
      mint: DEMO_MINT,
      side,
      quoteAmount,
      quoteAsset,
      timestamp: at,
      confirmationStatus: 'confirmed',
      trader: fakeWallet(),
      source: 'demo',
    };
    this.deliver(raw);
    return raw;
  }

  private deliver(raw: RawSwap) {
    if (this.offline) {
      this.missed.push(raw);
      this.log(`Offline: ${raw.side} $${this.usdOf(raw)} happened on-chain but was not received yet.`);
      return;
    }
    const r = this.engine.ingestSwap(raw);
    this.delivered.push(raw);
    if (this.delivered.length > 50) this.delivered.shift();
    this.lastSwap = raw;
    this.log(`${raw.side.toUpperCase()} $${this.usdOf(raw)} (${raw.quoteAmount} ${raw.quoteAsset}) → ${describe(r.disposition)}`);
    if (raw.side === 'buy') this.nudgeMarketCap(this.usdOf(raw), 1);
    else this.nudgeMarketCap(this.usdOf(raw), -1);
  }

  private usdOf(raw: RawSwap) {
    return raw.quoteAsset === 'SOL' ? new Decimal(raw.quoteAmount).times(DEMO_SOL_USD).toFixed(2) : new Decimal(raw.quoteAmount).toFixed(2);
  }

  /** Trades move the simulated market cap slightly; milestone buttons set it directly. */
  private nudgeMarketCap(usd: string, dir: 1 | -1) {
    this.marketCap = Decimal.max(1000, this.marketCap.plus(new Decimal(usd).times(dir)));
  }

  duplicateLast() {
    if (!this.lastSwap) {
      this.log('No trade delivered yet: send one first.');
      return;
    }
    const r = this.engine.ingestSwap({ ...this.lastSwap });
    this.log(`Redelivered ${this.lastSwap.transactionSignature.slice(0, 12)}… → ${describe(r.disposition)}`);
  }

  rapidAlternating(count = 10, spacingMs = 160, onDone?: () => void) {
    let i = 0;
    const tick = () => {
      const side: Side = i % 2 === 0 ? 'buy' : 'sell';
      const usd = new Decimal(100 + Math.floor(Math.random() * 60000) / 100).toFixed(2);
      this.trade(side, usd);
      if (++i < count) setTimeout(tick, spacingMs);
      else onDone?.();
    };
    tick();
  }

  /** One side lands several slaps in a row (a combo). */
  comboRun(side: Side, count = 5, spacingMs = 220) {
    let i = 0;
    const tick = () => {
      this.trade(side, new Decimal(120 + Math.floor(Math.random() * 30000) / 100).toFixed(2));
      if (++i < count) setTimeout(tick, spacingMs);
    };
    tick();
  }

  /** A burst of team cheers in chat from different viewers. */
  cheerStorm(buy = 5, sell = 3) {
    const sides: ('buyCheer' | 'sellCheer')[] = [];
    for (let i = 0; i < Math.max(buy, sell); i++) {
      if (i < buy) sides.push('buyCheer');
      if (i < sell) sides.push('sellCheer');
    }
    sides.forEach((c, i) => setTimeout(() => this.chat(c, `fan${this.chatN + i * 13}`), i * 150));
  }

  pendingPrice() {
    // A quote asset with no verified price source: the trade must wait, not guess.
    const at = this.now();
    const raw: RawSwap = {
      transactionSignature: fakeSignature(),
      swapIndex: 0,
      mint: DEMO_MINT,
      side: 'buy',
      quoteAmount: '5000',
      quoteAsset: 'JUP',
      timestamp: at,
      confirmationStatus: 'confirmed',
      source: 'demo',
    };
    const r = this.engine.ingestSwap(raw);
    this.log(`BUY paid in JUP with no verified JUP/USD price → ${describe(r.disposition)}`);
  }

  confirmPendingPrice() {
    const pend = this.engine.pendingSwaps().filter((p) => p.reason === 'price');
    if (!pend.length) return this.log('Nothing is waiting on a price.');
    for (const p of pend) this.prices.add(p.raw.quoteAsset, { usd: '0.05', at: p.raw.timestamp, source: 'demo' });
    this.log(`Verified JUP/USD = $0.05 arrived; retrying ${pend.length} pending trade(s).`);
    this.engine.retryPendingPrices();
  }

  wrongMint() {
    const raw: RawSwap = {
      transactionSignature: fakeSignature(),
      swapIndex: 0,
      mint: 'So11111111111111111111111111111111111111112',
      side: 'buy',
      quoteAmount: '5',
      quoteAsset: 'SOL',
      timestamp: this.now(),
      confirmationStatus: 'confirmed',
      source: 'demo',
    };
    const r = this.engine.ingestSwap(raw);
    this.log(`$1,000 swap of an unrelated token → ${describe(r.disposition)}`);
  }

  goOffline() {
    if (this.offline) return;
    this.offline = true;
    this.engine.setConnection('swaps', 'disconnected');
    this.engine.setConnection('marketCap', 'disconnected');
    this.log('Connection lost. Trades during the outage will be backfilled from the reconnect cursor.');
  }

  recover() {
    if (!this.offline) return this.log('Already connected.');
    this.offline = false;
    this.engine.setConnection('swaps', 'connecting');
    this.engine.setConnection('marketCap', 'connecting');
    const cursor = this.engine.getCursor('demo-swaps');
    // A real backfill overlaps the cursor; redeliver the last seen trades too.
    const overlap = this.delivered.slice(-2);
    const batch = [...overlap, ...this.missed];
    this.missed = [];
    setTimeout(() => {
      this.log(`Reconnected. Backfilling ${batch.length} trade(s) from cursor ${cursor ? cursor.slice(0, 10) + '…' : '(start)'}; ${overlap.length} overlap(s) should be ignored.`);
      for (const raw of batch) {
        const r = this.engine.ingestSwap(raw);
        this.log(`  backfill ${raw.side} $${this.usdOf(raw)} → ${describe(r.disposition)}`);
        this.delivered.push(raw);
        this.lastSwap = raw;
      }
      if (this.lastSwap) this.engine.setCursor('demo-swaps', this.lastSwap.transactionSignature);
      this.engine.setConnection('swaps', 'demo');
      this.engine.setConnection('marketCap', 'demo');
      this.pushMarketCap();
    }, 900);
  }

  setMarketCap(usd: number, note?: string) {
    this.marketCap = new Decimal(usd);
    this.pushMarketCap();
    this.log(`Market cap → $${this.marketCap.toFixed(0)}${note ? ` (${note})` : ''}`);
  }

  /** Several samples over time, e.g. decline then recovery. */
  marketPath(values: number[], spacingMs = 1200, note?: string) {
    values.forEach((v, i) => setTimeout(() => this.setMarketCap(v, i === 0 ? note : undefined), i * spacingMs));
  }

  staleMarketData() {
    // Sample observed long ago: displayed as stale; unlocks suspended.
    this.engine.ingestMarketCap({ value: this.marketCap.toFixed(0), kind: 'circulating', source: 'demo', observedAt: this.now() - 10 * 60_000 });
    this.log('Market-cap source returned 10-minute-old data → stale; unlocks suspended until fresh data arrives.');
  }

  fdvOnly() {
    this.engine.ingestMarketCap({ value: this.marketCap.toFixed(0), kind: 'fdv', source: 'demo', observedAt: this.now() });
    this.log('Provider returned only FDV → shown labeled FDV; does not count toward unlocks.');
  }

  private pushMarketCap() {
    if (this.offline) return;
    this.engine.ingestMarketCap({ value: this.marketCap.toFixed(2), kind: 'circulating', source: 'demo', observedAt: this.now() });
  }

  chat(category: keyof typeof DEMO_CHAT_SAMPLES, sender?: string) {
    const sample = DEMO_CHAT_SAMPLES[category];
    const msg: RawChatMessage = {
      messageId: `demo-chat-${this.now()}-${this.chatN++}`,
      sender: sender ?? `viewer${(this.chatN * 7919) % 997}`,
      text: sample.text,
      timestamp: this.now(),
      source: 'demo',
    };
    const res = this.engine.ingestChat(msg);
    this.log(`Chat “${category === 'boundary' || category === 'filtered' ? '[hidden]' : sample.text}” → ${res}`);
    return msg;
  }

  duplicateChat() {
    const msg = this.chat('greeting');
    const res = this.engine.ingestChat(msg);
    this.log(`Same chat message ID delivered again → ${res}`);
  }

  senderCooldown() {
    this.chat('laughter', 'spammer');
    setTimeout(() => this.chat('greeting', 'spammer'), 400);
  }

  reset() {
    this.missed = [];
    this.delivered = [];
    this.lastSwap = null;
    this.offline = false;
    this.marketCap = new Decimal(12_500);
    this.engine.resetProgress();
    this.engine.setConnection('swaps', 'demo');
    this.engine.setConnection('marketCap', 'demo');
    this.engine.setConnection('chat', 'demo');
    this.pushMarketCap();
    this.log('Demo progress reset (live progress untouched).');
  }
}

function describe(d: string) {
  switch (d) {
    case 'slap':
      return 'SLAP';
    case 'below-threshold':
      return 'below $100, no slap';
    case 'duplicate':
      return 'duplicate ignored';
    case 'pending-price':
      return 'pending: waiting for a verified price';
    case 'pending-confirmation':
      return 'pending confirmation';
    case 'wrong-mint':
      return 'rejected: unrelated token';
    default:
      return d;
  }
}

export type DemoAction =
  | 'buy99' | 'buy100' | 'buy250' | 'sell100' | 'sell208' | 'rapid' | 'duplicate'
  | 'offline' | 'recover' | 'milestone' | 'jump' | 'declineRecover' | 'stale' | 'fdv'
  | 'pendingPrice' | 'confirmPrice' | 'wrongMint'
  | 'chat' | 'chatDuplicate' | 'senderCooldown' | 'reset'
  | 'whale' | 'combo' | 'cheers';

/** Single entry point used by the in-browser demo and the server's admin demo endpoint. */
export function runDemoAction(sim: DemoSimulator, action: DemoAction, arg?: string | number) {
  switch (action) {
    case 'buy99': return void sim.trade('buy', '99.99');
    case 'buy100': return void sim.trade('buy', '100');
    case 'buy250': return void sim.trade('buy', '250');
    case 'sell100': return void sim.trade('sell', '100');
    case 'sell208': return void sim.trade('sell', '208.75');
    case 'rapid': return sim.rapidAlternating(Number(arg) || 10);
    case 'duplicate': return sim.duplicateLast();
    case 'offline': return sim.goOffline();
    case 'recover': return sim.recover();
    case 'milestone': {
      const n = Math.max(1, Math.min(5, Number(arg) || 1));
      return sim.setMarketCap(n * 20_000 + 450, `milestone ${n}`);
    }
    case 'jump': return sim.setMarketCap(Number(arg) || 85_000, 'jump across several milestones');
    case 'declineRecover': return sim.marketPath([14_000, 9_500, 31_000, 47_500], 1400, 'decline below thresholds, then recover');
    case 'stale': return sim.staleMarketData();
    case 'fdv': return sim.fdvOnly();
    case 'pendingPrice': return sim.pendingPrice();
    case 'confirmPrice': return sim.confirmPendingPrice();
    case 'wrongMint': return sim.wrongMint();
    case 'chat': return void sim.chat((String(arg) || 'greeting') as keyof typeof DEMO_CHAT_SAMPLES);
    case 'chatDuplicate': return sim.duplicateChat();
    case 'senderCooldown': return sim.senderCooldown();
    case 'reset': return sim.reset();
    case 'whale': return void sim.trade(arg === 'sell' ? 'sell' : 'buy', arg === 'sell' ? '1850' : '2500');
    case 'combo': return sim.comboRun(arg === 'sell' ? 'sell' : 'buy', 5);
    case 'cheers': return sim.cheerStorm(arg === 'sell' ? 3 : 5, arg === 'sell' ? 5 : 3);
  }
}

export const DEMO_ACTIONS: DemoAction[] = [
  'buy99', 'buy100', 'buy250', 'sell100', 'sell208', 'rapid', 'duplicate', 'offline', 'recover', 'milestone', 'jump',
  'declineRecover', 'stale', 'fdv', 'pendingPrice', 'confirmPrice', 'wrongMint', 'chat', 'chatDuplicate', 'senderCooldown', 'reset',
  'whale', 'combo', 'cheers',
];
