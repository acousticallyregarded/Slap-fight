import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig, GameEngine, PriceBook, DEMO_MINT, type EngineStore, type PersistedState, type GameEvent, type RawSwap } from '../src';

const cfg = mergeConfig(DEFAULT_CONFIG, { token: { name: 'T', symbol: 'T', mint: DEMO_MINT } });
let t = Date.UTC(2026, 8, 30, 12);
const mem = (): EngineStore => {
  const data = new Map<string, PersistedState>();
  return { load: (k) => structuredClone(data.get(k) ?? null), save: (k, s) => data.set(k, structuredClone(s)), remove: (k) => data.delete(k) };
};
let n = 0;
const swap = (side: 'buy' | 'sell', usd: string): RawSwap => ({
  transactionSignature: `sig${n++}`, swapIndex: 0, mint: DEMO_MINT, side, quoteAmount: usd, quoteAsset: 'USDC',
  timestamp: t, confirmationStatus: 'confirmed', source: 'test',
});
const chat = (text: string, sender: string) => ({ messageId: `m${n++}`, sender, text, timestamp: t, source: 'test' });
function setup(store = mem()) {
  const engine = new GameEngine({ mode: 'live', config: () => cfg, prices: new PriceBook(), store, now: () => t });
  const events: GameEvent[] = [];
  engine.on((e) => events.push(e));
  return { engine, events, store };
}
const slaps = (ev: GameEvent[]) => ev.filter((e): e is Extract<GameEvent, { type: 'slap' }> => e.type === 'slap');

describe('show extras', () => {
  it('counts combos per side and reports the streak a slap breaks', () => {
    const { engine, events } = setup();
    for (let i = 0; i < 4; i++) engine.ingestSwap(swap('buy', '150'));
    engine.ingestSwap(swap('sell', '150'));
    engine.ingestSwap(swap('sell', '150'));
    expect(slaps(events).map((e) => [e.attacker, e.combo, e.broke])).toEqual([
      ['buy', 1, 0], ['buy', 2, 0], ['buy', 3, 0], ['buy', 4, 0], ['sell', 1, 4], ['sell', 2, 0],
    ]);
    expect(engine.snapshot().fun.streak).toEqual({ side: 'sell', count: 2 });
  });

  it('flags whale slaps and tracks the day’s biggest slap (the first one sets it quietly)', () => {
    const { engine, events } = setup();
    engine.ingestSwap(swap('buy', '300'));
    engine.ingestSwap(swap('sell', '250'));
    engine.ingestSwap(swap('sell', '1000'));
    expect(slaps(events).map((e) => [e.whale, e.record])).toEqual([[false, false], [false, false], [true, true]]);
    expect(engine.snapshot().fun.bestToday?.trade.usdValue).toBe('1000');
    t += 24 * 3600_000; // next UTC day
    expect(engine.snapshot().fun.bestToday).toBeNull();
  });

  it('fills the hype meter with recent qualifying volume and lets it cool down', () => {
    const { engine } = setup();
    engine.ingestSwap(swap('buy', '2500'));
    engine.ingestSwap(swap('buy', '50')); // below the slap threshold: no hype
    expect(engine.snapshot().fun.hype).toBeCloseTo(0.5);
    t += 6 * 60_000;
    expect(engine.snapshot().fun.hype).toBe(0);
  });

  it('tallies chat cheers per team, once per viewer per 10 s, even while reactions cool down', () => {
    const { engine } = setup();
    engine.ingestChat(chat('lets go buy!!', 'a'));
    engine.ingestChat(chat('go buy', 'a')); // same viewer again: not counted
    engine.ingestChat(chat('go buy', 'b')); // reaction is on cooldown, the cheer still counts
    engine.ingestChat(chat('go sell go', 'c'));
    engine.ingestChat(chat('kys go buy', 'd')); // severe: filtered, never counted
    expect(engine.snapshot().fun.cheers).toEqual({ buy: 2, sell: 1 });
    t += 3 * 60_000;
    expect(engine.snapshot().fun.cheers).toEqual({ buy: 0, sell: 0 });
  });

  it('keeps the streak and record across a restart', () => {
    const store = mem();
    const a = setup(store);
    a.engine.ingestSwap(swap('sell', '400'));
    a.engine.ingestSwap(swap('sell', '500'));
    const b = setup(store);
    expect(b.engine.snapshot().fun.streak).toEqual({ side: 'sell', count: 2 });
    expect(b.engine.snapshot().fun.bestToday?.trade.usdValue).toBe('500');
  });
});
