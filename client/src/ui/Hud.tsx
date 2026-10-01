import { formatUsd, type BestSlap, type CharacterId, type FunSnapshot } from '@bvs/shared';

const HYPE_WORDS: [number, string][] = [
  [0.85, 'MAX HYPE'],
  [0.55, 'Hyped'],
  [0.25, 'Warming up'],
  [0, 'Chill'],
];

/** Recent qualifying volume as a meter: the arena lights and crowd follow it. */
export function HypeMeter({ fun }: { fun: FunSnapshot | null }) {
  const h = fun?.hype ?? 0;
  const word = HYPE_WORDS.find(([t]) => h >= t)![1];
  return (
    <div className={`hud hype ${h >= 0.85 ? 'max' : ''}`} aria-label={`Hype ${Math.round(h * 100)}%`}>
      <div className="hud-title">
        HYPE <span>{word}</span>
      </div>
      <div className="hype-bar">
        <div className="hype-fill" style={{ width: `${h * 100}%` }} />
      </div>
      <div className="hud-sub">{fun ? `${formatUsd(fun.volumeUsd, false)} traded in 5 min` : '—'}</div>
    </div>
  );
}

/** Chat cheers for each team over the last two minutes. */
export function CheerBar({ fun, demo }: { fun: FunSnapshot | null; demo: boolean }) {
  const b = fun?.cheers.buy ?? 0;
  const s = fun?.cheers.sell ?? 0;
  const total = b + s;
  const share = total ? b / total : 0.5;
  return (
    <div className="hud cheer" aria-label={`Crowd cheers: Buy ${b}, Sell ${s}`}>
      <div className="hud-title">
        CROWD <span>{total ? `${Math.round(share * 100)}% · ${Math.round((1 - share) * 100)}%` : 'quiet'}</span>
      </div>
      <div className="cheer-bar">
        <div className="cheer-buy" style={{ width: `${share * 100}%` }} />
        <div className="cheer-sell" style={{ width: `${(1 - share) * 100}%` }} />
      </div>
      <div className="hud-sub">{total ? `${b} buy · ${s} sell cheers${demo ? ' (simulated)' : ''}` : 'Type “go buy” or “go sell” in chat'}</div>
    </div>
  );
}

/** Today's biggest slap, with the share button. */
export function RecordChip({ best, onShare }: { best: BestSlap | null; onShare: () => void }) {
  if (!best) return null;
  const side = best.trade.side;
  return (
    <div className={`hud record ${side}`}>
      <span className="trophy" aria-hidden>
        🏆
      </span>
      <span>
        <span className="rec-label">Biggest slap today </span>
        <b>{formatUsd(best.trade.usdValue, false)}</b> <em>{side.toUpperCase()}</em>
      </span>
      <button onClick={onShare} title="Make a shareable image of this slap">
        Share
      </button>
    </div>
  );
}

/** The current streak, over the side that is on it. */
export function ComboBadge({ side, count, min }: { side: CharacterId | null; count: number; min: number }) {
  if (!side || count < 2) return null;
  const hot = count >= min;
  return (
    <div key={`${side}-${count}`} className={`combo-badge ${side} ${hot ? 'hot' : ''} ${count >= 5 ? 'fire' : ''}`}>
      <b>{count}x</b> {hot ? 'COMBO' : 'in a row'}
      <div className="combo-pips">
        {Array.from({ length: Math.max(min, Math.min(10, count + 1)) }, (_, i) => (
          <span key={i} className={i < count ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

export function Callout({ text, tone, id }: { text: string; tone: CharacterId | 'gold'; id: number }) {
  return (
    <div key={id} className={`callout tone-${tone}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}
