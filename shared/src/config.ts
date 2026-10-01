import type { ConfirmationStatus } from './types';
import { DEFAULT_FUN, type FunConfig } from './fun';

/** Settings that are safe to share with viewers (no credentials). */
export interface GameConfig {
  token: {
    name: string;
    symbol: string;
    /** Empty until the token launches. Live mode stays idle while empty. */
    mint: string;
  };
  trades: {
    /** Inclusive USD threshold, decimal string. */
    slapThresholdUsd: string;
    /** Lowest commitment level at which a swap may produce a slap. */
    requiredConfirmation: Extract<ConfirmationStatus, 'confirmed' | 'finalized'>;
    /** Quote assets treated as exactly 1 USD. */
    usdStableAssets: string[];
    /** Maximum distance between trade time and a quote price sample. */
    priceToleranceMs: number;
    /** How long a trade may wait for a verifiable price before it is reported as unpriced (still never guessed). */
    pendingPriceTimeoutMs: number;
  };
  milestones: {
    /** USD thresholds, ascending. Five stages by default. */
    thresholdsUsd: number[];
    /** Consecutive valid samples at/above a threshold required before unlocking. */
    confirmSamples: number;
    /** And the span those samples must cover. */
    confirmDurationMs: number;
    /** Market-cap data older than this is stale; unlocks are suspended. */
    staleAfterMs: number;
    /** Allow FDV samples to count toward unlocks (off by default; FDV is always labeled). */
    allowFdv: boolean;
  };
  chat: {
    perCharacterCooldownMs: number;
    perSenderCooldownMs: number;
    /** Reactions older than this are dropped instead of queued. */
    maxReactionAgeMs: number;
    showBubbles: boolean;
  };
  playback: {
    /** Maximum speed-up applied to the animation queue under load. */
    maxSpeed: number;
  };
  /** Combos, whale slaps, hype meter and chat cheers (show only; never changes what slaps). */
  fun: FunConfig;
}

export const DEFAULT_CONFIG: GameConfig = {
  token: { name: 'Buy vs. Sell', symbol: 'BVS', mint: '' },
  trades: {
    slapThresholdUsd: '100',
    requiredConfirmation: 'confirmed',
    usdStableAssets: ['USDC', 'USDT'],
    priceToleranceMs: 90_000,
    pendingPriceTimeoutMs: 10 * 60_000,
  },
  milestones: {
    thresholdsUsd: [20_000, 40_000, 60_000, 80_000, 100_000],
    confirmSamples: 2,
    confirmDurationMs: 15_000,
    staleAfterMs: 90_000,
    allowFdv: false,
  },
  chat: {
    perCharacterCooldownMs: 8_000,
    perSenderCooldownMs: 20_000,
    maxReactionAgeMs: 6_000,
    showBubbles: true,
  },
  playback: { maxSpeed: 2.2 },
  fun: DEFAULT_FUN,
};

/** Demo mode uses the same pipeline with instant milestone confirmation so each control is visible at once. */
export const DEFAULT_DEMO_OVERRIDES = {
  milestones: { confirmSamples: 1, confirmDurationMs: 0 },
} as const;

export function mergeConfig(base: GameConfig, patch: DeepPartial<GameConfig>): GameConfig {
  const out = structuredClone(base) as any;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...out[k], ...v };
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isValidMint(mint: string): boolean {
  return BASE58.test(mint);
}

export function abbreviateMint(mint: string): string {
  if (!mint) return 'not set';
  return mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/** Validates admin-submitted config; returns a list of problems. */
export function validateConfig(c: GameConfig): string[] {
  const errs: string[] = [];
  if (c.token.mint && !isValidMint(c.token.mint)) errs.push('Token mint is not a valid base58 Solana address.');
  if (!(Number(c.trades.slapThresholdUsd) > 0)) errs.push('Slap threshold must be a positive number.');
  const t = c.milestones.thresholdsUsd;
  if (t.length === 0 || t.some((x, i) => !(x > 0) || (i > 0 && x <= t[i - 1]))) errs.push('Milestones must be positive and ascending.');
  if (t.length > 5) errs.push('Sell has five outfit stages; at most five milestones.');
  if (c.milestones.confirmSamples < 1) errs.push('Milestone confirmation needs at least one sample.');
  if (c.chat.perCharacterCooldownMs < 0 || c.chat.perSenderCooldownMs < 0) errs.push('Cooldowns cannot be negative.');
  if (!(Number(c.fun.whaleUsd) > 0)) errs.push('Whale slap amount must be a positive number.');
  if (!(c.fun.comboMin >= 2)) errs.push('A combo needs at least 2 slaps in a row.');
  if (!(c.fun.hypeFullUsd > 0) || !(c.fun.hypeWindowMs > 0) || !(c.fun.cheerWindowMs > 0)) errs.push('Hype and cheer windows must be positive.');
  if (c.playback.maxSpeed < 1 || c.playback.maxSpeed > 4) errs.push('Max playback speed must be between 1 and 4.');
  return errs;
}

/** Which adapters the server runs. Credentials are never part of this object; they come from env vars. */
export interface ProviderSettings {
  swaps: 'none' | 'solana-rpc' | 'helius-webhook' | 'pumpportal';
  /** Backfill missed swaps from Helius history after a restart or webhook gap. */
  heliusBackfill: boolean;
  quotePrice: 'pyth' | 'birdeye' | 'jupiter-live';
  /** `pumpportal` reads the market cap PumpPortal sends with each trade (needs swaps = pumpportal). */
  marketCap: 'none' | 'trades' | 'dexscreener' | 'birdeye' | 'pumpportal';
  marketCapPollMs: number;
  chat: 'none' | 'relay' | 'pump-chat-client';
}

export const DEFAULT_PROVIDERS: ProviderSettings = {
  // Free by default: pump.fun trades from the chain via SOLANA_RPC_URL, market cap from each trade.
  swaps: 'solana-rpc',
  heliusBackfill: true,
  quotePrice: 'pyth',
  marketCap: 'trades',
  marketCapPollMs: 15_000,
  chat: 'none',
};

/** Admin view of the server: config, providers and which secrets are present (never their values). */
export interface AdminState {
  config: GameConfig;
  providers: ProviderSettings;
  secrets: Record<string, boolean>;
  /** Keys the admin screen may set, and where each current value comes from (never the value). */
  secretSources?: Record<string, 'admin' | 'env' | 'unset'>;
  adapterStatus: Record<string, { state: string; detail: string }>;
  demoConfig: GameConfig;
}
