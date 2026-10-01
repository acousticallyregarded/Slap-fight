import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG, mergeConfig, GameEngine, PriceBook, classify, ChatPipeline, applySample, initialMilestoneState,
  type EngineStore, type PersistedState, type GameEvent, type RawSwap, DEMO_MINT,
} from '../src';

const MINT = DEMO_MINT;
const cfg = mergeConfig(DEFAULT_CONFIG, { token: { name: 'T', symbol: 'T', mint: MINT } });
const mem = (): EngineStore & { data: Map<string, PersistedState> } => {
  const data = new Map<string, PersistedState>();
  return { data, load: (k) => structuredClone(data.get(k) ?? null), save: (k, s) => data.set(k, structuredClone(s)), remove: (k) => data.delete(k) };
};
let t = 1_000_000;
const swap = (p: Partial<RawSwap>): RawSwap => ({
  transactionSignature: 'sig' + Math.random(), swapIndex: 0, mint: MINT, side: 'buy', quoteAmount: '100', quoteAsset: 'USDC',
  timestamp: t, confirmationStatus: 'confirmed', source: 'test', ...p,
});
function setup(c = cfg, store = mem(), mode: 'live' | 'demo' = 'live') {
  const prices = new PriceBook();
  const engine = new GameEngine({ mode, config: () => c, prices, store, now: () => t });
  const events: GameEvent[] = [];
  engine.on((e) => events.push(e));
  return { engine, events, prices, store };
}

describe('trades', () => {
  it('applies the inclusive $100 threshold with decimal math', () => {
    const { engine, events } = setup();
    expect(engine.ingestSwap(swap({ quoteAmount: '99.99' })).disposition).toBe('below-threshold');
    expect(engine.ingestSwap(swap({ quoteAmount: '100' })).disposition).toBe('slap');
    expect(engine.ingestSwap(swap({ quoteAmount: '99.999999999999999999' })).disposition).toBe('below-threshold');
    expect(events.filter((e) => e.type === 'slap')).toHaveLength(1);
  });
  it('converts SOL at a timestamp-appropriate price and waits when none is verified', () => {
    const { engine, prices } = setup();
    const s = swap({ quoteAsset: 'SOL', quoteAmount: '0.5' });
    expect(engine.ingestSwap(s).disposition).toBe('pending-price');
    prices.add('SOL', { usd: '100', at: t - 10 * 60_000, source: 'x' }); // too old
    engine.retryPendingPrices();
    expect(engine.snapshot().pendingPriceCount).toBe(1);
    prices.add('SOL', { usd: '200', at: t + 5_000, source: 'x' });
    engine.retryPendingPrices();
    expect(engine.snapshot().slaps.buy).toBe(1);
    expect(engine.snapshot().pendingPriceCount).toBe(0);
  });
  it('dedupes by signature + swap index and rejects other mints', () => {
    const { engine } = setup();
    const s = swap({ side: 'sell', quoteAmount: '208.75' });
    expect(engine.ingestSwap(s).disposition).toBe('slap');
    expect(engine.ingestSwap({ ...s }).disposition).toBe('duplicate');
    expect(engine.ingestSwap({ ...s, swapIndex: 1 }).disposition).toBe('slap');
    expect(engine.ingestSwap(swap({ mint: 'So11111111111111111111111111111111111111112' })).disposition).toBe('wrong-mint');
  });
  it('holds processed swaps until confirmed and corrects dropped ones', () => {
    const { engine, events } = setup();
    const s = swap({ confirmationStatus: 'processed' });
    expect(engine.ingestSwap(s).disposition).toBe('pending-confirmation');
    expect(engine.ingestSwap({ ...s, confirmationStatus: 'confirmed' }).disposition).toBe('slap');
    expect(engine.ingestSwap({ ...s, confirmationStatus: 'dropped' }).disposition).toBe('corrected');
    expect(engine.snapshot().slaps.buy).toBe(0);
    expect(engine.ingestSwap({ ...s, confirmationStatus: 'dropped' }).disposition).toBe('duplicate');
    expect(events.some((e) => e.type === 'correction')).toBe(true);
  });
  it('survives restarts without replaying (idempotency persisted)', () => {
    const store = mem();
    const a = setup(cfg, store);
    const s = swap({});
    a.engine.ingestSwap(s);
    const b = setup(cfg, store);
    expect(b.engine.ingestSwap({ ...s }).disposition).toBe('duplicate');
    expect(b.engine.snapshot().slaps.buy).toBe(1);
  });
});

describe('milestones', () => {
  const c1 = mergeConfig(cfg, { milestones: { ...cfg.milestones, confirmSamples: 1, confirmDurationMs: 0 } });
  const mc = (v: number, extra: object = {}) => ({ value: String(v), kind: 'circulating' as const, source: 't', observedAt: t, ...extra });
  it('unlocks each stage in sequence on a jump and never relocks or replays', () => {
    const { engine, events } = setup(c1);
    engine.ingestMarketCap(mc(85_000));
    const unl = events.filter((e) => e.type === 'outfitUnlock');
    expect(unl.map((e: any) => e.stage)).toEqual([1, 2, 3, 4]);
    engine.ingestMarketCap(mc(10_000));
    expect(engine.snapshot().unlockedStage).toBe(4);
    engine.ingestMarketCap(mc(90_000));
    expect(events.filter((e) => e.type === 'outfitUnlock')).toHaveLength(4);
    engine.ingestMarketCap(mc(250_000));
    const last = events.filter((e) => e.type === 'outfitUnlock').at(-1) as any;
    expect(last.stage).toBe(5); expect(last.final).toBe(true);
    engine.ingestMarketCap(mc(900_000));
    expect(events.filter((e) => e.type === 'outfitUnlock')).toHaveLength(5);
  });
  it('celebrates instead of slapping once the final milestone is unlocked', () => {
    const { engine, events } = setup(c1);
    engine.ingestSwap(swap({ side: 'sell' }));
    engine.ingestMarketCap(mc(120_000));
    expect(engine.snapshot().unlockedStage).toBe(5);
    expect(engine.ingestSwap(swap({ side: 'buy', quoteAmount: '250' })).disposition).toBe('slap');
    const party = events.filter((e) => e.type === 'celebrate') as any[];
    expect(party).toHaveLength(1);
    expect(party[0].side).toBe('buy');
    expect(events.filter((e) => e.type === 'slap')).toHaveLength(1);
    expect(engine.snapshot().slaps).toEqual({ buy: 0, sell: 1 });
    expect(engine.snapshot().recentTrades[0].usdValue).toBe('250');
  });
  it('requires confirmation and ignores stale, invalid and FDV data', () => {
    const st = initialMilestoneState();
    const c = cfg; // 2 samples over 15s
    expect(applySample(c, st, mc(45_000), t).unlocked).toEqual([]);
    expect(applySample(c, st, mc(45_000, { observedAt: t + 16_000 }), t + 16_000).unlocked.map((u) => u.stage)).toEqual([1, 2]);
    const st2 = initialMilestoneState();
    applySample(c, st2, mc(45_000), t);
    expect(applySample(c, st2, mc(45_000, { observedAt: t - 100_000 }), t + 16_000).market.stale).toBe(true);
    expect(applySample(c, st2, mc(45_000, { observedAt: t + 30_000 }), t + 30_000).unlocked).toEqual([]); // run was reset
    const st3 = initialMilestoneState();
    const r = applySample(c1, st3, mc(45_000, { kind: 'fdv' }), t);
    expect(r.unlocked).toEqual([]); expect(r.market.invalidReason).toMatch(/FDV/);
    expect(applySample(c1, st3, mc(Number.NaN), t).unlocked).toEqual([]);
  });
  it('keeps demo and live progress separate', () => {
    const store = mem();
    const live = setup(c1, store, 'live');
    const demo = setup(c1, store, 'demo');
    live.engine.ingestMarketCap(mc(45_000));
    demo.engine.ingestMarketCap(mc(100_000));
    demo.engine.resetProgress();
    expect(demo.engine.snapshot().unlockedStage).toBe(0);
    expect(setup(c1, store, 'live').engine.snapshot().unlockedStage).toBe(2);
    expect(() => live.engine.resetProgress()).toThrow();
  });
});

describe('chat', () => {
  const cat = (s: string) => { const c = classify(s); return c.kind === 'reaction' ? c.category : c.kind; };
  it('matches whole words and phrases', () => {
    expect(cat('hi')).toBe('greeting');
    expect(cat('this is thin')).toBe('none');
    expect(cat('high')).toBe('greeting');
    expect(cat('high sell')).toBe('greeting');
    expect(cat('market cap going high')).toBe('none');
    expect(cat('Hiiii!!')).toBe('greeting');
    expect(cat('gm')).toBe('greeting');
    expect(cat('notice me')).toBe('attention');
    expect(cat('love your outfit')).toBe('compliment');
    expect(cat("you're gorgeous")).toBe('flirt');
    expect(cat('marry me')).toBe('flirt');
    expect(cat('lets go buy')).toBe('buyCheer');
    expect(cat('sell team')).toBe('sellCheer');
    expect(cat('hahaha')).toBe('laughter');
    expect(cat('gg')).toBe('sportsmanship');
    expect(cat('ggggg')).toBe('sportsmanship');
    expect(cat('cute but take it off')).toBe('boundary');
    expect(cat('waifu show me nudes')).toBe('boundary');
    expect(cat('kys')).toBe('severe');
    expect(cat('<script>alert(1)</script> hi')).toBe('greeting');
  });
  it('applies cooldowns, targets, dedupe and staleness', () => {
    let now = 0;
    const p = new ChatPipeline(() => cfg);
    const m = (id: string, text: string, sender = id, ts = now) => p.process({ messageId: id, sender, text, timestamp: ts, source: 't' }, now);
    const a = m('1', 'hi sell'); expect(a.result).toBe('reaction'); expect((a as any).reaction.target).toBe('sell');
    expect(m('1', 'hi sell').result).toBe('duplicate');
    const b = m('2', 'hello'); expect((b as any).reaction.target).toBe('buy');
    expect(m('3', 'hey').result).toBe('cooldown'); // both characters cooling
    now = 9000;
    expect(m('4', 'hey', '1').result).toBe('cooldown'); // sender 1 still cooling (20s)
    expect(m('5', 'gg').result).toBe('reaction');
    now = 30_000;
    expect(m('6', 'hi', 'x', 20_000).result).toBe('stale');
    const boundary = m('7', 'nudes pls');
    expect((boundary as any).reaction.displayText).toBeNull();
    expect(m('8', 'kys').result).toBe('filtered');
  });
});
