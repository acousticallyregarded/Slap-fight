import type { DemoAction, GameEvent, Mode, Snapshot } from '@bvs/shared';
import type { AdminApi, Transport } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/**
 * Viewer connection to the Node server. Viewing is read-only; demo actions
 * and configuration go through admin endpoints that require the admin session.
 */
export class ServerTransport implements Transport {
  kind = 'server' as const;
  private logListeners = new Set<(l: string) => void>();
  constructor(public mode: Mode) {}

  onDemoLog(cb: (l: string) => void) {
    this.logListeners.add(cb);
    return () => void this.logListeners.delete(cb);
  }

  subscribe(onSnapshot: (s: Snapshot) => void, onEvent: (e: GameEvent) => void, onStatus: (o: boolean) => void) {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 500;
    let lastSeq = 0;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?mode=${this.mode}`);
      ws.onopen = () => {
        retry = 500;
        onStatus(true);
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.kind === 'snapshot') {
          // Fresh snapshot on every (re)connect: current outfit shown, no historical replays.
          lastSeq = msg.seq ?? 0;
          onSnapshot(msg.snapshot);
        } else if (msg.kind === 'demoLog') {
          this.logListeners.forEach((cb) => cb(String(msg.line)));
        } else if (msg.kind === 'event') {
          const e = msg.event as GameEvent;
          if (e.seq <= lastSeq) return;
          lastSeq = e.seq;
          onEvent(e);
        }
      };
      ws.onclose = () => {
        onStatus(false);
        if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 10_000)));
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }

  admin: AdminApi = {
    isAdmin: async () => (await json<{ admin: boolean }>(await fetch('/api/admin/session', { credentials: 'same-origin' }))).admin,
    login: async (password) => (await post('/api/admin/login', { password })).ok,
    logout: async () => void (await post('/api/admin/logout')),
    load: async () => json(await fetch('/api/admin/state', { credentials: 'same-origin' })),
    save: async (patch) => json(await post('/api/admin/config', patch)),
    demo: async (action: DemoAction, arg?: string | number) => (await json<{ log: string[] }>(await post('/api/admin/demo', { action, arg }))).log,
    resetDemo: async () => void (await post('/api/admin/demo/reset')),
    saveSecrets: async (patch) => json(await post('/api/admin/secrets', patch)),
  };
}
