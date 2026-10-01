import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { DEFAULT_CONFIG, GameEngine, PriceBook, mergeConfig, type EngineStore, type GameEvent, type PersistedState } from '@bvs/shared';
import { connectPumpChat, isMint, toRawMessage } from '../src/adapters/pumpChat';

const require = createRequire(import.meta.url);
const MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

/** A stand-in for livechat.pump.fun speaking the same socket.io frames. */
function fakePumpChat(port: number, received: string[]) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    ws.send('0{"sid":"s","pingInterval":25000,"pingTimeout":20000}');
    ws.on('message', (d) => {
      const t = d.toString();
      received.push(t);
      if (t.startsWith('40')) ws.send('40{"sid":"n"}');
      else if (t.includes('"joinRoom"')) ws.send(`43${t[2]}[{}]`);
      else if (t.includes('"getMessageHistory"')) {
        ws.send(`43${t[2]}[[{"id":"old1","roomId":"${MINT}","username":"early","message":"gm old","timestamp":"2026-09-30T10:00:00Z"}]]`);
        setTimeout(() => {
          ws.send(`42["newMessage",{"id":"m1","roomId":"${MINT}","username":"alice","message":"gm everyone","timestamp":"${new Date().toISOString()}"}]`);
          ws.send(`42["newMessage",{"id":"m1","roomId":"${MINT}","username":"alice","message":"gm everyone","timestamp":"${new Date().toISOString()}"}]`);
          ws.send(`42["newMessage",{"id":"m2","roomId":"${MINT}","username":"bob","message":"lol","timestamp":"${new Date().toISOString()}"}]`);
        }, 50);
      }
    });
  });
  return wss;
}

describe('pump.fun chat bridge (unofficial)', () => {
  it('validates mints and maps messages', () => {
    expect(isMint(MINT)).toBe(true);
    expect(isMint('abc"}]')).toBe(false);
    expect(toRawMessage({ id: '1', roomId: 'other', message: 'hi' }, MINT)).toBeNull();
    expect(toRawMessage({ id: '1', roomId: MINT, username: 'a', message: 'hi', timestamp: 5 }, MINT)).toMatchObject({ source: 'pump-chat-client', sender: 'a', text: 'hi', timestamp: 5 });
  });

  it('reads a room through pump-chat-client into the engine, read-only, without replaying history', async () => {
    const received: string[] = [];
    const port = 18000 + Math.floor(Math.random() * 1000);
    const wss = fakePumpChat(port, received);
    const data = new Map<string, PersistedState>();
    const store: EngineStore = { load: (k) => data.get(k) ?? null, save: (k, s) => data.set(k, s), remove: (k) => data.delete(k) };
    const cfg = mergeConfig(DEFAULT_CONFIG, { token: { name: 'T', symbol: 'T', mint: MINT } });
    const engine = new GameEngine({ mode: 'live', config: () => cfg, prices: new PriceBook(), store });
    const events: GameEvent[] = [];
    engine.on((e) => events.push(e));
    const states: string[] = [];
    const { PumpChatClient } = require('pump-chat-client');
    const stop = connectPumpChat(
      MINT,
      { onMessage: (m) => engine.ingestChat(m), onStatus: (s) => states.push(s), log: () => {} },
      (roomId) => {
        const c = new PumpChatClient({ roomId, username: 'buy-vs-sell-viewer' });
        // Same client, pointed at the stand-in instead of livechat.pump.fun.
        c.connect = () => c.client.connect(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
        return c;
      },
    );
    await new Promise((r) => setTimeout(r, 600));
    stop();
    wss.close();
    const reactions = events.filter((e) => e.type === 'chatReaction') as any[];
    expect(reactions.map((r) => r.reaction.category)).toEqual(['greeting', 'laughter']);
    expect(reactions.every((r) => r.reaction.source === 'pump-chat-client')).toBe(true);
    expect(states).toContain('connected');
    expect(received.some((t) => t.includes('sendMessage'))).toBe(false);
  });
});
