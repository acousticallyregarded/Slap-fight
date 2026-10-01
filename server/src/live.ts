import Decimal from 'decimal.js';
import crypto from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import type { GameConfig, GameEngine, PriceBook, ProviderSettings, RawSwap } from '@bvs/shared';
import { env } from './env';
import { AdapterStatus } from './adapters/status';
import { backfill, parseEnhancedTx, type HeliusEnhancedTx } from './adapters/helius';
import { ConfirmationTracker } from './adapters/confirmations';
import { connectPumpPortal } from './adapters/pumpportal';
import { historicalSolUsd, pollJupiter } from './adapters/prices';
import { fetchBirdeyeMarketCap, fetchDexScreenerMarketCap } from './adapters/marketCap';
import { connectPumpChain, type ChainTrade } from './adapters/pumpChain';
import { PUMP_FUN_CHAT_STATUS } from './adapters/chat';
import { connectPumpChat } from './adapters/pumpChat';

/**
 * Wires the live adapters to the live engine. Every adapter reports its real
 * status; nothing is simulated here.
 */
export class LiveRuntime {
  readonly status: Record<'swaps' | 'quotePrice' | 'marketCap' | 'chat', AdapterStatus>;
  private stops: (() => void)[] = [];
  private confirmations: ConfirmationTracker | null = null;
  private priceFetches = new Set<number>();
  /** Latest market cap in SOL carried by trades (PumpPortal or the chain). */
  private mcSol: Decimal | null = null;
  /** Where `mcSol` came from, for the status line. */
  private mcFrom = 'PumpPortal';

  constructor(
    private engine: GameEngine,
    private prices: PriceBook,
    private config: () => GameConfig,
    private providers: () => ProviderSettings,
    private log: (msg: string) => void,
  ) {
    const on = (name: string, c: Parameters<GameEngine['setConnection']>[1]) => engine.setConnection(name, c);
    this.status = {
      swaps: new AdapterStatus('swaps', on),
      quotePrice: new AdapterStatus('quotePrice', on),
      marketCap: new AdapterStatus('marketCap', on),
      chat: new AdapterStatus('chat', on),
    };
  }

  restart() {
    this.stop();
    const cfg = this.config();
    const p = this.providers();
    const mint = cfg.token.mint;
    for (const s of Object.values(this.status)) s.set('disabled', mint ? 'not enabled' : 'token mint not set');
    if (!mint) return;

    // Confirmation level via the official Solana RPC.
    if (env.solanaRpcUrl) {
      this.confirmations = new ConfirmationTracker(env.solanaRpcUrl, (raw) => this.ingest(raw, false), (e) => this.log(`RPC: ${e.message}`));
    }

    // Swaps.
    if (p.swaps === 'solana-rpc') {
      if (!env.solanaRpcUrl) this.status.swaps.set('error', 'SOLANA_RPC_URL is required (a free Helius RPC link works)');
      else
        this.stops.push(
          connectPumpChain({
            rpcUrl: env.solanaRpcUrl,
            wsUrl: env.solanaWsUrl,
            mint,
            status: this.status.swaps,
            onTrade: (t) => this.chainTrade(t, p.marketCap === 'trades'),
            log: this.log,
          }),
        );
    } else if (p.swaps === 'helius-webhook') {
      if (!env.heliusApiKey || !env.heliusWebhookAuth) this.status.swaps.set('error', 'HELIUS_API_KEY and HELIUS_WEBHOOK_AUTH are required');
      else if (!env.solanaRpcUrl) this.status.swaps.set('error', 'SOLANA_RPC_URL is required to confirm swaps');
      else {
        this.status.swaps.set('connected', 'waiting for Helius webhook deliveries at /api/webhooks/helius');
        if (p.heliusBackfill) {
          void this.runBackfill();
          const t = setInterval(() => void this.runBackfill(), 5 * 60_000);
          this.stops.push(() => clearInterval(t));
        }
      }
    } else if (p.swaps === 'pumpportal') {
      if (!env.pumpPortalApiKey || !env.solanaRpcUrl) this.status.swaps.set('error', 'PUMPPORTAL_API_KEY and SOLANA_RPC_URL are required');
      else
        this.stops.push(
          connectPumpPortal({
            apiKey: env.pumpPortalApiKey,
            mint,
            status: this.status.swaps,
            onSwap: (s) => this.ingest(s, true),
            onMarketCapSol: p.marketCap === 'pumpportal' ? (sol) => this.pumpPortalMarketCap(sol) : undefined,
          }),
        );
    }

    // Quote prices: live samples always help recent trades; history fills gaps.
    this.stops.push(
      pollJupiter(
        this.prices,
        env.jupiterApiKey,
        () => {
          this.status.quotePrice.set('connected', `SOL/USD live via Jupiter; history via ${p.quotePrice}`);
          this.engine.retryPendingPrices();
        },
        (e) => this.status.quotePrice.set('error', e),
      ),
    );

    // Market cap.
    this.mcSol = null;
    if (p.marketCap === 'pumpportal' || p.marketCap === 'trades') {
      const need = p.marketCap === 'pumpportal' ? 'pumpportal' : 'solana-rpc';
      this.mcFrom = p.marketCap === 'pumpportal' ? 'PumpPortal' : 'the latest on-chain trade';
      if (p.swaps !== need) this.status.marketCap.set('error', `needs Trades set to ${need === 'pumpportal' ? 'PumpPortal' : 'Solana chain'} (it comes with each trade)`);
      else {
        this.status.marketCap.set('connecting', 'waiting for the first trade');
        // Between trades the market cap in SOL does not change; re-price it so
        // the dollar value follows SOL and the reading never goes stale.
        const t = setInterval(() => this.mcSol && this.pumpPortalMarketCap(this.mcSol), 15_000);
        this.stops.push(() => clearInterval(t));
      }
    } else if (p.marketCap === 'dexscreener') {
      const poll = async () => {
        try {
          const s = await fetchDexScreenerMarketCap(mint);
          if (!s) return this.status.marketCap.set('error', 'DexScreener lists no pair for this token yet');
          this.engine.ingestMarketCap(s);
          this.status.marketCap.set('connected', `DexScreener (${s.kind === 'fdv' ? 'FDV only' : 'market cap'}, ${s.source.split(':')[1]})`);
        } catch (e) {
          this.status.marketCap.set('error', (e as Error).message);
        }
      };
      void poll();
      // DexScreener allows 60 requests a minute.
      const t = setInterval(poll, Math.max(5_000, p.marketCapPollMs));
      this.stops.push(() => clearInterval(t));
    } else if (p.marketCap === 'birdeye') {
      if (!env.birdeyeApiKey) this.status.marketCap.set('error', 'BIRDEYE_API_KEY is required');
      else {
        const poll = async () => {
          try {
            const s = await fetchBirdeyeMarketCap(mint, env.birdeyeApiKey);
            if (!s) return this.status.marketCap.set('error', 'no market cap, price×supply or FDV available');
            this.engine.ingestMarketCap(s);
            this.status.marketCap.set('connected', `Birdeye (${s.kind === 'fdv' ? 'FDV only' : 'circulating'})`);
          } catch (e) {
            this.status.marketCap.set('error', (e as Error).message);
          }
        };
        void poll();
        const t = setInterval(poll, Math.max(5_000, p.marketCapPollMs));
        this.stops.push(() => clearInterval(t));
      }
    }

    // Chat.
    // Viewers see the chat pill marked unofficial while this source is on.
    this.engine.setConnection('chatUnofficial', p.chat === 'pump-chat-client' ? 'connected' : 'unconfigured');
    if (p.chat === 'relay') {
      if (!env.chatRelaySecret) this.status.chat.set('error', 'CHAT_RELAY_SECRET is required');
      else this.status.chat.set('connected', 'accepting signed relay messages at /api/chat/relay (source: relay)');
    } else if (p.chat === 'pump-chat-client') {
      this.stops.push(
        connectPumpChat(mint, {
          onMessage: (m) => this.engine.ingestChat(m),
          onStatus: (state, detail) => this.status.chat.set(state, detail),
          log: this.log,
        }),
      );
    } else this.status.chat.set('unavailable', PUMP_FUN_CHAT_STATUS.detail);

    const tick = setInterval(() => this.engine.tick(), 5_000);
    this.stops.push(() => clearInterval(tick));
  }

  /** A trade read from the chain: into the pipeline, and its market cap when that is the chosen source. */
  private chainTrade(t: ChainTrade, useMarketCap: boolean) {
    this.ingest(t.swap, true);
    if (!useMarketCap || !t.marketCap) return;
    if (t.mcAsset === 'SOL') return this.pumpPortalMarketCap(t.marketCap);
    this.engine.ingestMarketCap({ value: t.marketCap.toFixed(2), kind: 'circulating', source: 'solana:pump.fun', observedAt: Date.now() });
    this.status.marketCap.set('connected', 'from the latest on-chain trade (stablecoin-quoted coin)');
  }

  /** Converts a market cap in SOL (from a trade) to USD with a current SOL/USD sample. */
  private pumpPortalMarketCap(sol: Decimal) {
    this.mcSol = sol;
    const now = Date.now();
    const px = this.prices.priceAt('SOL', now);
    if (!px || Math.abs(now - px.at) > 120_000) {
      this.status.marketCap.set('connecting', 'market cap in SOL received; waiting for a current SOL/USD price');
      return;
    }
    const usd = sol.mul(px.usd);
    this.engine.ingestMarketCap({ value: usd.toFixed(2), kind: 'circulating', source: this.mcFrom === 'PumpPortal' ? 'pumpportal' : 'solana:pump.fun', observedAt: now });
    this.status.marketCap.set('connected', `${this.mcFrom} (${sol.toDecimalPlaces(2)} SOL × SOL/USD ${new Decimal(px.usd).toDecimalPlaces(2)}), as pump.fun shows it`);
  }

  stop() {
    for (const s of this.stops.splice(0)) s();
    this.confirmations?.stop();
    this.confirmations = null;
  }

  /** Helius webhook entry point. */
  handleWebhook(authHeader: string | undefined, body: unknown): number {
    const expected = Buffer.from(env.heliusWebhookAuth);
    const got = Buffer.from(authHeader ?? '');
    if (!env.heliusWebhookAuth || expected.length !== got.length || !timingSafeEqual(expected, got)) return 401;
    if (this.providers().swaps !== 'helius-webhook') return 409;
    const txs = (Array.isArray(body) ? body : [body]) as HeliusEnhancedTx[];
    for (const tx of txs) this.handleTx(tx);
    return 200;
  }

  private handleTx(tx: HeliusEnhancedTx) {
    const mint = this.config().token.mint;
    const r = parseEnhancedTx(tx, mint);
    if ('skip' in r) return;
    this.ingest(r.swap, true);
  }

  private async runBackfill() {
    try {
      const cursor = await backfill({
        apiKey: env.heliusApiKey,
        baseUrl: env.heliusBaseUrl,
        address: this.config().token.mint,
        afterSignature: this.engine.getCursor('helius'),
        onTx: (tx) => this.handleTx(tx),
        status: this.status.swaps,
      });
      if (cursor) this.engine.setCursor('helius', cursor);
    } catch (e) {
      this.log(`backfill: ${(e as Error).message}`);
    }
  }

  /** New swaps go through the pipeline as `processed` (held) and get confirmed via RPC. */
  private ingest(raw: RawSwap, fresh: boolean) {
    const r = this.engine.ingestSwap(raw);
    if (fresh && r.disposition === 'pending-confirmation') this.confirmations?.track(raw);
    if (r.disposition === 'pending-price') void this.fetchHistoricalPrice(raw.timestamp);
  }

  private async fetchHistoricalPrice(ts: number) {
    const bucket = Math.floor(ts / 30_000);
    if (this.priceFetches.has(bucket)) return;
    this.priceFetches.add(bucket);
    try {
      const p = await historicalSolUsd(this.providers().quotePrice, ts, {
        pythApiKey: env.pythApiKey,
        pythFeedId: env.pythSolUsdFeedId,
        birdeyeApiKey: env.birdeyeApiKey,
      });
      if (p) {
        this.prices.add('SOL', p);
        this.engine.retryPendingPrices();
      }
    } catch (e) {
      this.log(`price: ${(e as Error).message}`);
    } finally {
      setTimeout(() => this.priceFetches.delete(bucket), 60_000);
    }
  }
}

export const randomToken = () => crypto.randomBytes(32).toString('hex');
