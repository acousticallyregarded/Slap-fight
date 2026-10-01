import type { AdminState, DemoAction, GameConfig, GameEvent, Mode, ProviderSettings, Snapshot } from '@bvs/shared';

export interface Transport {
  /** `local`: the self-contained demo build (no server). `server`: talks to the Node server. */
  kind: 'local' | 'server';
  mode: Mode;
  subscribe(onSnapshot: (s: Snapshot) => void, onEvent: (e: GameEvent) => void, onStatus: (online: boolean) => void): () => void;
  admin: AdminApi;
  /** Demo simulator log lines (demo mode only). */
  onDemoLog(cb: (line: string) => void): () => void;
}

export interface AdminApi {
  /** True when this viewer may open admin tools (local demo, or a logged-in admin). */
  isAdmin(): Promise<boolean>;
  login(password: string): Promise<boolean>;
  logout(): Promise<void>;
  load(): Promise<AdminState>;
  save(patch: { config?: GameConfig; providers?: ProviderSettings; demoConfig?: GameConfig }): Promise<{ ok: boolean; errors: string[] }>;
  /** Demo controls are admin-only and only ever reach the demo engine. */
  demo(action: DemoAction, arg?: string | number): Promise<string[]>;
  resetDemo(): Promise<void>;
  /** Stores provider keys on the server ('' clears one). Values are never sent back. */
  saveSecrets(patch: Record<string, string>): Promise<{ ok: boolean; changed: string[] }>;
}
