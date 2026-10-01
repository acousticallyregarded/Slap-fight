import WebSocket from 'ws';
import Decimal from 'decimal.js';
import type { RawSwap } from '@bvs/shared';
import type { AdapterStatus } from './status';

// pump.fun trades read straight from the Solana chain (free with a Helius or
// any other Solana RPC account; no third-party trade feed).
//
// pump.fun publishes its programs' interfaces (IDL) at
// https://github.com/pump-fun/pump-public-docs (idl/pump.json, idl/pump_amm.json):
//   - bonding curve  6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P  emits TradeEvent
//   - PumpSwap AMM   pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA  emits BuyEvent / SellEvent
// Events are Anchor events: 8-byte discriminator + Borsh fields. They appear
// in the transaction logs as "Program data: <base64>" and, because the
// programs use #[event_cpi], as a self-CPI inner instruction whose data is
// EVENT_IX_TAG + discriminator + fields. We read the logs first and fetch the
// transaction only when the logs were truncated or held no event.
//
// Standard Solana RPC (https://solana.com/docs/rpc/websocket/logssubscribe):
// logsSubscribe {mentions:[mint]} at `confirmed` commitment notifies every
// successful or failed transaction that references the mint account.
//
// Amounts, fees excluded (the game's rule):
//   curve buy/sell: sol_amount (SOL moved into or out of the curve, before fees)
//   AMM buy: quote_amount_in; AMM sell: quote_amount_out (pool side, before fees)
// Market cap, the way pump.fun shows it (price × total supply):
//   curve: virtual_sol_reserves / virtual_token_reserves × 1,000,000,000 tokens
//   AMM: (pool quote + virtual quote) / pool base × base_supply

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL = 'So11111111111111111111111111111111111111112';
const DEFAULT_PUBKEY = '11111111111111111111111111111111';
/** Stablecoins that count 1:1 as dollars (6 decimals). */
const STABLE: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};
/** pump.fun tokens have 6 decimals and a fixed total supply of 1 billion. */
const TOKEN_DECIMALS = 6;
const PUMP_TOTAL_SUPPLY = new Decimal(1_000_000_000);

const DISC = {
  trade: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  buy: Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]),
  sell: Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]),
};
/** Anchor's event-CPI instruction tag (sha256("anchor:event")[..8]). */
const EVENT_IX_TAG = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

// ---------------------------------------------------------------- base58

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58encode(buf: Uint8Array): string {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

export function b58decode(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------- Borsh

type FieldType = 'pubkey' | 'u64' | 'i64' | 'i128' | 'bool' | 'u16' | 'string' | 'shareholders';
type Spec = [string, FieldType][];

// Field order copied from pump-public-docs/idl. New fields are appended over
// time and older transactions carry fewer, so decoding stops cleanly at the
// end of the data and later fields are simply absent.
const TRADE_EVENT: Spec = [
  ['mint', 'pubkey'], ['sol_amount', 'u64'], ['token_amount', 'u64'], ['is_buy', 'bool'], ['user', 'pubkey'], ['timestamp', 'i64'],
  ['virtual_sol_reserves', 'u64'], ['virtual_token_reserves', 'u64'], ['real_sol_reserves', 'u64'], ['real_token_reserves', 'u64'],
  ['fee_recipient', 'pubkey'], ['fee_basis_points', 'u64'], ['fee', 'u64'], ['creator', 'pubkey'], ['creator_fee_basis_points', 'u64'],
  ['creator_fee', 'u64'], ['track_volume', 'bool'], ['total_unclaimed_tokens', 'u64'], ['total_claimed_tokens', 'u64'],
  ['current_sol_volume', 'u64'], ['last_update_timestamp', 'i64'], ['ix_name', 'string'], ['mayhem_mode', 'bool'],
  ['cashback_fee_basis_points', 'u64'], ['cashback', 'u64'], ['buyback_fee_basis_points', 'u64'], ['buyback_fee', 'u64'],
  ['shareholders', 'shareholders'], ['quote_mint', 'pubkey'], ['quote_amount', 'u64'], ['virtual_quote_reserves', 'u64'],
  ['real_quote_reserves', 'u64'],
];
const AMM_HEAD: Spec = [
  ['timestamp', 'i64'], ['base_amount', 'u64'], ['limit_quote_amount', 'u64'], ['user_base_token_reserves', 'u64'],
  ['user_quote_token_reserves', 'u64'], ['pool_base_token_reserves', 'u64'], ['pool_quote_token_reserves', 'u64'],
  ['quote_amount', 'u64'], ['lp_fee_basis_points', 'u64'], ['lp_fee', 'u64'], ['protocol_fee_basis_points', 'u64'],
  ['protocol_fee', 'u64'], ['quote_amount_with_lp_fee', 'u64'], ['user_quote_amount', 'u64'], ['pool', 'pubkey'], ['user', 'pubkey'],
  ['user_base_token_account', 'pubkey'], ['user_quote_token_account', 'pubkey'], ['protocol_fee_recipient', 'pubkey'],
  ['protocol_fee_recipient_token_account', 'pubkey'], ['coin_creator', 'pubkey'], ['coin_creator_fee_basis_points', 'u64'],
  ['coin_creator_fee', 'u64'],
];
const AMM_TAIL: Spec = [
  ['cashback_fee_basis_points', 'u64'], ['cashback', 'u64'], ['buyback_fee_basis_points', 'u64'], ['buyback_fee', 'u64'],
  ['virtual_quote_reserves', 'i128'], ['can_boost', 'bool'], ['base_supply', 'u64'],
];
const BUY_EVENT: Spec = [
  ...AMM_HEAD, ['track_volume', 'bool'], ['total_unclaimed_tokens', 'u64'], ['total_claimed_tokens', 'u64'],
  ['current_sol_volume', 'u64'], ['last_update_timestamp', 'i64'], ['min_base_amount_out', 'u64'], ['ix_name', 'string'], ...AMM_TAIL,
];
const SELL_EVENT: Spec = [...AMM_HEAD, ...AMM_TAIL];

export type Fields = Record<string, string | bigint | boolean>;

/** Decodes Borsh fields in order until the data runs out. */
export function decodeFields(data: Buffer, spec: Spec): Fields {
  const out: Fields = {};
  let o = 0;
  const need = (n: number) => o + n <= data.length;
  for (const [name, t] of spec) {
    if (t === 'pubkey') {
      if (!need(32)) break;
      out[name] = b58encode(data.subarray(o, o + 32));
      o += 32;
    } else if (t === 'u64' || t === 'i64') {
      if (!need(8)) break;
      out[name] = t === 'u64' ? data.readBigUInt64LE(o) : data.readBigInt64LE(o);
      o += 8;
    } else if (t === 'i128') {
      if (!need(16)) break;
      out[name] = data.readBigUInt64LE(o) + (data.readBigInt64LE(o + 8) << 64n);
      o += 16;
    } else if (t === 'u16') {
      if (!need(2)) break;
      out[name] = BigInt(data.readUInt16LE(o));
      o += 2;
    } else if (t === 'bool') {
      if (!need(1)) break;
      out[name] = data[o] !== 0;
      o += 1;
    } else if (t === 'string') {
      if (!need(4)) break;
      const n = data.readUInt32LE(o);
      if (!need(4 + n)) break;
      out[name] = data.subarray(o + 4, o + 4 + n).toString('utf8');
      o += 4 + n;
    } else if (t === 'shareholders') {
      if (!need(4)) break;
      const n = data.readUInt32LE(o);
      if (!need(4 + n * 34)) break;
      o += 4 + n * 34; // {address: pubkey, share_bps: u16} each; not needed here
    }
  }
  return out;
}

// ---------------------------------------------------------------- events

export type PumpEvent =
  | { kind: 'curve'; f: Fields }
  | { kind: 'amm-buy' | 'amm-sell'; f: Fields };

/** An event from its raw bytes (discriminator first), or null if it is not a trade event. */
export function decodeEvent(data: Buffer): PumpEvent | null {
  if (data.length < 8) return null;
  const d = data.subarray(0, 8);
  const body = data.subarray(8);
  if (d.equals(DISC.trade)) return { kind: 'curve', f: decodeFields(body, TRADE_EVENT) };
  if (d.equals(DISC.buy)) return { kind: 'amm-buy', f: decodeFields(body, BUY_EVENT) };
  if (d.equals(DISC.sell)) return { kind: 'amm-sell', f: decodeFields(body, SELL_EVENT) };
  return null;
}

/** Trade events in a transaction's log lines, in order. `truncated` when the node cut the log short. */
export function eventsFromLogs(logs: string[]): { events: PumpEvent[]; truncated: boolean; pumpInvoked: boolean } {
  const events: PumpEvent[] = [];
  let truncated = false;
  let pumpInvoked = false;
  for (const l of logs ?? []) {
    if (l === 'Log truncated') truncated = true;
    if (l.startsWith(`Program ${PUMP_PROGRAM} invoke`) || l.startsWith(`Program ${PUMP_AMM_PROGRAM} invoke`)) pumpInvoked = true;
    if (!l.startsWith('Program data: ')) continue;
    try {
      const e = decodeEvent(Buffer.from(l.slice(14), 'base64'));
      if (e) events.push(e);
    } catch {
      /* not an event we know */
    }
  }
  return { events, truncated, pumpInvoked };
}

interface RpcTx {
  meta?: { err: unknown; innerInstructions?: { instructions: { programIdIndex: number; data: string }[] }[]; loadedAddresses?: { writable: string[]; readonly: string[] } } | null;
  transaction?: { message: { accountKeys: string[] } };
  blockTime?: number | null;
}

/** Trade events from a fetched transaction's self-CPI inner instructions. */
export function eventsFromTransaction(tx: RpcTx): PumpEvent[] {
  const keys = [...(tx.transaction?.message.accountKeys ?? []), ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const events: PumpEvent[] = [];
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const program = keys[ix.programIdIndex];
      if (program !== PUMP_PROGRAM && program !== PUMP_AMM_PROGRAM) continue;
      let data: Buffer;
      try {
        data = b58decode(ix.data);
      } catch {
        continue;
      }
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const e = decodeEvent(data.subarray(8));
      if (e) events.push(e);
    }
  }
  return events;
}

const units = (v: unknown, decimals: number) => new Decimal(String(v ?? 0)).div(new Decimal(10).pow(decimals));

/** Which pool trades which mint: the AMM `Pool` account's base and quote mints. */
export interface PoolInfo {
  baseMint: string;
  quoteMint: string;
}

/** Pool account layout (idl/pump_amm.json): disc 8, pool_bump u8, index u16, creator, base_mint, quote_mint, ... */
export function decodePool(data: Buffer): PoolInfo | null {
  if (data.length < 107) return null;
  return { baseMint: b58encode(data.subarray(43, 75)), quoteMint: b58encode(data.subarray(75, 107)) };
}

export interface ChainTrade {
  swap: RawSwap;
  /** Market cap right after this trade, in `mcAsset` units ('SOL', or 'USD' for stablecoin-quoted coins). */
  marketCap: Decimal | null;
  mcAsset: 'SOL' | 'USD';
}

/**
 * Turns a decoded event into a game trade for `mint`, or null (another
 * token, an unsupported quote currency, or a zero amount).
 * `pool` is required for AMM events (their data names the pool, not the mint).
 */
export function toTrade(e: PumpEvent, mint: string, signature: string, index: number, pool?: PoolInfo | null): ChainTrade | null {
  const f = e.f;
  let side: 'buy' | 'sell';
  let quoteMint: string;
  let amount: Decimal;
  let quoteDecimals = 9;
  let marketCap: Decimal | null = null;
  if (e.kind === 'curve') {
    if (f.mint !== mint || f.sol_amount === undefined || f.is_buy === undefined) return null;
    side = f.is_buy ? 'buy' : 'sell';
    quoteMint = typeof f.quote_mint === 'string' && f.quote_mint !== DEFAULT_PUBKEY ? f.quote_mint : WSOL;
    if (quoteMint === WSOL) {
      amount = units(f.sol_amount, 9);
      const vTok = units(f.virtual_token_reserves, TOKEN_DECIMALS);
      if (vTok.gt(0)) marketCap = units(f.virtual_sol_reserves, 9).div(vTok).mul(PUMP_TOTAL_SUPPLY);
    } else {
      if (!STABLE[quoteMint] || f.quote_amount === undefined) return null;
      quoteDecimals = 6;
      amount = units(f.quote_amount, quoteDecimals);
      const vTok = units(f.virtual_token_reserves, TOKEN_DECIMALS);
      if (vTok.gt(0) && f.virtual_quote_reserves !== undefined) marketCap = units(f.virtual_quote_reserves, quoteDecimals).div(vTok).mul(PUMP_TOTAL_SUPPLY);
    }
  } else {
    if (!pool || pool.baseMint !== mint || f.quote_amount === undefined) return null;
    quoteMint = pool.quoteMint;
    if (quoteMint !== WSOL && !STABLE[quoteMint]) return null;
    if (quoteMint !== WSOL) quoteDecimals = 6;
    side = e.kind === 'amm-buy' ? 'buy' : 'sell';
    amount = units(f.quote_amount, quoteDecimals);
    // Effective quote reserves = vault + virtual (signed; see docs/NEGATIVE_VIRTUAL_QUOTE_RESERVES.md).
    const quote = BigInt(String(f.pool_quote_token_reserves ?? 0)) + BigInt(String(f.virtual_quote_reserves ?? 0));
    const base = units(f.pool_base_token_reserves, TOKEN_DECIMALS);
    const supply = f.base_supply !== undefined ? units(f.base_supply, TOKEN_DECIMALS) : PUMP_TOTAL_SUPPLY;
    if (base.gt(0) && quote > 0n) marketCap = units(quote, quoteDecimals).div(base).mul(supply);
  }
  if (amount.lte(0)) return null;
  const ts = typeof f.timestamp === 'bigint' && f.timestamp > 0n ? Number(f.timestamp) * 1000 : Date.now();
  return {
    swap: {
      transactionSignature: signature,
      swapIndex: index,
      mint,
      side,
      quoteAmount: amount.toString(),
      quoteAsset: quoteMint === WSOL ? 'SOL' : STABLE[quoteMint],
      timestamp: ts,
      confirmationStatus: 'confirmed',
      trader: typeof f.user === 'string' ? f.user : undefined,
      source: 'solana:pump.fun',
    },
    marketCap,
    mcAsset: quoteMint === WSOL ? 'SOL' : 'USD',
  };
}

// ---------------------------------------------------------------- connection

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

/** The RPC's WebSocket address: same host, wss:// (Helius, QuickNode, public RPC all follow this). */
export const wsUrlFor = (rpcUrl: string) => rpcUrl.replace(/^http(s?):\/\//, (_m, s) => `ws${s}://`);

/** Hides an API key in an RPC address before it reaches a status line or log. */
export const redact = (url: string) => url.replace(/([?&](api[-_]?key|token)=)[^&]+/i, '$1…').replace(/\/\/([^/]*)\/[A-Za-z0-9_-]{20,}/, '//$1/…');

export function connectPumpChain(opts: {
  rpcUrl: string;
  wsUrl?: string;
  mint: string;
  status: AdapterStatus;
  onTrade: (t: ChainTrade) => void;
  log: (msg: string) => void;
}) {
  const wsUrl = opts.wsUrl || wsUrlFor(opts.rpcUrl);
  const pools = new Map<string, Promise<PoolInfo | null>>();
  const seen = new Set<string>();
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 1000;
  let ping: NodeJS.Timeout | null = null;
  let count = 0;
  let lastErr = '';

  const poolInfo = (address: string) => {
    let p = pools.get(address);
    if (!p) {
      p = rpc<{ value: { data: [string, string] } | null }>(opts.rpcUrl, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }])
        .then((r) => (r.value ? decodePool(Buffer.from(r.value.data[0], 'base64')) : null))
        .catch((e) => {
          pools.delete(address); // try again next time
          opts.log(`pump chain: pool lookup failed: ${(e as Error).message}`);
          return null;
        });
      pools.set(address, p);
    }
    return p;
  };

  const handle = async (signature: string, logs: string[]) => {
    let { events, truncated, pumpInvoked } = eventsFromLogs(logs);
    if (!pumpInvoked && !events.length) return; // mentions the mint, but no pump.fun trade (e.g. a plain transfer)
    if (truncated || !events.length) {
      const tx = await rpc<RpcTx | null>(opts.rpcUrl, 'getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
      if (!tx || tx.meta?.err) return;
      events = eventsFromTransaction(tx);
    }
    let i = 0;
    for (const e of events) {
      const pool = e.kind === 'curve' ? null : await poolInfo(String(e.f.pool));
      const t = toTrade(e, opts.mint, signature, i, pool);
      if (!t) continue;
      i++;
      count++;
      opts.onTrade(t);
    }
    if (i) opts.status.set('connected', `pump.fun trades from the Solana chain via ${redact(opts.rpcUrl)}; ${count} seen since connecting`);
  };

  const open = () => {
    opts.status.set('connecting', `subscribing to pump.fun trades on the Solana chain (${redact(wsUrl)})`);
    ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      retry = 1000;
      ws!.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [opts.mint] }, { commitment: 'confirmed' }] }));
      // Many RPC providers close idle sockets; a ping keeps it open.
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.ping(), 30_000);
    });
    ws.on('message', (data) => {
      let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: { result?: { value?: { signature: string; err: unknown; logs: string[] } } } };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.id === 1) {
        if (msg.error) opts.status.set('error', `logsSubscribe refused: ${msg.error.message}`);
        else opts.status.set('connected', `listening for pump.fun trades on the Solana chain via ${redact(opts.rpcUrl)}; ${count} seen since connecting`);
        return;
      }
      const v = msg.method === 'logsNotification' ? msg.params?.result?.value : undefined;
      if (!v || v.err || seen.has(v.signature)) return; // failed transactions never count
      seen.add(v.signature);
      if (seen.size > 5000) seen.delete(seen.values().next().value!);
      handle(v.signature, v.logs).catch((e) => opts.log(`pump chain: ${(e as Error).message}`));
    });
    ws.on('close', () => {
      if (ping) clearInterval(ping);
      if (closed) return;
      opts.status.set('error', `Solana RPC socket closed${lastErr ? ` (${lastErr})` : ''}; reconnecting`);
      lastErr = '';
      setTimeout(open, (retry = Math.min(retry * 2, 30_000)));
    });
    ws.on('error', (e) => {
      lastErr = redact(String(e.message).split('\n')[0]).slice(0, 120);
      opts.log(`pump chain socket: ${lastErr}`);
      ws?.close();
    });
  };
  open();
  return () => {
    closed = true;
    if (ping) clearInterval(ping);
    ws?.close();
  };
}
