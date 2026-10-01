import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_CONFIG, DEFAULT_DEMO_OVERRIDES, DEFAULT_PROVIDERS, DEMO_ACTIONS, DEMO_MINT, DemoSimulator, GameEngine, PriceBook,
  mergeConfig, runDemoAction, validateConfig,
  type AdminState, type DemoAction, type GameConfig, type GameEvent, type Mode, type ProviderSettings,
} from '@bvs/shared';
import { env, loadStoredSecrets, secretPresence, secretSources, updateStoredSecrets } from './env';

loadStoredSecrets();
import { FileStore, SettingsFile } from './store';
import { LiveRuntime, randomToken } from './live';
import { parseRelayMessages, verifyRelaySignature, PUMP_FUN_CHAT_STATUS } from './adapters/chat';

// ---------------------------------------------------------------- state

const store = new FileStore(path.join(env.dataDir, 'state'));
const settingsFile = new SettingsFile<{ config: GameConfig; providers: ProviderSettings }>(path.join(env.dataDir, 'settings.json'), {
  config: DEFAULT_CONFIG,
  providers: DEFAULT_PROVIDERS,
});
let settings = settingsFile.read();
settings.config = mergeConfig(DEFAULT_CONFIG, settings.config);
settings.providers = { ...DEFAULT_PROVIDERS, ...settings.providers };

/** Demo uses the live rules with its own mint and instant milestone confirmation. */
const demoConfig = (): GameConfig =>
  mergeConfig(settings.config, {
    ...DEFAULT_DEMO_OVERRIDES,
    milestones: { ...settings.config.milestones, ...DEFAULT_DEMO_OVERRIDES.milestones },
    token: { name: `${settings.config.token.name} (demo)`, symbol: 'DEMO', mint: DEMO_MINT },
  } as any);

// Separate engines, separate price books, separate storage keys.
const livePrices = new PriceBook();
const demoPrices = new PriceBook();
const engines: Record<Mode, GameEngine> = {
  live: new GameEngine({ mode: 'live', config: () => settings.config, prices: livePrices, store }),
  demo: new GameEngine({ mode: 'demo', config: demoConfig, prices: demoPrices, store }),
};

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
const live = new LiveRuntime(engines.live, livePrices, () => settings.config, () => settings.providers, log);
live.restart();

const sim = new DemoSimulator(engines.demo, demoPrices, (line) => broadcastDemoLog(line));
sim.startFeed(10_000);
setInterval(() => engines.demo.tick(), 3_000);

// ---------------------------------------------------------------- http

const app = express();
app.disable('x-powered-by');
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
// Keep the raw body for webhook signature checks.
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => ((req as any).rawBody = buf) }));

app.get('/api/public', (_req, res) => {
  res.json({ defaultMode: settings.config.token.mint ? 'live' : 'demo', token: settings.config.token });
});
app.get('/api/snapshot', (req, res) => {
  const mode: Mode = req.query.mode === 'demo' ? 'demo' : 'live';
  res.json(engines[mode].snapshot());
});
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Admin session: one password from the environment, HttpOnly cookie.
const sessions = new Map<string, number>();
const SESSION_MS = 12 * 3600_000;
const attempts = new Map<string, { n: number; until: number }>();
function isAdmin(req: express.Request) {
  const m = /(?:^|;\s*)bvs_admin=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
  const exp = m ? sessions.get(m[1]) : undefined;
  return !!exp && exp > Date.now();
}
const requireAdmin: express.RequestHandler = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'admin only' }));

app.get('/api/admin/session', (req, res) => res.json({ admin: isAdmin(req) }));
app.post('/api/admin/login', (req, res) => {
  const ip = req.socket.remoteAddress ?? '?';
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return res.status(429).json({ error: 'too many attempts' });
  const pw = String(req.body?.password ?? '');
  const ok =
    !!env.adminPassword &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(pw).digest(), crypto.createHash('sha256').update(env.adminPassword).digest());
  if (!ok) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return res.status(401).json({ ok: false });
  }
  attempts.delete(ip);
  const token = randomToken();
  sessions.set(token, Date.now() + SESSION_MS);
  res.setHeader(
    'Set-Cookie',
    `bvs_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${env.cookieSecure ? '; Secure' : ''}`,
  );
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  const m = /bvs_admin=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
  if (m) sessions.delete(m[1]);
  res.setHeader('Set-Cookie', 'bvs_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/state', requireAdmin, (_req, res) => {
  const body: AdminState = {
    config: settings.config,
    providers: settings.providers,
    demoConfig: demoConfig(),
    secrets: secretPresence(),
    secretSources: secretSources(),
    adapterStatus: {
      ...Object.fromEntries(Object.entries(live.status).map(([k, v]) => [k, v.view()])),
      pumpFunChat: PUMP_FUN_CHAT_STATUS,
    },
  };
  res.json(body);
});

// Keys typed into the admin screen: stored server-side, never echoed back.
app.post('/api/admin/secrets', requireAdmin, (req, res) => {
  const changed = updateStoredSecrets(req.body && typeof req.body === 'object' ? req.body : {});
  live.restart();
  log(`admin updated keys: ${changed.join(', ') || 'none'}`); // names only, never values
  res.json({ ok: true, changed });
});

app.post('/api/admin/config', requireAdmin, (req, res) => {
  const next = { ...settings };
  if (req.body?.config) next.config = mergeConfig(DEFAULT_CONFIG, req.body.config);
  if (req.body?.providers) next.providers = { ...DEFAULT_PROVIDERS, ...req.body.providers };
  const errors = validateConfig(next.config);
  if (errors.length) return res.json({ ok: false, errors });
  const mintChanged = next.config.token.mint !== settings.config.token.mint;
  settings = next;
  settingsFile.write(settings);
  if (mintChanged) engines.live.reload(); // progress is scoped to the mint
  live.restart();
  log('admin updated settings');
  res.json({ ok: true, errors: [] });
});

// Demo controls: admin-only, and only ever touch the demo engine.
let demoLogBuffer: string[] | null = null;
app.post('/api/admin/demo', requireAdmin, (req, res) => {
  const action = String(req.body?.action) as DemoAction;
  if (!DEMO_ACTIONS.includes(action)) return res.status(400).json({ error: 'unknown action' });
  demoLogBuffer = [];
  runDemoAction(sim, action, req.body?.arg);
  const lines = demoLogBuffer;
  demoLogBuffer = null;
  res.json({ log: lines });
});
app.post('/api/admin/demo/reset', requireAdmin, (_req, res) => {
  runDemoAction(sim, 'reset');
  res.json({ ok: true });
});

// Live inputs.
app.post('/api/webhooks/helius', (req, res) => {
  res.sendStatus(live.handleWebhook(req.headers.authorization, req.body));
});
app.post('/api/chat/relay', (req, res) => {
  if (settings.providers.chat !== 'relay') return res.sendStatus(409);
  if (!verifyRelaySignature((req as any).rawBody ?? Buffer.alloc(0), req.header('x-relay-signature'), env.chatRelaySecret)) return res.sendStatus(401);
  let n = 0;
  for (const m of parseRelayMessages(req.body)) if (engines.live.ingestChat(m) === 'reaction') n++;
  res.json({ reactions: n });
});

// Static client.
const clientDist = new URL('../../client/dist', import.meta.url).pathname;
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: 'index.html' }));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ---------------------------------------------------------------- websockets

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients: Record<Mode, Set<WebSocket>> = { live: new Set(), demo: new Set() };

wss.on('connection', (ws, req) => {
  const mode: Mode = new URL(req.url ?? '/', 'http://x').searchParams.get('mode') === 'demo' ? 'demo' : 'live';
  clients[mode].add(ws);
  // Joining viewers get the current state only; no historical celebrations.
  ws.send(JSON.stringify({ kind: 'snapshot', seq: engines[mode].lastSeq, snapshot: engines[mode].snapshot() }));
  ws.on('close', () => clients[mode].delete(ws));
  // Viewers are read-only: incoming frames are ignored.
  ws.on('message', () => {});
});

for (const mode of ['live', 'demo'] as Mode[]) {
  engines[mode].on((event: GameEvent) => {
    const msg = JSON.stringify({ kind: 'event', event });
    for (const c of clients[mode]) if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function broadcastDemoLog(line: string) {
  demoLogBuffer?.push(line);
  const msg = JSON.stringify({ kind: 'demoLog', line });
  for (const c of clients.demo) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

server.listen(env.port, () => {
  log(`Buy vs. Sell server on http://localhost:${env.port}`);
  if (!env.adminPassword) log('ADMIN_PASSWORD is not set: the admin screen and demo controls are disabled.');
  if (!settings.config.token.mint) log('No token mint configured: live mode is idle; demo mode is available at /?mode=demo');
});

const shutdown = () => {
  store.flush();
  live.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
