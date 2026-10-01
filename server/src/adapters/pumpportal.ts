import WebSocket from 'ws';
import Decimal from 'decimal.js';
import type { RawSwap } from '@bvs/shared';
import type { AdapterStatus } from './status';

// THIRD-PARTY (not pump.fun): https://pumpportal.fun/data-api/real-time
// wss://pumpportal.fun/api/data?api-key=KEY, send {"method":"subscribeTokenTrade","keys":[mint]}.
// Documented trade fields: signature, mint, traderPublicKey, txType, tokenAmount,
// solAmount, marketCapSol, vSolInBondingCurve. Requires an API key with a
// funded linked wallet and is billed per event. Messages carry no commitment
// level, so every swap is confirmed through the Solana RPC before it can slap.
// Whether solAmount includes pump.fun's protocol fee is not documented; see
// docs/INTEGRATIONS.md.

interface PumpPortalTrade {
  signature?: string;
  mint?: string;
  traderPublicKey?: string;
  txType?: string;
  solAmount?: number | string;
  /** The token's market cap in SOL after this trade, as pump.fun computes it. */
  marketCapSol?: number | string;
}

/** Market cap in SOL carried by a trade message for `mint`, or null. */
export function parseMarketCapSol(msg: PumpPortalTrade, mint: string): Decimal | null {
  if (!msg || msg.mint !== mint || msg.marketCapSol === undefined) return null;
  try {
    const v = new Decimal(String(msg.marketCapSol));
    return v.isFinite() && v.gt(0) ? v : null;
  } catch {
    return null;
  }
}

export function parsePumpPortal(msg: PumpPortalTrade, mint: string): RawSwap | null {
  if (!msg?.signature || msg.mint !== mint) return null;
  if (msg.txType !== 'buy' && msg.txType !== 'sell') return null; // e.g. 'create'
  if (msg.solAmount === undefined) return null;
  let sol: Decimal;
  try {
    sol = new Decimal(String(msg.solAmount));
  } catch {
    return null;
  }
  return {
    transactionSignature: msg.signature,
    swapIndex: 0,
    mint,
    side: msg.txType,
    quoteAmount: sol.toString(),
    quoteAsset: 'SOL',
    timestamp: Date.now(), // stream has no block time; price lookup uses receipt time
    confirmationStatus: 'processed',
    trader: msg.traderPublicKey,
    source: 'pumpportal',
  };
}

export function connectPumpPortal(opts: {
  apiKey: string;
  mint: string;
  status: AdapterStatus;
  onSwap: (s: RawSwap) => void;
  onMarketCapSol?: (sol: Decimal) => void;
}) {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 1000;
  const open = () => {
    opts.status.set('connecting', 'PumpPortal (third-party) trade stream');
    ws = new WebSocket(`wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(opts.apiKey)}`);
    ws.on('open', () => {
      retry = 1000;
      ws!.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [opts.mint] }));
      opts.status.set('connected', 'PumpPortal (third-party); swaps confirmed via RPC');
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        const s = parsePumpPortal(msg, opts.mint);
        if (s) opts.onSwap(s);
        const mc = parseMarketCapSol(msg, opts.mint);
        if (mc) opts.onMarketCapSol?.(mc);
      } catch {
        /* ignore non-JSON frames */
      }
    });
    ws.on('close', () => {
      if (closed) return;
      opts.status.set('error', 'disconnected; reconnecting');
      setTimeout(open, (retry = Math.min(retry * 2, 30_000)));
    });
    ws.on('error', () => ws?.close());
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
