import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  abbreviateMint, formatUsd,
  type ChatReaction, type CharacterId, type ConnectionState, type FeedTrade, type FunSnapshot, type GameEvent, type MarketState, type Snapshot,
} from '@bvs/shared';
import { Callout, CheerBar, ComboBadge, HypeMeter, RecordChip } from './Hud';
import { ShareCard } from './ShareCard';
import type { Director } from '../game/Director';
import { Sfx } from '../game/sfx';
import type { Arena } from '../pixi/Arena';
import type { Transport } from '../transport/types';
import { StageView } from './StageView';
import { DemoPanel } from './DemoPanel';
import { AdminScreen } from './AdminScreen';
import { REACTION_LABELS } from './labels';

type Tone = 'buy' | 'sell' | 'unlock' | 'final' | 'info';

function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : s === '1';
    } catch {
      return initial;
    }
  });
  const set = (nv: boolean) => {
    setV(nv);
    try {
      localStorage.setItem(key, nv ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  };
  return [v, set];
}

export function App({ transport }: { transport: Transport }) {
  const sfx = useMemo(() => new Sfx(), []);
  const director = useRef<Director | null>(null);
  const [ready, setReady] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [counters, setCounters] = useState({ buy: 0, sell: 0 });
  const [stageShown, setStageShown] = useState(0);
  const [market, setMarket] = useState<MarketState | null>(null);
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({});
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  const [reactions, setReactions] = useState<ChatReaction[]>([]);
  const [queued, setQueued] = useState(0);
  const [pendingPrice, setPendingPrice] = useState(0);
  const [banner, setBanner] = useState<{ text: string; tone: Tone; id: number } | null>(null);
  const [sound, setSound] = usePref('bvs.sound', false);
  const [reduced, setReduced] = usePref('bvs.reducedMotion', typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [route, setRoute] = useState(() => location.hash);
  const [isAdmin, setIsAdmin] = useState(transport.kind === 'local');
  const [panelOpen, setPanelOpen] = useState(true);
  const bannerTimer = useRef<ReturnType<typeof setTimeout>>();
  const bannerId = useRef(0);
  const arena = useRef<Arena | null>(null);
  const [fun, setFun] = useState<FunSnapshot | null>(null);
  const funRef = useRef<FunSnapshot | null>(null);
  const [combo, setCombo] = useState<{ side: CharacterId | null; count: number }>({ side: null, count: 0 });
  const [callout, setCallout] = useState<{ text: string; tone: CharacterId | 'gold'; id: number } | null>(null);
  const calloutTimer = useRef<ReturnType<typeof setTimeout>>();
  const countersRef = useRef(counters);
  countersRef.current = counters;
  const [sharing, setSharing] = useState(false);
  const soundRef = useRef(false);

  useEffect(() => {
    const on = () => setRoute(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    sfx.setEnabled(sound);
    soundRef.current = sound;
    if (sound) sfx.setHype(funRef.current?.hype ?? 0);
  }, [sound, sfx]);
  useEffect(() => {
    if (director.current) director.current.reducedMotion = reduced;
    document.documentElement.dataset.reducedMotion = reduced ? '1' : '0';
  }, [reduced, ready]);
  useEffect(() => {
    transport.admin.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [transport, route]);

  const announce = useCallback((text: string, tone: Tone) => {
    clearTimeout(bannerTimer.current);
    setBanner({ text, tone, id: ++bannerId.current });
    bannerTimer.current = setTimeout(() => setBanner(null), tone === 'final' ? 4200 : 2600);
  }, []);

  /** Show extras changed: meters, crowd lights and noise follow. */
  const applyFun = useCallback(
    (f: FunSnapshot | undefined, fresh: boolean) => {
      if (!f) return;
      const prev = funRef.current;
      funRef.current = f;
      setFun(f);
      if (director.current) director.current.comboMin = f.comboMin ?? 3;
      arena.current?.setHype(f.hype);
      arena.current?.setCheers(f.cheers.buy, f.cheers.sell);
      sfx.setHype(f.hype);
      if (fresh && prev) {
        for (const side of ['buy', 'sell'] as const) {
          if (f.cheers[side] > prev.cheers[side]) {
            arena.current?.crowdCheer(side);
            sfx.crowdCheer(0.3);
          }
        }
      }
    },
    [sfx],
  );

  const showCallout = useCallback((text: string, tone: CharacterId | 'gold') => {
    clearTimeout(calloutTimer.current);
    setCallout({ text, tone, id: ++bannerId.current });
    calloutTimer.current = setTimeout(() => setCallout(null), 1500);
  }, []);

  const applySnapshot = useCallback((s: Snapshot) => {
    setSnap(s);
    setCounters(s.slaps);
    setMarket(s.market);
    setConnections(s.connections);
    setTrades(s.recentTrades);
    setReactions(s.recentReactions);
    setPendingPrice(s.pendingPriceCount);
    director.current?.clear();
    director.current?.showStage(s.unlockedStage);
    setStageShown(s.unlockedStage);
    applyFun(s.fun, false);
    setCombo(s.fun ? { ...s.fun.streak } : { side: null, count: 0 });
  }, [applyFun]);

  const onEvent = useCallback(
    (e: GameEvent) => {
      const d = director.current;
      switch (e.type) {
        case 'slap':
          setTrades((t) => [e.trade, ...t].slice(0, 12));
          d?.enqueue(e);
          break;
        case 'outfitUnlock':
          d?.enqueue(e);
          break;
        case 'celebrate':
          setTrades((t) => [e.trade, ...t].slice(0, 12));
          d?.enqueue(e);
          break;
        case 'chatReaction':
          setReactions((r) => [e.reaction, ...r].slice(0, 8));
          d?.enqueueChat(e.reaction);
          break;
        case 'correction':
          setCounters((c) => ({ ...c, [e.side]: Math.max(0, c[e.side] - 1) }));
          setTrades((t) => t.map((x) => (x.eventId === e.eventId ? { ...x, corrected: true } : x)));
          announce(`Correction: a ${e.side} was not finalized`, 'info');
          break;
        case 'market':
          setMarket(e.market);
          setSnap((s) => (s ? { ...s, nextMilestone: e.nextMilestone, market: e.market } : s));
          break;
        case 'connection':
          setConnections(e.connections);
          break;
        case 'pending':
          setPendingPrice(e.pendingPriceCount);
          break;
        case 'reset':
          applySnapshot(e.snapshot);
          break;
        case 'fun':
          applyFun(e.fun, true);
          break;
      }
    },
    [announce, applySnapshot, applyFun],
  );

  // Subscribe once the stage (and its Director) exists so nothing is missed.
  useEffect(() => {
    if (!ready) return;
    return transport.subscribe(applySnapshot, onEvent, setOnline);
  }, [ready, transport, applySnapshot, onEvent]);

  const hooks = useMemo(
    () => ({
      announce,
      landed: (who: CharacterId) => setCounters((c) => ({ ...c, [who]: c[who] + 1 })),
      pending: setQueued,
      stageShown: setStageShown,
      combo: (side: CharacterId, count: number) => setCombo({ side, count }),
      callout: showCallout,
      leader: (): CharacterId | null => {
        const c = countersRef.current;
        return c.buy === c.sell ? null : c.buy > c.sell ? 'buy' : 'sell';
      },
    }),
    [announce, showCallout],
  );

  const onReady = useCallback((d: Director, a: Arena) => {
    director.current = d;
    arena.current = a;
    d.reducedMotion = reduced;
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (director.current && snap) {
      director.current.maxChatAgeMs = 6000;
    }
  }, [snap]);
  useEffect(() => {
    if (arena.current) arena.current.reducedMotion = reduced;
  }, [reduced, ready]);

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  const isDemo = transport.mode === 'demo';
  const milestones = snap?.milestones ?? [20000, 40000, 60000, 80000, 100000];
  const next = milestones[stageShown] ?? null;
  const token = snap?.token;

  if (route.startsWith('#admin')) {
    return <AdminScreen transport={transport} onClose={() => (location.hash = '')} />;
  }

  return (
    <div className={`app ${isDemo ? 'is-demo' : ''}`}>
      {isDemo && (
        <div className="demo-ribbon" role="status">
          DEMO MODE — SIMULATED EVENTS
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="b">BUY</span>
          <span className="vs">vs.</span>
          <span className="s">SELL</span>
        </div>
        <div className="token">
          <div className="token-name">
            {token?.name ?? '—'} <span className="sym">${token?.symbol ?? ''}</span>
          </div>
          <div className="mint" title={token?.mint || 'Mint not configured'}>
            Mint {abbreviateMint(token?.mint ?? '')}
          </div>
        </div>
        <ConnectionPills online={online} connections={connections} demo={isDemo} />
        <div className="mc">
          <MarketCapLine market={market} />
        </div>
        <div className="controls">
          <button className="icon" aria-pressed={sound} onClick={() => setSound(!sound)} title="Sound">
            {sound ? '🔊' : '🔈'}
            <span>Sound</span>
          </button>
          <button className="icon" aria-pressed={reduced} onClick={() => setReduced(!reduced)} title="Reduced motion">
            {reduced ? '◼' : '◇'}
            <span>Reduce motion</span>
          </button>
          <button className="icon" onClick={toggleFullscreen} title="Fullscreen">
            ⛶<span>Fullscreen</span>
          </button>
          <a className="icon" href="#admin" title="Admin">
            ⚙<span>Admin</span>
          </a>
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          <StageView hooks={hooks} sfx={sfx} onReady={onReady} />
          <div className="plate left">
            <div className="name">BUY</div>
            <div className="count" aria-label="Buy slaps landed">
              <b>{counters.buy}</b> slaps landed
            </div>
          </div>
          <div className="plate right">
            <div className="name">SELL</div>
            <div className="count" aria-label="Sell slaps landed">
              <b>{counters.sell}</b> slaps landed
            </div>
          </div>
          <OutfitProgress stage={stageShown} milestones={milestones} next={next} market={market} />
          <div className="hud-left">
            <HypeMeter fun={fun} />
          </div>
          <div className="hud-right">
            <CheerBar fun={fun} demo={isDemo} />
            <RecordChip best={fun?.bestToday ?? null} onShare={() => setSharing(true)} />
          </div>
          <ComboBadge side={combo.side} count={combo.count} min={fun?.comboMin ?? 3} />
          {callout && <Callout {...callout} />}
          {banner && (
            <div key={banner.id} className={`banner tone-${banner.tone}`} role="status" aria-live="polite">
              {banner.text}
            </div>
          )}
          {queued > 0 && <div className="queue-pill">{queued} pending event{queued === 1 ? '' : 's'} · playing at {director.current?.speed.toFixed(1)}×</div>}
          {pendingPrice > 0 && <div className="price-pill">{pendingPrice} trade{pendingPrice === 1 ? '' : 's'} awaiting verified price</div>}
          {sharing && fun?.bestToday && arena.current && (
            <ShareCard arena={arena.current} best={fun.bestToday} token={token ?? { name: 'Buy vs. Sell', symbol: 'BVS' }} demo={isDemo} canDownload={transport.kind !== 'local'} onClose={() => setSharing(false)} />
          )}
          {!isDemo && !token?.mint && (
            <div className="notice">Live game not configured yet: no token mint set. <a href="?mode=demo">Watch the demo</a></div>
          )}
        </section>

        <aside className="side">
          <section className="panel">
            <h2>Recent qualifying trades</h2>
            {trades.length === 0 && <p className="muted">No qualifying trades yet.</p>}
            <ul className="feed">
              {trades.map((t) => (
                <li key={t.eventId} className={`trade ${t.side} ${t.corrected ? 'corrected' : ''}`}>
                  <span className="side-tag">{t.side.toUpperCase()}</span>
                  <span className="amt">{formatUsd(t.usdValue)}</span>
                  <span className="muted small">
                    {t.quoteAmount.length > 10 ? Number(t.quoteAmount).toFixed(4) : t.quoteAmount} {t.quoteAsset}
                  </span>
                  <time className="muted small">{new Date(t.timestamp).toLocaleTimeString()}</time>
                  {t.corrected && <span className="small warn">corrected</span>}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Chat reactions</h2>
            {reactions.length === 0 && <p className="muted">No reactions yet.</p>}
            <ul className="feed compact">
              {reactions.map((r) => (
                <li key={r.id}>
                  <span className={`who ${r.target}`}>{r.target === 'both' ? 'BOTH' : r.target.toUpperCase()}</span>
                  <span>{REACTION_LABELS[r.category]}</span>
                  <span className="muted small">
                    {r.senderLabel}
                    {r.displayText ? `: “${r.displayText}”` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted tiny">{isDemo
                ? 'Simulated chat messages (demo).'
                : connections.chatUnofficial === 'connected'
                  ? 'From the token’s pump.fun chat, read through an unofficial client (not a pump.fun API). Reactions come from a fixed library; chat text is never executed or shown if explicit.'
                  : 'Reactions come from a fixed library; chat text is never executed or shown if explicit.'}</p>
          </section>
          {isDemo && isAdmin && (
            <DemoPanel transport={transport} open={panelOpen} setOpen={setPanelOpen} />
          )}
          {isDemo && !isAdmin && (
            <section className="panel">
              <p className="muted">Demo controls are available to the administrator.</p>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

function ConnectionPills({ online, connections, demo }: { online: boolean; connections: Record<string, ConnectionState>; demo: boolean }) {
  const items: [string, string][] = [
    ['swaps', 'Trades'],
    ['marketCap', 'Market cap'],
    ['chat', 'Chat'],
  ];
  return (
    <div className="conn" aria-label="Connection status">
      <span className={`pill ${online ? 'ok' : 'bad'}`}>{online ? (demo ? 'Demo feed' : 'Server') : 'Offline'}</span>
      {items.map(([k, name]) => {
        const label = k === 'chat' && connections.chatUnofficial === 'connected' ? 'pump.fun chat (unofficial)' : name;
        const st = connections[k] ?? 'unconfigured';
        const cls = st === 'connected' || st === 'demo' ? 'ok' : st === 'connecting' ? 'warn' : st === 'unconfigured' ? 'off' : 'bad';
        const text = st === 'demo' ? 'simulated' : st;
        return (
          <span key={k} className={`pill ${cls}`} title={`${label}: ${text}`}>
            {label}: {text}
          </span>
        );
      })}
    </div>
  );
}

function MarketCapLine({ market }: { market: MarketState | null }) {
  const s = market?.sample;
  if (!s) return <span className="muted">Market cap: —</span>;
  const label = s.kind === 'fdv' ? 'FDV' : 'Market cap';
  return (
    <span>
      {label}: <b>{formatUsd(s.value, false)}</b>
      {market?.stale && <span className="badge warn">stale</span>}
      {market?.invalidReason && s.kind !== 'fdv' && <span className="badge bad">{market.invalidReason}</span>}
      {s.kind === 'fdv' && <span className="badge warn">not circulating</span>}
    </span>
  );
}

function OutfitProgress({ stage, milestones, next, market }: { stage: number; milestones: number[]; next: number | null; market: MarketState | null }) {
  const s = market?.sample;
  const value = s ? Number(s.value) : 0;
  const prev = stage > 0 ? milestones[stage - 1] : 0;
  const pct = next ? Math.max(0, Math.min(1, (value - prev) / (next - prev))) : 1;
  const suspended = market?.stale || !!market?.invalidReason;
  return (
    <div className="outfit" aria-label="Outfit progress">
      {next ? (
        <div className="line1">Next outfit unlock: {formatUsd(next, false)}</div>
      ) : (
        <div className="line1 final">FINAL OUTFIT UNLOCKED!</div>
      )}
      <div className="line2">
        {s?.kind === 'fdv' ? 'FDV' : 'Market cap'}: {s ? formatUsd(s.value, false) : '—'}
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="pips">
        {milestones.map((m, i) => (
          <span key={m} className={i < stage ? 'on' : ''} title={formatUsd(m, false)} />
        ))}
      </div>
      {suspended && <div className="susp">Unlocks paused: {market?.stale ? 'market data stale' : market?.invalidReason}</div>}
    </div>
  );
}
