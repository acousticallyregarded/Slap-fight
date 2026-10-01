import Decimal from 'decimal.js';
import type { RawSwap } from '@bvs/shared';
import type { AdapterStatus } from './status';

// Sources (checked 2026-09-30):
//  - Enhanced transactions + events.swap: https://www.helius.dev/docs/api-reference/enhanced-transactions/llms.txt
//  - Transaction history by address (before-signature / after-signature, type, commitment):
//    https://www.helius.dev/docs/enhanced-transactions/transaction-history
//  - Webhooks (webhookType 'enhanced', transactionTypes, accountAddresses, authHeader echoed in Authorization):
//    https://www.helius.dev/docs/api-reference/webhooks/create-webhook
// Helius marks Enhanced Transactions as maintenance mode; it still works but
// gets no new parsers. pump.fun bonding-curve trades may not be typed SWAP;
// verify against real signatures before launch (docs/INTEGRATIONS.md).

export const WSOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufLSZ6vYdtT5nViU2L3F2XeTKXZt1DCyrmv';
export const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const QUOTE_MINTS: Record<string, string> = { [WSOL]: 'SOL', [USDC]: 'USDC', [USDT]: 'USDT' };

interface TokenLeg {
  userAccount?: string;
  tokenAccount?: string;
  mint: string;
  rawTokenAmount: { tokenAmount: string; decimals: number };
}
interface NativeLeg {
  account: string;
  amount: string; // lamports
}
export interface HeliusEnhancedTx {
  signature: string;
  type?: string;
  timestamp: number; // unix seconds
  feePayer: string;
  transactionError?: unknown;
  events?: {
    swap?: {
      nativeInput?: NativeLeg | null;
      nativeOutput?: NativeLeg | null;
      tokenInputs?: TokenLeg[];
      tokenOutputs?: TokenLeg[];
      innerSwaps?: unknown[];
    };
  };
}

const amount = (l: TokenLeg) => new Decimal(l.rawTokenAmount.tokenAmount).div(new Decimal(10).pow(l.rawTokenAmount.decimals));
const lamportsToSol = (n: NativeLeg) => new Decimal(n.amount).div(1e9);

export type ParseResult = { swap: RawSwap } | { skip: string };

/**
 * Converts one enhanced transaction into at most one logical swap for `mint`.
 * Uses the aggregated `events.swap` (not innerSwaps), so routed swaps and
 * individual pool legs are never counted twice. Direction is from the fee
 * payer's (trader's) perspective. Amounts are swap legs only: network fees and
 * rent are not part of them.
 */
export function parseEnhancedTx(tx: HeliusEnhancedTx, mint: string): ParseResult {
  if (!tx?.signature) return { skip: 'no signature' };
  if (tx.transactionError) return { skip: 'failed transaction' };
  const sw = tx.events?.swap;
  if (!sw) return { skip: `no swap event (type ${tx.type ?? 'unknown'})` };
  const trader = tx.feePayer;
  const ins = (sw.tokenInputs ?? []).filter((l) => !l.userAccount || l.userAccount === trader);
  const outs = (sw.tokenOutputs ?? []).filter((l) => !l.userAccount || l.userAccount === trader);
  const tokenIn = ins.find((l) => l.mint === mint); // trader gives the token => sell
  const tokenOut = outs.find((l) => l.mint === mint); // trader receives the token => buy
  if (!tokenIn && !tokenOut) return { skip: 'swap does not involve the configured mint' };
  if (tokenIn && tokenOut) return { skip: 'token on both sides (not a buy or sell)' };

  const side = tokenOut ? 'buy' : 'sell';
  let quoteAmount: Decimal | null = null;
  let quoteAsset = '';
  if (side === 'buy') {
    if (sw.nativeInput && sw.nativeInput.account === trader) (quoteAmount = lamportsToSol(sw.nativeInput)), (quoteAsset = 'SOL');
    else {
      const q = ins.find((l) => QUOTE_MINTS[l.mint]);
      if (q) (quoteAmount = amount(q)), (quoteAsset = QUOTE_MINTS[q.mint]);
    }
  } else {
    if (sw.nativeOutput && sw.nativeOutput.account === trader) (quoteAmount = lamportsToSol(sw.nativeOutput)), (quoteAsset = 'SOL');
    else {
      const q = outs.find((l) => QUOTE_MINTS[l.mint]);
      if (q) (quoteAmount = amount(q)), (quoteAsset = QUOTE_MINTS[q.mint]);
    }
  }
  if (!quoteAmount) return { skip: 'no supported quote asset leg (SOL/USDC/USDT)' };
  return {
    swap: {
      transactionSignature: tx.signature,
      swapIndex: 0, // one logical swap per transaction for this mint
      mint,
      side,
      quoteAmount: quoteAmount.toString(),
      quoteAsset,
      timestamp: tx.timestamp * 1000,
      // Unknown until the RPC confirmation check runs.
      confirmationStatus: 'processed',
      trader,
      source: 'helius',
    },
  };
}

/** Pages forward through Helius history from a cursor (for gaps and restarts). */
export async function backfill(opts: {
  apiKey: string;
  baseUrl: string;
  address: string;
  afterSignature?: string;
  onTx: (tx: HeliusEnhancedTx) => void;
  status: AdapterStatus;
  maxPages?: number;
}): Promise<string | undefined> {
  let cursor = opts.afterSignature;
  for (let page = 0; page < (opts.maxPages ?? 10); page++) {
    const u = new URL(`${opts.baseUrl}/v0/addresses/${opts.address}/transactions`);
    u.searchParams.set('api-key', opts.apiKey);
    u.searchParams.set('type', 'SWAP');
    u.searchParams.set('commitment', 'confirmed');
    u.searchParams.set('sort-order', 'asc');
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('after-signature', cursor);
    const res = await fetch(u);
    if (!res.ok) {
      opts.status.set('error', `history HTTP ${res.status}`);
      return cursor;
    }
    const txs = (await res.json()) as HeliusEnhancedTx[];
    for (const tx of txs) {
      opts.onTx(tx);
      cursor = tx.signature;
    }
    if (txs.length < 100) break;
  }
  return cursor;
}
