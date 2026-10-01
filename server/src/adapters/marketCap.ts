import Decimal from 'decimal.js';
import type { MarketCapSample } from '@bvs/shared';

// Birdeye token overview: https://data.birdeye.so/docs/data-api/stats/get-defi-token-overview.md
// GET https://public-api.birdeye.so/defi/token_overview?address=<mint>, headers X-API-KEY, x-chain: solana.
// `marketCap` is "based on circulating supply and latest price"; `fdv` is
// "based on total supply and latest price".
//
// Market-cap definition used by the game, in order of preference:
//   1. Supplied `marketCap` (circulating) when positive.
//   2. `price` × `circulatingSupply` when both are positive.
//   3. Otherwise `fdv`, labeled FDV everywhere; it does not unlock outfits
//      unless the admin explicitly allows it.

export interface BirdeyeOverview {
  price?: number;
  marketCap?: number;
  fdv?: number;
  circulatingSupply?: number;
}

export function toSample(d: BirdeyeOverview, now: number): MarketCapSample | null {
  const pos = (n?: number) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (pos(d.marketCap)) return { value: String(d.marketCap), kind: 'circulating', source: 'birdeye:marketCap', observedAt: now };
  if (pos(d.price) && pos(d.circulatingSupply)) {
    return { value: new Decimal(d.price!).times(d.circulatingSupply!).toString(), kind: 'circulating', source: 'birdeye:price×circulatingSupply', observedAt: now };
  }
  if (pos(d.fdv)) return { value: String(d.fdv), kind: 'fdv', source: 'birdeye:fdv', observedAt: now };
  return null;
}

export async function fetchBirdeyeMarketCap(mint: string, apiKey: string): Promise<MarketCapSample | null> {
  const u = new URL('https://public-api.birdeye.so/defi/token_overview');
  u.searchParams.set('address', mint);
  const res = await fetch(u, { headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana' } });
  if (!res.ok) throw new Error(`Birdeye HTTP ${res.status}`);
  const body = (await res.json()) as { success?: boolean; data?: BirdeyeOverview };
  if (!body.data) throw new Error('Birdeye returned no data');
  return toSample(body.data, Date.now());
}

// DexScreener (free, no key): https://docs.dexscreener.com/api/reference
// GET https://api.dexscreener.com/tokens/v1/{chainId}/{tokenAddresses} returns
// the token's pairs, each with `marketCap` and `fdv` in USD; 60 requests a
// minute. It gives totals only, never individual trades. We use the pair
// with the most liquidity where the token is the base token.

export interface DexPair {
  baseToken?: { address?: string };
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  dexId?: string;
}

export function dexScreenerSample(pairs: DexPair[], mint: string, now: number): MarketCapSample | null {
  const own = (Array.isArray(pairs) ? pairs : []).filter((p) => p?.baseToken?.address === mint);
  own.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const p = own[0];
  if (!p) return null;
  const pos = (n?: number) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const src = `dexscreener:${p.dexId ?? 'pair'}`;
  if (pos(p.marketCap)) return { value: String(p.marketCap), kind: 'circulating', source: src, observedAt: now };
  if (pos(p.fdv)) return { value: String(p.fdv), kind: 'fdv', source: src, observedAt: now };
  return null;
}

export async function fetchDexScreenerMarketCap(mint: string): Promise<MarketCapSample | null> {
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' } });
  if (res.status === 429) throw new Error('DexScreener rate limit (60 a minute); raise the poll interval');
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  return dexScreenerSample((await res.json()) as DexPair[], mint, Date.now());
}
