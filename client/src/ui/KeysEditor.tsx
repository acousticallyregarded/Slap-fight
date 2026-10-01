import { useState } from 'react';
import type { AdminState } from '@bvs/shared';
import type { Transport } from '../transport/types';

/** What each key is for, in the admin screen's words. */
const HELP: Record<string, string> = {
  PUMPPORTAL_API_KEY: 'PumpPortal (paid; optional): trades and market cap',
  SOLANA_RPC_URL: 'Solana RPC link (Helius free plan works): reads and confirms trades on chain',
  SOLANA_WS_URL: 'Solana WebSocket link (optional; only if it is not the RPC link with wss://)',
  HELIUS_API_KEY: 'Helius webhook mode (alternative trade source)',
  HELIUS_WEBHOOK_AUTH: 'Helius webhook shared secret',
  BIRDEYE_API_KEY: 'Birdeye market cap (optional)',
  JUPITER_API_KEY: 'Jupiter SOL price (optional; works without)',
  PYTH_API_KEY: 'Pyth price history (optional)',
  PYTH_SOL_USD_FEED_ID: 'Pyth SOL/USD feed id (optional)',
  CHAT_RELAY_SECRET: 'Chat relay shared secret (only for your own relay)',
};

const SOURCE: Record<string, string> = { admin: 'set here', env: 'set in .env', unset: 'not set' };

/**
 * Provider keys typed on the admin screen. They go to the server once and are
 * stored there; the page never receives a key back, only whether it is set.
 */
export function KeysEditor({ transport, state, onSaved }: { transport: Transport; state: AdminState; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sources = state.secretSources;
  if (transport.kind === 'local' || !sources) {
    return <p className="muted small">Keys can only be entered when the game runs on its server (not in the standalone demo).</p>;
  }
  const insecure = location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  const send = async (patch: Record<string, string>) => {
    setMsg(null);
    try {
      const r = await transport.admin.saveSecrets(patch);
      setDraft({});
      await onSaved();
      setMsg({ ok: r.ok, text: r.ok ? `Saved: ${r.changed.join(', ')}. Live data restarted.` : 'Not saved.' });
    } catch (e) {
      setMsg({ ok: false, text: `Not saved: ${String((e as Error).message).slice(0, 120)}` });
    }
  };
  const pending = Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim()));

  return (
    <div className="keys">
      {insecure && <p className="error small">This page is not on https, so keys typed here would cross the network unencrypted. Use https, or put them in .env on the server.</p>}
      {Object.entries(sources).map(([name, src]) => (
        <label key={name} className="key-row">
          <span>
            <code>{name}</code> <span className={`badge ${src === 'unset' ? 'off' : 'ok'}`}>{SOURCE[src]}</span>
            <span className="muted small"> {HELP[name] ?? ''}</span>
          </span>
          <span className="key-input">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={src === 'unset' ? 'paste key' : 'paste to replace'}
              value={draft[name] ?? ''}
              onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
            />
            {src === 'admin' && (
              <button type="button" onClick={() => void send({ [name]: '' })} title="Remove the key saved here (falls back to .env)">
                Clear
              </button>
            )}
          </span>
        </label>
      ))}
      <div className="admin-actions">
        <button type="button" className="primary" disabled={!Object.keys(pending).length} onClick={() => void send(pending)}>
          Save keys
        </button>
        {msg && <span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span>}
      </div>
      <p className="muted small">Keys are stored on the server (data/secrets.json, readable only by the server's user) and never shown again. A key saved here overrides the same one in .env.</p>
    </div>
  );
}
