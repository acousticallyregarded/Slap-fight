import { createRequire } from 'node:module';
import type { RawChatMessage } from '@bvs/shared';

// Unofficial pump.fun chat reader.
//
// pump.fun publishes no supported chat API. The open-source pump-chat-client
// library (npm, MIT, github.com/codingbutter/pump-chat-client) reads a token's
// chat room the way the pump.fun website does, over its undocumented
// socket.io endpoint (wss://livechat.pump.fun). It needs no login to read.
// pump.fun can change or block that endpoint at any time, so this adapter
// reports its real state and the game labels the feed as unofficial.
//
// Read-only: this bridge never posts to the chat. Messages go through the
// same moderation, cooldowns and fixed reaction library as every other
// chat source, and old messages (the room's history) are never replayed.

const require = createRequire(import.meta.url);

export const PUMP_CHAT_SOURCE = 'pump-chat-client';
export const PUMP_CHAT_LABEL = 'pump.fun chat via pump-chat-client (unofficial, read-only)';

interface PumpMessage {
  id?: string;
  roomId?: string;
  username?: string;
  userAddress?: string;
  message?: string;
  timestamp?: string | number;
}

interface ClientLike {
  on(event: string, fn: (...a: any[]) => void): unknown;
  connect(): void;
  disconnect(): void;
  removeAllListeners(): unknown;
}

/** Solana addresses are base58, 32 to 44 characters. The mint goes into the room id unescaped by the library. */
export const isMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export function toRawMessage(m: PumpMessage, mint: string): RawChatMessage | null {
  if (!m || typeof m.message !== 'string' || !m.message.trim()) return null;
  if (m.roomId && m.roomId !== mint) return null;
  const ts = typeof m.timestamp === 'number' ? m.timestamp : Date.parse(m.timestamp ?? '');
  const sender = (m.username || m.userAddress || 'anon').slice(0, 100);
  return {
    messageId: `pump:${String(m.id ?? `${sender}:${ts}:${m.message.slice(0, 40)}`).slice(0, 180)}`,
    sender,
    text: m.message.slice(0, 500),
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    source: PUMP_CHAT_SOURCE,
  };
}

export interface PumpChatHandlers {
  onMessage(m: RawChatMessage): void;
  onStatus(state: 'connecting' | 'connected' | 'error', detail: string): void;
  log(msg: string): void;
}

/**
 * Keeps one read-only pump-chat-client connection to the mint's room.
 * `makeClient` exists for tests; production uses the npm library.
 */
export function connectPumpChat(mint: string, h: PumpChatHandlers, makeClient?: (roomId: string) => ClientLike): () => void {
  if (!isMint(mint)) {
    h.onStatus('error', 'token mint is not a valid Solana address');
    return () => {};
  }
  const create =
    makeClient ??
    ((roomId: string) => {
      const { PumpChatClient } = require('pump-chat-client') as { PumpChatClient: new (o: object) => ClientLike };
      return new PumpChatClient({ roomId, username: 'buy-vs-sell-viewer', messageHistoryLimit: 20 });
    });
  let client: ClientLike | null = null;
  // Retire a client for good: the library would otherwise reconnect on close,
  // and an EventEmitter 'error' with no listener would crash the server.
  const retire = (c: ClientLike | null) => {
    if (!c) return;
    c.removeAllListeners();
    c.on('error', () => {});
    (c as { maxReconnectAttempts?: number }).maxReconnectAttempts = 0;
    c.disconnect();
  };
  let stopped = false;
  let retry: NodeJS.Timeout | null = null;
  const seen = new Set<string>();

  const open = () => {
    if (stopped) return;
    h.onStatus('connecting', `joining the pump.fun chat room for ${mint} (unofficial)`);
    client = create(mint);
    client.on('connected', () => h.onStatus('connecting', 'socket open, joining room (unofficial)'));
    // The room's history arrives once after joining: mark it seen, never replay it.
    client.on('messageHistory', (msgs: PumpMessage[]) => {
      for (const m of msgs ?? []) if (m?.id) seen.add(String(m.id));
      h.onStatus('connected', `${PUMP_CHAT_LABEL}; room joined`);
    });
    client.on('message', (m: PumpMessage) => {
      h.onStatus('connected', `${PUMP_CHAT_LABEL}; receiving messages`);
      if (m?.id) {
        if (seen.has(String(m.id))) return;
        seen.add(String(m.id));
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
      }
      const raw = toRawMessage(m, mint);
      if (raw) h.onMessage(raw);
    });
    client.on('error', (e: Error) => h.onStatus('error', `pump.fun chat connection failed: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`));
    client.on('disconnected', () => h.onStatus('connecting', 'disconnected from pump.fun chat, reconnecting'));
    // The library retries 5 times; after that, start over with a fresh client.
    client.on('maxReconnectAttemptsReached', () => {
      h.onStatus('error', 'pump.fun chat unreachable; retrying in 60 s');
      retry = setTimeout(() => {
        retire(client);
        open();
      }, 60_000);
    });
    client.connect();
  };
  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    retire(client);
    client = null;
  };
}
