import crypto from 'node:crypto';
import type { RawChatMessage } from '@bvs/shared';

// pump.fun chat: as of 2026-09-30 pump.fun publishes no official, supported
// API for live chat or replies. Its public docs (github.com/pump-fun/pump-public-docs)
// cover on-chain programs only; frontend-api.pump.fun is undocumented and may
// change without notice. This relay adapter does not connect to pump.fun; the
// separate, clearly labelled unofficial reader lives in ./pumpChat.ts.
//
// Boundary: an operator-run relay may POST messages to /api/chat/relay, signed
// with HMAC-SHA256 over the raw body using CHAT_RELAY_SECRET (hex digest in the
// `x-relay-signature` header). The source is labeled `relay`, never `pump.fun`.
export const PUMP_FUN_CHAT_STATUS = {
  state: 'unavailable',
  detail: 'No official pump.fun chat API. Options: the unofficial pump-chat-client reader (may break without notice) or a signed relay you operate.',
};

export function verifyRelaySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Validates the relay payload shape. Text stays plain data: it is only classified. */
export function parseRelayMessages(body: unknown): RawChatMessage[] {
  const arr = Array.isArray(body) ? body : [body];
  const out: RawChatMessage[] = [];
  for (const m of arr.slice(0, 200)) {
    if (!m || typeof m !== 'object') continue;
    const { messageId, sender, text, timestamp } = m as Record<string, unknown>;
    if (typeof messageId !== 'string' || typeof text !== 'string') continue;
    out.push({
      messageId: messageId.slice(0, 200),
      sender: typeof sender === 'string' ? sender.slice(0, 100) : 'anon',
      text: text.slice(0, 500),
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      source: 'relay',
    });
  }
  return out;
}
