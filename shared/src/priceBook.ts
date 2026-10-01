import type { PriceLookup, QuotePrice } from './tradePipeline';

/**
 * Time-indexed quote prices (e.g. SOL/USD). Filled by live polling and by
 * historical lookups; answers with the sample nearest to the trade time.
 * The pipeline rejects samples outside its tolerance, so a stale price is
 * never used for an old trade.
 */
export class PriceBook implements PriceLookup {
  private samples = new Map<string, QuotePrice[]>();

  constructor(private maxPerAsset = 5000) {}

  add(asset: string, p: QuotePrice) {
    const key = asset.toUpperCase();
    const arr = this.samples.get(key) ?? [];
    // Keep sorted by time.
    let i = arr.length;
    while (i > 0 && arr[i - 1].at > p.at) i--;
    if (arr[i - 1]?.at === p.at) arr[i - 1] = p;
    else arr.splice(i, 0, p);
    if (arr.length > this.maxPerAsset) arr.splice(0, arr.length - this.maxPerAsset);
    this.samples.set(key, arr);
  }

  priceAt(asset: string, timestamp: number): QuotePrice | null {
    const arr = this.samples.get(asset.toUpperCase());
    if (!arr || arr.length === 0) return null;
    let best: QuotePrice | null = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const d = Math.abs(arr[i].at - timestamp);
      if (!best || d < Math.abs(best.at - timestamp)) best = arr[i];
      if (arr[i].at <= timestamp) break; // older samples are only further away
    }
    return best;
  }

  clear() {
    this.samples.clear();
  }
}
