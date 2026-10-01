import type { FunSnapshot, SlapExtras } from './fun';
// Core data shapes shared by the browser client, the server and the demo simulator.

export type Mode = 'live' | 'demo';
export type Side = 'buy' | 'sell';
export type CharacterId = 'buy' | 'sell';

/** Solana commitment levels, lowest to highest. `failed`/`dropped` are corrections. */
export type ConfirmationStatus = 'processed' | 'confirmed' | 'finalized' | 'failed' | 'dropped';

/**
 * A single swap as reported by a swap adapter (or the demo simulator), before
 * validation, pricing, threshold checks and deduplication.
 */
export interface RawSwap {
  transactionSignature: string;
  /** Logical swap identifier inside the transaction (routed legs collapse to one). */
  swapIndex: number;
  mint: string;
  side: Side;
  /** Quote-asset amount as a decimal string, excluding fees and rent. */
  quoteAmount: string;
  quoteAsset: string;
  /** Unix milliseconds of the block time. */
  timestamp: number;
  confirmationStatus: ConfirmationStatus;
  /** Optional trader wallet, used only for display (abbreviated). */
  trader?: string;
  source: string;
}

/** The normalized swap structure required by the spec. */
export interface NormalizedSwap {
  eventId: string;
  transactionSignature: string;
  swapIndex: number;
  mint: string;
  side: Side;
  quoteAmount: string;
  quoteAsset: string;
  /** Decimal string, two-decimal rounding applied only for display. Null while pending. */
  usdValue: string | null;
  timestamp: number;
  confirmationStatus: ConfirmationStatus;
}

export type SwapDisposition =
  | 'slap' // qualifying, emitted once
  | 'below-threshold'
  | 'pending-price'
  | 'pending-confirmation'
  | 'duplicate'
  | 'wrong-mint'
  | 'invalid'
  | 'corrected';

export interface MarketCapSample {
  /** USD value as decimal string. */
  value: string;
  /** `circulating` = true market cap. `fdv` = fully diluted valuation (labeled as such). */
  kind: 'circulating' | 'fdv';
  source: string;
  observedAt: number;
}

export interface RawChatMessage {
  messageId: string;
  sender: string;
  text: string;
  timestamp: number;
  source: string;
}

export type ChatCategory =
  | 'greeting'
  | 'attention'
  | 'compliment'
  | 'flirt'
  | 'boundary'
  | 'buyCheer'
  | 'sellCheer'
  | 'laughter'
  | 'sportsmanship';

export type ReactionTarget = CharacterId | 'both';

export interface ChatReaction {
  id: string;
  messageId: string;
  category: ChatCategory;
  target: ReactionTarget;
  bubble: string | null;
  /** Sanitized snippet safe to show, or null when the text must not be displayed. */
  displayText: string | null;
  senderLabel: string;
  createdAt: number;
  source: string;
}

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'demo' | 'unconfigured';

export interface FeedTrade {
  eventId: string;
  side: Side;
  usdValue: string;
  quoteAmount: string;
  quoteAsset: string;
  timestamp: number;
  trader?: string;
  signature: string;
  corrected?: boolean;
}

export interface MarketState {
  sample: MarketCapSample | null;
  stale: boolean;
  invalidReason: string | null;
}

/** Everything a newly joined viewer needs. Never includes historical celebrations. */
export interface Snapshot {
  mode: Mode;
  token: { name: string; symbol: string; mint: string };
  unlockedStage: number;
  slaps: { buy: number; sell: number };
  market: MarketState;
  nextMilestone: number | null;
  milestones: number[];
  connections: Record<string, ConnectionState>;
  recentTrades: FeedTrade[];
  recentReactions: ChatReaction[];
  pendingPriceCount: number;
  /** Combo streak, today's biggest slap, hype and chat cheers. */
  fun: FunSnapshot;
  serverTime: number;
}

/** Live events pushed to clients, in order. */
export type GameEvent =
  | ({ type: 'slap'; seq: number; attacker: CharacterId; trade: FeedTrade; intensity: number } & SlapExtras)
  /** A qualifying trade after the final milestone: no more slaps, the two celebrate together. */
  | { type: 'celebrate'; seq: number; side: Side; trade: FeedTrade; whale: boolean; record: boolean }
  /** Show extras changed (hype, cheers, streak, record). */
  | { type: 'fun'; seq: number; fun: FunSnapshot }
  | { type: 'outfitUnlock'; seq: number; stage: number; threshold: number; final: boolean }
  | { type: 'chatReaction'; seq: number; reaction: ChatReaction }
  | { type: 'correction'; seq: number; eventId: string; side: Side; note: string }
  | { type: 'market'; seq: number; market: MarketState; nextMilestone: number | null }
  | { type: 'connection'; seq: number; connections: Record<string, ConnectionState> }
  | { type: 'pending'; seq: number; pendingPriceCount: number }
  | { type: 'reset'; seq: number; snapshot: Snapshot };

export type GameEventInput = GameEvent extends infer E ? (E extends { seq: number } ? Omit<E, 'seq'> : never) : never;
