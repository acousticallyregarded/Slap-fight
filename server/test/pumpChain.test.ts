import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import fx from './fixtures-pump-events.json';
import {
  b58decode, b58encode, connectPumpChain, decodeEvent, decodePool, eventsFromLogs, eventsFromTransaction,
  PUMP_AMM_PROGRAM, redact, toTrade, type ChainTrade,
} from '../src/adapters/pumpChain';
import { dexScreenerSample } from '../src/adapters/marketCap';
import { AdapterStatus } from '../src/adapters/status';

// Fixtures were encoded with Anchor's own Borsh coder from pump.fun's
// published IDL (pump-fun/pump-public-docs), so these tests check our
// hand-written decoder against the official layout.
const MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const b64 = (s: string) => Buffer.from(s, 'base64');
const pool = decodePool(b64(fx.poolAccount));

describe('pump.fun trades from the chain', () => {
  it('base58 round-trips', () => {
    expect(b58encode(b58decode(MINT))).toBe(MINT);
    expect(b58encode(Buffer.alloc(32))).toBe('11111111111111111111111111111111');
  });

  it('decodes a bonding-curve buy with its amount (fees excluded) and pump.fun-style market cap', () => {
    const e = decodeEvent(b64(fx.curveBuy))!;
    const t = toTrade(e, MINT, 'sig1', 0)!;
    expect(t.swap).toMatchObject({ side: 'buy', quoteAmount: '1.5', quoteAsset: 'SOL', timestamp: 1790000000_000, confirmationStatus: 'confirmed', source: 'solana:pump.fun' });
    // 40 SOL / 800M tokens × 1B supply
    expect(t.marketCap!.toString()).toBe('50');
    expect(t.mcAsset).toBe('SOL');
  });

  it('ignores trades of other tokens', () => {
    expect(toTrade(decodeEvent(b64(fx.curveSellOtherMint))!, MINT, 'sig', 0)).toBeNull();
  });

  it('decodes PumpSwap sells and buys through the pool account, with signed virtual reserves', () => {
    expect(pool).toEqual({ baseMint: MINT, quoteMint: 'So11111111111111111111111111111111111111112' });
    const sell = toTrade(decodeEvent(b64(fx.ammSell))!, MINT, 's', 0, pool)!;
    expect(sell.swap).toMatchObject({ side: 'sell', quoteAmount: '0.45', quoteAsset: 'SOL' });
    // (90 - 10) SOL / 200M tokens × 1B supply
    expect(sell.marketCap!.toString()).toBe('400');
    const buy = toTrade(decodeEvent(b64(fx.ammBuy))!, MINT, 's', 1, pool)!;
    expect(buy.swap).toMatchObject({ side: 'buy', quoteAmount: '2', swapIndex: 1 });
    expect(toTrade(decodeEvent(b64(fx.ammBuy))!, MINT, 's', 0, { ...pool!, baseMint: 'x' })).toBeNull();
  });

  it('reads events from log lines and from self-CPI inner instructions', () => {
    const r = eventsFromLogs(['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]', `Program data: ${fx.curveBuy}`, 'Program data: AAAA']);
    expect(r.events).toHaveLength(1);
    expect(r.pumpInvoked).toBe(true);
    const tag = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
    const ev = eventsFromTransaction({
      meta: { err: null, innerInstructions: [{ instructions: [{ programIdIndex: 1, data: b58encode(Buffer.concat([tag, b64(fx.ammSell)])) }] }] },
      transaction: { message: { accountKeys: ['user', PUMP_AMM_PROGRAM] } },
    });
    expect(ev.map((e) => e.kind)).toEqual(['amm-sell']);
  });

  it('decodes older, shorter events (fields appended later are simply absent)', () => {
    const full = b64(fx.curveBuy);
    const e = decodeEvent(full.subarray(0, 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8))!;
    expect(toTrade(e, MINT, 's', 0)!.swap.quoteAmount).toBe('1.5');
  });

  it('keeps API keys out of status lines', () => {
    expect(redact('https://mainnet.helius-rpc.com/?api-key=abcd-1234')).toBe('https://mainnet.helius-rpc.com/?api-key=…');
  });
});

describe('DexScreener market cap', () => {
  it('uses the most liquid pair where the token is the base', () => {
    const s = dexScreenerSample(
      [
        { baseToken: { address: MINT }, marketCap: 61000, liquidity: { usd: 10 }, dexId: 'pumpfun' },
        { baseToken: { address: MINT }, marketCap: 64000, liquidity: { usd: 9000 }, dexId: 'pumpswap' },
        { baseToken: { address: 'other' }, marketCap: 1e9, liquidity: { usd: 1e9 } },
      ],
      MINT,
      1,
    );
    expect(s).toEqual({ value: '64000', kind: 'circulating', source: 'dexscreener:pumpswap', observedAt: 1 });
    expect(dexScreenerSample([{ baseToken: { address: MINT }, fdv: 5 }], MINT, 1)!.kind).toBe('fdv');
    expect(dexScreenerSample([], MINT, 1)).toBeNull();
  });
});

describe('Solana RPC connection', () => {
  let close: () => void = () => {};
  afterEach(() => close());

  it('subscribes to the mint, skips failed transactions, and fetches the transaction when logs are truncated', async () => {
    const calls: string[] = [];
    const tag = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { method, params } = JSON.parse(body);
        calls.push(method);
        const result =
          method === 'getAccountInfo' && params[0] === fx.poolKey
            ? { value: { data: [fx.poolAccount, 'base64'] } }
            : method === 'getTransaction'
              ? { meta: { err: null, innerInstructions: [{ instructions: [{ programIdIndex: 1, data: b58encode(Buffer.concat([tag, b64(fx.ammSell)])) }] }] }, transaction: { message: { accountKeys: ['u', PUMP_AMM_PROGRAM] } } }
              : null;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      });
    });
    const wss = new WebSocketServer({ server });
    let subscribe: unknown = null;
    wss.on('connection', (ws) => {
      ws.on('message', (m) => {
        subscribe = JSON.parse(String(m));
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 7 }));
        const note = (signature: string, err: unknown, logs: string[]) =>
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'logsNotification', params: { result: { value: { signature, err, logs } }, subscription: 7 } }));
        note('failed', { InstructionError: [0, 'x'] }, [`Program data: ${fx.curveBuy}`]);
        note('curve', null, [`Program data: ${fx.curveBuy}`]);
        note('curve', null, [`Program data: ${fx.curveBuy}`]); // duplicate delivery
        note('amm', null, [`Program ${PUMP_AMM_PROGRAM} invoke [1]`, 'Log truncated']);
        note('transfer', null, ['Program 11111111111111111111111111111111 invoke [1]']);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const trades: ChainTrade[] = [];
    const status = new AdapterStatus('swaps', () => {});
    const stop = connectPumpChain({ rpcUrl: `http://127.0.0.1:${port}/?api-key=SECRET`, mint: MINT, status, onTrade: (t) => trades.push(t), log: () => {} });
    close = () => {
      stop();
      wss.close();
      server.close();
    };
    for (let i = 0; i < 50 && trades.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(subscribe).toMatchObject({ method: 'logsSubscribe', params: [{ mentions: [MINT] }, { commitment: 'confirmed' }] });
    expect(trades.map((t) => [t.swap.transactionSignature, t.swap.side])).toEqual([['curve', 'buy'], ['amm', 'sell']]);
    expect(calls.sort()).toEqual(['getAccountInfo', 'getTransaction']);
    expect(status.view().detail).not.toContain('SECRET');
  });
});
