import fs from 'node:fs';
import path from 'node:path';

// All provider credentials stay on the server. They come from the environment
// (.env) or from the admin screen, which writes them to DATA_DIR/secrets.json
// (file mode 0600). They are never sent back to any browser.
export const env = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? new URL('../data', import.meta.url).pathname,
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  heliusApiKey: process.env.HELIUS_API_KEY ?? '',
  heliusWebhookAuth: process.env.HELIUS_WEBHOOK_AUTH ?? '',
  heliusBaseUrl: process.env.HELIUS_BASE_URL ?? 'https://mainnet.helius-rpc.com',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? '',
  birdeyeApiKey: process.env.BIRDEYE_API_KEY ?? '',
  jupiterApiKey: process.env.JUPITER_API_KEY ?? '',
  pythApiKey: process.env.PYTH_API_KEY ?? '',
  pythSolUsdFeedId: process.env.PYTH_SOL_USD_FEED_ID ?? '',
  pumpPortalApiKey: process.env.PUMPPORTAL_API_KEY ?? '',
  chatRelaySecret: process.env.CHAT_RELAY_SECRET ?? '',
  /** Optional: the RPC's WebSocket address when it is not the RPC link with wss://. */
  solanaWsUrl: process.env.SOLANA_WS_URL ?? '',
};

export function secretPresence(): Record<string, boolean> {
  return {
    ADMIN_PASSWORD: !!env.adminPassword,
    HELIUS_API_KEY: !!env.heliusApiKey,
    HELIUS_WEBHOOK_AUTH: !!env.heliusWebhookAuth,
    SOLANA_RPC_URL: !!env.solanaRpcUrl,
    SOLANA_WS_URL: !!env.solanaWsUrl,
    BIRDEYE_API_KEY: !!env.birdeyeApiKey,
    JUPITER_API_KEY: !!env.jupiterApiKey,
    PYTH_API_KEY: !!env.pythApiKey,
    PYTH_SOL_USD_FEED_ID: !!env.pythSolUsdFeedId,
    PUMPPORTAL_API_KEY: !!env.pumpPortalApiKey,
    CHAT_RELAY_SECRET: !!env.chatRelaySecret,
  };
}

/** Keys the admin screen may set, mapped to their env fields. ADMIN_PASSWORD is deliberately not here. */
export const EDITABLE_SECRETS = {
  PUMPPORTAL_API_KEY: 'pumpPortalApiKey',
  SOLANA_RPC_URL: 'solanaRpcUrl',
  SOLANA_WS_URL: 'solanaWsUrl',
  HELIUS_API_KEY: 'heliusApiKey',
  HELIUS_WEBHOOK_AUTH: 'heliusWebhookAuth',
  BIRDEYE_API_KEY: 'birdeyeApiKey',
  JUPITER_API_KEY: 'jupiterApiKey',
  PYTH_API_KEY: 'pythApiKey',
  PYTH_SOL_USD_FEED_ID: 'pythSolUsdFeedId',
  CHAT_RELAY_SECRET: 'chatRelaySecret',
} as const satisfies Record<string, keyof typeof env>;
export type EditableSecret = keyof typeof EDITABLE_SECRETS;

const fromEnvFile: Record<string, string> = Object.fromEntries(Object.values(EDITABLE_SECRETS).map((f) => [f, env[f]]));
const secretsPath = () => path.join(env.dataDir, 'secrets.json');
let stored: Partial<Record<EditableSecret, string>> = {};

/** Values saved from the admin screen win over .env; clearing one falls back to .env. */
function apply() {
  for (const [name, field] of Object.entries(EDITABLE_SECRETS) as [EditableSecret, keyof typeof env][]) {
    (env as Record<string, unknown>)[field] = stored[name] || fromEnvFile[field];
  }
}

export function loadStoredSecrets() {
  try {
    stored = JSON.parse(fs.readFileSync(secretsPath(), 'utf8'));
  } catch {
    stored = {};
  }
  apply();
}

/** Sets (non-empty string) or clears (empty string) admin-entered keys. Unknown names are ignored. */
export function updateStoredSecrets(patch: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const [name, value] of Object.entries(patch)) {
    if (!(name in EDITABLE_SECRETS) || typeof value !== 'string') continue;
    const v = value.trim().slice(0, 500);
    if (v) stored[name as EditableSecret] = v;
    else delete stored[name as EditableSecret];
    changed.push(name);
  }
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.writeFileSync(secretsPath() + '.tmp', JSON.stringify(stored, null, 2), { mode: 0o600 });
  fs.renameSync(secretsPath() + '.tmp', secretsPath());
  apply();
  return changed;
}

/** Where each key's current value comes from, for the admin screen. Never the value itself. */
export function secretSources(): Record<string, 'admin' | 'env' | 'unset'> {
  const out: Record<string, 'admin' | 'env' | 'unset'> = {};
  for (const [name, field] of Object.entries(EDITABLE_SECRETS) as [EditableSecret, keyof typeof env][])
    out[name] = stored[name] ? 'admin' : fromEnvFile[field] ? 'env' : 'unset';
  return out;
}
