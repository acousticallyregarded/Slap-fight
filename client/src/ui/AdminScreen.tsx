import { useEffect, useState } from 'react';
import { isValidMint, type AdminState, type GameConfig, type ProviderSettings } from '@bvs/shared';
import type { Transport } from '../transport/types';
import { DemoPanel } from './DemoPanel';
import { KeysEditor } from './KeysEditor';

export function AdminScreen({ transport, onClose }: { transport: Transport; onClose: () => void }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [state, setState] = useState<AdminState | null>(null);
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const [prov, setProv] = useState<ProviderSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const local = transport.kind === 'local';

  const load = async () => {
    const s = await transport.admin.load();
    setState(s);
    setCfg(structuredClone(local ? s.demoConfig : s.config));
    setProv(structuredClone(s.providers));
  };

  useEffect(() => {
    transport.admin
      .isAdmin()
      .then((a) => {
        setAuthed(a);
        if (a) void load();
      })
      .catch(() => setAuthed(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (await transport.admin.login(pw)) {
      setAuthed(true);
      setPw('');
      await load();
    } else setErr('Wrong password, or admin login is disabled (ADMIN_PASSWORD not set).');
  };

  const save = async () => {
    if (!cfg || !prov) return;
    const res = await transport.admin.save(local ? { demoConfig: cfg } : { config: cfg, providers: prov });
    setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.errors.join(' ') });
    if (res.ok) await load();
  };

  if (authed === null) return <div className="admin"><p>Loading…</p></div>;
  if (!authed)
    return (
      <div className="admin">
        <header className="admin-head">
          <h1>Administrator</h1>
          <button onClick={onClose}>Back to arena</button>
        </header>
        <form className="login" onSubmit={login}>
          <label>
            Admin password
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </label>
          <button type="submit">Sign in</button>
          {err && <p className="error">{err}</p>}
          <p className="muted tiny">Viewers never need a wallet or an account. This screen is only for the operator.</p>
        </form>
      </div>
    );
  if (!cfg || !prov || !state) return <div className="admin"><p>Loading…</p></div>;

  const set = <K extends keyof GameConfig>(k: K, v: Partial<GameConfig[K]>) => setCfg({ ...cfg, [k]: { ...cfg[k], ...v } });
  const mintProblem = cfg.token.mint && !isValidMint(cfg.token.mint) ? 'Not a valid base58 Solana address.' : '';

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>Administrator {local && <span className="badge warn">standalone demo: settings apply to this browser only</span>}</h1>
        <div>
          {!local && <button onClick={() => transport.admin.logout().then(() => setAuthed(false))}>Sign out</button>}
          <button onClick={onClose}>Back to arena</button>
        </div>
      </header>

      <div className="admin-grid">
        <fieldset>
          <legend>Token</legend>
          <label>
            Name
            <input value={cfg.token.name} onChange={(e) => set('token', { name: e.target.value })} />
          </label>
          <label>
            Symbol
            <input value={cfg.token.symbol} onChange={(e) => set('token', { symbol: e.target.value })} />
          </label>
          <label>
            Mint address
            <input
              value={cfg.token.mint}
              disabled={local}
              placeholder="Set after launch"
              onChange={(e) => set('token', { mint: e.target.value.trim() })}
            />
            {local && <small className="muted">The demo always uses its own simulated mint.</small>}
            {mintProblem && <small className="error">{mintProblem}</small>}
            {!local && <small className="muted">Progress is stored per mint. Changing it switches to that mint's progress.</small>}
          </label>
        </fieldset>

        <fieldset>
          <legend>Trades</legend>
          <label>
            Slap threshold (USD, inclusive)
            <input value={cfg.trades.slapThresholdUsd} onChange={(e) => set('trades', { slapThresholdUsd: e.target.value })} />
          </label>
          <label>
            Required confirmation
            <select value={cfg.trades.requiredConfirmation} onChange={(e) => set('trades', { requiredConfirmation: e.target.value as 'confirmed' | 'finalized' })}>
              <option value="confirmed">confirmed (supermajority vote)</option>
              <option value="finalized">finalized (max lockout)</option>
            </select>
          </label>
          <label>
            Price tolerance (seconds from trade time)
            <input type="number" value={cfg.trades.priceToleranceMs / 1000} onChange={(e) => set('trades', { priceToleranceMs: Number(e.target.value) * 1000 })} />
          </label>
          <label>
            Max playback speed under load
            <input type="number" step="0.1" value={cfg.playback.maxSpeed} onChange={(e) => set('playback', { maxSpeed: Number(e.target.value) })} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Show extras</legend>
          <label>
            Whale slap at (USD)
            <input value={cfg.fun.whaleUsd} onChange={(e) => set('fun', { whaleUsd: e.target.value })} />
          </label>
          <label>
            Combo after (slaps in a row)
            <input type="number" min={2} value={cfg.fun.comboMin} onChange={(e) => set('fun', { comboMin: Number(e.target.value) })} />
          </label>
          <label>
            Hype meter full at (USD traded in 5 min)
            <input type="number" value={cfg.fun.hypeFullUsd} onChange={(e) => set('fun', { hypeFullUsd: Number(e.target.value) })} />
          </label>
          <small className="muted">Show only: these never change which trades slap or when outfits unlock.</small>
        </fieldset>

        <fieldset>
          <legend>Outfit milestones</legend>
          <label>
            Thresholds (USD, comma-separated)
            <input
              value={cfg.milestones.thresholdsUsd.join(', ')}
              onChange={(e) => set('milestones', { thresholdsUsd: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)) })}
            />
          </label>
          <label>
            Confirm with N consecutive samples
            <input type="number" min={1} value={cfg.milestones.confirmSamples} onChange={(e) => set('milestones', { confirmSamples: Number(e.target.value) })} />
          </label>
          <label>
            …spanning at least (seconds)
            <input type="number" min={0} value={cfg.milestones.confirmDurationMs / 1000} onChange={(e) => set('milestones', { confirmDurationMs: Number(e.target.value) * 1000 })} />
          </label>
          <label>
            Market data stale after (seconds)
            <input type="number" value={cfg.milestones.staleAfterMs / 1000} onChange={(e) => set('milestones', { staleAfterMs: Number(e.target.value) * 1000 })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={cfg.milestones.allowFdv} onChange={(e) => set('milestones', { allowFdv: e.target.checked })} />
            Allow FDV to count toward unlocks (always labeled FDV)
          </label>
        </fieldset>

        <fieldset>
          <legend>Chat reactions</legend>
          <label>
            Per-character cooldown (seconds)
            <input type="number" value={cfg.chat.perCharacterCooldownMs / 1000} onChange={(e) => set('chat', { perCharacterCooldownMs: Number(e.target.value) * 1000 })} />
          </label>
          <label>
            Per-sender cooldown (seconds)
            <input type="number" value={cfg.chat.perSenderCooldownMs / 1000} onChange={(e) => set('chat', { perSenderCooldownMs: Number(e.target.value) * 1000 })} />
          </label>
          <label>
            Drop reactions older than (seconds)
            <input type="number" value={cfg.chat.maxReactionAgeMs / 1000} onChange={(e) => set('chat', { maxReactionAgeMs: Number(e.target.value) * 1000 })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={cfg.chat.showBubbles} onChange={(e) => set('chat', { showBubbles: e.target.checked })} />
            Show preset speech bubbles
          </label>
        </fieldset>

        <fieldset className={local ? 'disabled' : ''}>
          <legend>Providers</legend>
          {local && <p className="muted tiny">Live providers run on the Node server only. This standalone demo has no live mode.</p>}
          <label>
            Confirmed swaps
            <select disabled={local} value={prov.swaps} onChange={(e) => setProv({ ...prov, swaps: e.target.value as ProviderSettings['swaps'] })}>
              <option value="none">None</option>
              <option value="solana-rpc">Solana chain: pump.fun's own trade records via SOLANA_RPC_URL (free Helius works)</option>
              <option value="helius-webhook">Helius enhanced webhook (+ history backfill)</option>
              <option value="pumpportal">PumpPortal trade stream (third-party) + RPC confirmation</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" disabled={local} checked={prov.heliusBackfill} onChange={(e) => setProv({ ...prov, heliusBackfill: e.target.checked })} />
            Backfill from Helius history after gaps
          </label>
          <label>
            SOL/USD at trade time
            <select disabled={local} value={prov.quotePrice} onChange={(e) => setProv({ ...prov, quotePrice: e.target.value as ProviderSettings['quotePrice'] })}>
              <option value="pyth">Pyth Benchmarks (historical, official)</option>
              <option value="birdeye">Birdeye historical_price_unix</option>
              <option value="jupiter-live">Jupiter Price v3 (live samples only)</option>
            </select>
          </label>
          <label>
            Market cap
            <select disabled={local} value={prov.marketCap} onChange={(e) => setProv({ ...prov, marketCap: e.target.value as ProviderSettings['marketCap'] })}>
              <option value="none">None</option>
              <option value="trades">From each trade (Solana chain; needs Trades = Solana chain)</option>
              <option value="dexscreener">DexScreener (free, no key)</option>
              <option value="pumpportal">PumpPortal (sent with each trade; needs Trades = PumpPortal)</option>
              <option value="birdeye">Birdeye token overview (circulating market cap)</option>
            </select>
          </label>
          <label>
            Market-cap poll interval (seconds)
            <input type="number" disabled={local} value={prov.marketCapPollMs / 1000} onChange={(e) => setProv({ ...prov, marketCapPollMs: Number(e.target.value) * 1000 })} />
          </label>
          <label>
            pump.fun chat
            <select disabled={local} value={prov.chat} onChange={(e) => setProv({ ...prov, chat: e.target.value as ProviderSettings['chat'] })}>
              <option value="none">None (no official pump.fun chat API exists)</option>
              <option value="relay">Authenticated relay you operate</option>
              <option value="pump-chat-client">Unofficial reader: pump-chat-client (read-only, may break without notice)</option>
            </select>
          </label>
          <h4>API keys</h4>
          <KeysEditor transport={transport} state={state} onSaved={async () => setState(await transport.admin.load())} />
          <ul className="secrets">
            <li>
              <code>ADMIN_PASSWORD</code> <span className={`badge ${state.secrets.ADMIN_PASSWORD ? 'ok' : 'off'}`}>{state.secrets.ADMIN_PASSWORD ? 'set' : 'not set'}</span>
              <span className="muted small"> (only in .env)</span>
            </li>
          </ul>
          <h4>Adapter status</h4>
          <ul className="secrets">
            {Object.entries(state.adapterStatus).map(([k, v]) => (
              <li key={k}>
                <b>{k}</b> <span className="badge">{v.state}</span> <span className="muted small">{v.detail}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <div className="admin-actions">
        <button className="primary" onClick={save}>
          Save settings
        </button>
        {msg && <span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span>}
      </div>

      <div className="admin-demo">
        <p className="muted">Demo controls only ever reach the separate demo game ({local ? 'this page' : 'viewers at ?mode=demo'}); they cannot inject events into the live game.</p>
        <DemoPanel transport={transport} open={true} setOpen={() => {}} />
      </div>
    </div>
  );
}

