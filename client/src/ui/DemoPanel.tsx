import { useEffect, useRef, useState } from 'react';
import { DEMO_CHAT_SAMPLES, type DemoAction } from '@bvs/shared';
import type { Transport } from '../transport/types';

type Btn = { label: string; action: DemoAction; arg?: string | number; hint?: string };

const GROUPS: { title: string; buttons: Btn[] }[] = [
  {
    title: 'Trades',
    buttons: [
      { label: '$99.99 buy', action: 'buy99', hint: 'no slap' },
      { label: '$100 buy', action: 'buy100', hint: 'Buy slaps' },
      { label: '$250 buy', action: 'buy250', hint: 'enhanced FX' },
      { label: '$100 sell', action: 'sell100', hint: 'Sell slaps' },
      { label: '$208.75 sell', action: 'sell208' },
      { label: 'Rapid alternating ×10', action: 'rapid', arg: 10 },
      { label: 'Duplicate delivery', action: 'duplicate', hint: 'resend last' },
      { label: 'Unrelated token', action: 'wrongMint' },
      { label: 'Unpriced quote asset', action: 'pendingPrice', hint: 'stays pending' },
      { label: 'Verify that price', action: 'confirmPrice' },
    ],
  },
  {
    title: 'Show extras',
    buttons: [
      { label: 'Whale buy $2,500', action: 'whale', arg: 'buy', hint: 'slow-motion mega slap' },
      { label: 'Whale sell $1,850', action: 'whale', arg: 'sell' },
      { label: 'Buy combo ×5', action: 'combo', arg: 'buy', hint: 'streak callouts' },
      { label: 'Sell combo ×5', action: 'combo', arg: 'sell', hint: 'breaks a Buy combo' },
      { label: 'Chat cheers (Buy-leaning)', action: 'cheers', arg: 'buy' },
      { label: 'Chat cheers (Sell-leaning)', action: 'cheers', arg: 'sell' },
    ],
  },
  {
    title: 'Connection',
    buttons: [
      { label: 'Lose connection', action: 'offline' },
      { label: 'Recover + backfill', action: 'recover' },
      { label: 'Stale market data', action: 'stale' },
      { label: 'FDV-only data', action: 'fdv' },
    ],
  },
  {
    title: 'Market cap',
    buttons: [
      ...[1, 2, 3, 4, 5].map((n) => ({ label: `$${n * 20}k milestone`, action: 'milestone' as const, arg: n })),
      { label: 'Jump to $85k', action: 'jump', arg: 85_000 },
      { label: 'Decline + recover', action: 'declineRecover' },
    ],
  },
  {
    title: 'Chat (simulated)',
    buttons: [
      ...(Object.keys(DEMO_CHAT_SAMPLES) as (keyof typeof DEMO_CHAT_SAMPLES)[]).map((k) => ({
        label: DEMO_CHAT_SAMPLES[k].note,
        action: 'chat' as const,
        arg: k,
      })),
      { label: 'Duplicate message ID', action: 'chatDuplicate' },
      { label: 'Same sender twice', action: 'senderCooldown', hint: '20 s cooldown' },
    ],
  },
];

export function DemoPanel({ transport, open, setOpen }: { transport: Transport; open: boolean; setOpen: (v: boolean) => void }) {
  const [log, setLog] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => transport.onDemoLog((l) => setLog((x) => [...x.slice(-60), l])), [transport]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const run = async (b: Btn) => {
    try {
      const lines = await transport.admin.demo(b.action, b.arg);
      if (lines.length) setLog((x) => [...x.slice(-60), ...lines]);
    } catch (e) {
      setLog((x) => [...x, `Error: ${(e as Error).message}`]);
    }
  };

  return (
    <section className="panel demo-panel">
      <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>Demo controls</h2>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <p className="muted tiny">Every button feeds simulated raw events through the same pipeline live data uses. Demo state is stored separately from live state.</p>
          {GROUPS.map((g) => (
            <div key={g.title} className="demo-group">
              <h3>{g.title}</h3>
              <div className="demo-buttons">
                {g.buttons.map((b) => (
                  <button key={b.label} onClick={() => run(b)} title={b.hint}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="demo-group">
            {confirmReset ? (
              <span className="confirm-row">
                <button className="danger" onClick={() => (setConfirmReset(false), void run({ label: 'reset', action: 'reset' }))}>
                  Yes, reset demo
                </button>
                <button onClick={() => setConfirmReset(false)}>Cancel</button>
              </span>
            ) : (
              <button className="danger" onClick={() => setConfirmReset(true)}>
                Reset demo progress
              </button>
            )}
          </div>
          <ol className="demo-log" ref={logRef} aria-label="Pipeline log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
