import {
  DEFAULT_CONFIG, DEFAULT_DEMO_OVERRIDES, DEFAULT_PROVIDERS, DEMO_MINT, DemoSimulator, GameEngine, PriceBook,
  mergeConfig, runDemoAction, validateConfig,
  type DemoAction, type EngineStore, type GameConfig, type GameEvent, type PersistedState, type Snapshot,
} from '@bvs/shared';
import type { AdminApi, Transport } from './types';

const CONFIG_KEY = 'bvs.demo.config.v1';

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: progress lasts for this tab only */
  }
}

/** Browser storage for the standalone demo. The server build persists on disk instead. */
class LocalStore implements EngineStore {
  private mem = new Map<string, PersistedState>();
  load(key: string) {
    const raw = safeGet('bvs.state.' + key);
    if (raw) {
      try {
        return JSON.parse(raw) as PersistedState;
      } catch {
        /* ignore corrupt state */
      }
    }
    return this.mem.get(key) ?? null;
  }
  save(key: string, s: PersistedState) {
    this.mem.set(key, s);
    safeSet('bvs.state.' + key, JSON.stringify(s));
  }
  remove(key: string) {
    this.mem.delete(key);
    safeSet('bvs.state.' + key, null);
  }
}

function loadDemoConfig(): GameConfig {
  const base = mergeConfig(DEFAULT_CONFIG, { ...DEFAULT_DEMO_OVERRIDES, token: { name: 'Buy vs. Sell (demo)', symbol: 'DEMO', mint: DEMO_MINT } } as any);
  const saved = safeGet(CONFIG_KEY);
  if (!saved) return base;
  try {
    const c = mergeConfig(base, JSON.parse(saved));
    c.token.mint = DEMO_MINT; // demo events are always scoped to the demo mint
    return c;
  } catch {
    return base;
  }
}

/**
 * Runs the real engine and demo simulator in the browser. Used by the
 * standalone demo build; there is no live mode here.
 */
export class LocalTransport implements Transport {
  kind = 'local' as const;
  mode = 'demo' as const;
  private config = loadDemoConfig();
  private prices = new PriceBook();
  private engine = new GameEngine({ mode: 'demo', config: () => this.config, prices: this.prices, store: new LocalStore() });
  private logListeners = new Set<(l: string) => void>();
  private sim = new DemoSimulator(this.engine, this.prices, (l) => this.logListeners.forEach((cb) => cb(l)));
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe(onSnapshot: (s: Snapshot) => void, onEvent: (e: GameEvent) => void, onStatus: (o: boolean) => void) {
    const off = this.engine.on(onEvent);
    onSnapshot(this.engine.snapshot());
    onStatus(true);
    this.sim.startFeed(8000);
    this.timer = setInterval(() => this.engine.tick(), 2000);
    return () => {
      off();
      this.sim.stopFeed();
      if (this.timer) clearInterval(this.timer);
    };
  }

  admin: AdminApi = {
    isAdmin: async () => true,
    login: async () => true,
    logout: async () => {},
    load: async () => ({
      config: this.config,
      demoConfig: this.config,
      providers: DEFAULT_PROVIDERS,
      secrets: {},
      adapterStatus: {
        swaps: { state: 'unavailable', detail: 'Standalone demo build: live adapters run only on the Node server.' },
        marketCap: { state: 'unavailable', detail: 'Standalone demo build.' },
        chat: { state: 'unavailable', detail: 'No verified official pump.fun chat API exists (see docs/INTEGRATIONS.md).' },
      },
    }),
    save: async (patch) => {
      const next = patch.demoConfig ?? patch.config;
      if (!next) return { ok: true, errors: [] };
      const c = { ...next, token: { ...next.token, mint: DEMO_MINT } };
      const errors = validateConfig(c);
      if (errors.length) return { ok: false, errors };
      this.config = c;
      safeSet(CONFIG_KEY, JSON.stringify(c));
      return { ok: true, errors: [] };
    },
    demo: async (action: DemoAction, arg?: string | number) => {
      runDemoAction(this.sim, action, arg);
      return [];
    },
    resetDemo: async () => {
      runDemoAction(this.sim, 'reset');
    },
    // The standalone demo has no server, so there is nowhere safe to keep keys.
    saveSecrets: async () => ({ ok: false, changed: [] }),
  };

  onDemoLog(cb: (l: string) => void) {
    this.logListeners.add(cb);
    return () => void this.logListeners.delete(cb);
  }
}
