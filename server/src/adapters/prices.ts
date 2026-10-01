import Decimal from 'decimal.js';
import type { PriceBook, QuotePrice } from '@bvs/shared';
import { WSOL } from './helius';

// Quote-asset (SOL/USD) pricing at the trade's timestamp.
//  - Pyth Benchmarks (official historical): https://docs.pyth.network/price-feeds/core/use-historical-price-data
//    GET https://benchmarks.pyth.network/v1/updates/price/{unix_ts}?ids=<feed id>&parsed=true, Bearer key.
//  - Birdeye: GET https://public-api.birdeye.so/defi/historical_price_unix?address=<wSOL>&unixtime=<s>
//    headers X-API-KEY, x-chain: solana. https://data.birdeye.so/docs/data-api/price-ohlcv/get-defi-historical-price-unix.md
//  - Jupiter Price API v3 (live only, no history): GET https://api.jup.ag/price/v3?ids=<mint>, header x-api-key.
//    https://developers.jup.ag/docs/price.md
// A price that cannot be fetched or parsed leaves the trade pending.

export type PriceProvider = 'pyth' | 'birdeye' | 'jupiter-live';

export async function historicalSolUsd(
  provider: PriceProvider,
  tsMs: number,
  keys: { pythApiKey: string; pythFeedId: string; birdeyeApiKey: string },
): Promise<QuotePrice | null> {
  const unix = Math.floor(tsMs / 1000);
  if (provider === 'pyth') {
    if (!keys.pythApiKey || !keys.pythFeedId) return null;
    const u = new URL(`https://benchmarks.pyth.network/v1/updates/price/${unix}`);
    u.searchParams.set('ids', keys.pythFeedId);
    u.searchParams.set('parsed', 'true');
    const res = await fetch(u, { headers: { Authorization: `Bearer ${keys.pythApiKey}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { parsed?: { price: { price: string; expo: number; publish_time: number } }[] };
    const p = body.parsed?.[0]?.price;
    if (!p) return null;
    const usd = new Decimal(p.price).times(new Decimal(10).pow(p.expo));
    return { usd: usd.toString(), at: p.publish_time * 1000, source: 'pyth-benchmarks' };
  }
  if (provider === 'birdeye') {
    if (!keys.birdeyeApiKey) return null;
    const u = new URL('https://public-api.birdeye.so/defi/historical_price_unix');
    u.searchParams.set('address', WSOL);
    u.searchParams.set('unixtime', String(unix));
    const res = await fetch(u, { headers: { 'X-API-KEY': keys.birdeyeApiKey, 'x-chain': 'solana' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { value?: number; updateUnixTime?: number } };
    if (!body.data?.value || !body.data.updateUnixTime) return null;
    return { usd: String(body.data.value), at: body.data.updateUnixTime * 1000, source: 'birdeye-historical' };
  }
  return null; // jupiter-live has no history; live samples are recorded by pollJupiter
}

/** Records live SOL/USD samples so recent trades can be priced without a history call. */
export function pollJupiter(book: PriceBook, apiKey: string, onSample: () => void, onError: (e: string) => void, everyMs = 15_000) {
  const tick = async () => {
    try {
      const res = await fetch(`https://api.jup.ag/price/v3?ids=${WSOL}`, { headers: apiKey ? { 'x-api-key': apiKey } : {} });
      if (!res.ok) return onError(`Jupiter HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, { usdPrice?: number }>;
      const px = body[WSOL]?.usdPrice;
      if (!px || !(px > 0)) return onError('Jupiter returned no SOL price');
      book.add('SOL', { usd: String(px), at: Date.now(), source: 'jupiter-v3' });
      onSample();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  void tick();
  const t = setInterval(tick, everyMs);
  return () => clearInterval(t);
}
