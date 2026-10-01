import { useEffect, useState } from 'react';
import { formatUsd, type BestSlap } from '@bvs/shared';
import type { Arena } from '../pixi/Arena';

const W = 1200;
const H = 675;
const TEAM = { buy: '#2de2c0', sell: '#ff3d7f' } as const;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = src;
  });

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r1: number, r2: number, n: number, fill: string, stroke?: string) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Draws the 1200×675 share image (the size X and Discord show in full). */
export async function drawShareCard(arena: Arena, best: BestSlap, token: { name: string; symbol: string }, demo: boolean): Promise<string> {
  await document.fonts?.ready;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const side = best.trade.side;
  const color = TEAM[side];

  // Night-time neon arena.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#12072e');
  bg.addColorStop(0.6, '#1c0a3d');
  bg.addColorStop(1, '#07031a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(780, 300, 20, 780, 300, 520);
  glow.addColorStop(0, side === 'buy' ? 'rgba(45,226,192,0.35)' : 'rgba(255,61,127,0.35)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 6;
  for (const [r, a] of [[330, 0.5], [270, 0.8]] as const) {
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#5ffbe0';
    ctx.beginPath();
    ctx.arc(780, 330, r, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff6aa0';
    ctx.beginPath();
    ctx.arc(780, 330, r, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#150935';
  ctx.fillRect(0, 610, W, H - 610);
  ctx.fillStyle = '#f0abfc';
  ctx.fillRect(0, 608, W, 4);

  // The slap itself, from the hand-drawn frames of the outfit it landed in.
  const frames = await arena.acts.cardFrames(best.stage, side);
  if (frames) {
    const [a, d] = await Promise.all([loadImage(frames.attacker.url), loadImage(frames.defender.url)]);
    const k = 500 / ((frames.attacker.sheet.figureHeight + frames.defender.sheet.figureHeight) / 2);
    const floor = 612;
    const cx = 790;
    const ax = side === 'buy' ? cx - (frames.gap * k) / 2 : cx + (frames.gap * k) / 2;
    const dx = side === 'buy' ? cx + (frames.gap * k) / 2 : cx - (frames.gap * k) / 2;
    const draw = (img: HTMLImageElement, sheet: { anchor: [number, number] }, x: number) =>
      ctx.drawImage(img, x - sheet.anchor[0] * k, floor - sheet.anchor[1] * k, img.width * k, img.height * k);
    draw(d, frames.defender.sheet, dx);
    draw(a, frames.attacker.sheet, ax);
    const hx = ax + frames.hand[0] * k;
    const hy = floor + frames.hand[1] * k;
    star(ctx, hx, hy, 92, 42, 10, '#fff36b', '#2a0a4a');
    star(ctx, hx, hy, 52, 26, 10, '#ffffff');
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-0.15);
    ctx.font = '900 46px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('SLAP!!', 0, 0);
    ctx.fillStyle = '#ff2d6f';
    ctx.fillText('SLAP!!', 0, 0);
    ctx.restore();
  }

  // Headline.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f5c451';
  ctx.font = '800 30px "Baloo 2", "Trebuchet MS", sans-serif';
  ctx.fillText('🏆 BIGGEST SLAP TODAY', 56, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 118px "Baloo 2", "Trebuchet MS", sans-serif';
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillText(formatUsd(best.trade.usdValue, false), 50, 214);
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = '800 64px "Baloo 2", "Trebuchet MS", sans-serif';
  ctx.fillText(`${side.toUpperCase()} SLAP`, 56, 290);
  ctx.fillStyle = '#b9acd9';
  ctx.font = '600 26px Inter, system-ui, sans-serif';
  ctx.fillText(`${token.name}  $${token.symbol}`, 58, 346);
  ctx.fillText(new Date(best.trade.timestamp).toUTCString().slice(0, 16), 58, 384);
  ctx.font = '800 40px "Baloo 2", "Trebuchet MS", sans-serif';
  ctx.fillStyle = '#2de2c0';
  ctx.fillText('BUY', 58, 575);
  ctx.fillStyle = '#b9acd9';
  ctx.fillText('vs.', 150, 575);
  ctx.fillStyle = '#ff3d7f';
  ctx.fillText('SELL', 212, 575);

  // Simulated trades are never presented as real.
  if (demo) {
    ctx.save();
    ctx.translate(250, 470);
    ctx.rotate(-0.08);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 5;
    ctx.strokeRect(-200, -38, 400, 70);
    ctx.fillStyle = '#fbbf24';
    ctx.font = '800 36px "Baloo 2", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DEMO · SIMULATED', 0, 12);
    ctx.restore();
  }
  return c.toDataURL('image/png');
}

export function ShareCard(props: { arena: Arena; best: BestSlap; token: { name: string; symbol: string }; demo: boolean; canDownload: boolean; onClose: () => void }) {
  const { arena, best, token, demo, canDownload, onClose } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let live = true;
    drawShareCard(arena, best, token, demo)
      .then((u) => live && setUrl(u))
      .catch(() => live && setMsg('Could not draw the card.'));
    return () => {
      live = false;
    };
  }, [arena, best, token, demo]);

  const usd = formatUsd(best.trade.usdValue, false);
  const side = best.trade.side.toUpperCase();
  const other = side === 'BUY' ? 'SELL' : 'BUY';
  const text = `${side} just landed a ${usd} slap on ${other}${demo ? ' (demo)' : ''} in Buy vs. Sell 👋 $${token.symbol}`;
  const link = demo ? '' : `${location.origin}${location.pathname}`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}${link.startsWith('https://') ? `&url=${encodeURIComponent(link)}` : ''}`;

  const copy = async () => {
    try {
      const blob = await (await fetch(url!)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setMsg('Image copied. Paste it into your post.');
    } catch {
      setMsg('Copying images is blocked here. Save the image instead (right-click or long-press it).');
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal share" role="dialog" aria-label="Share the biggest slap" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Share the biggest slap</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {url ? <img src={url} alt={`${side} slap of ${usd}`} /> : <div className="share-wait">{msg || 'Drawing…'}</div>}
        <div className="share-actions">
          {canDownload && (
            <a className={`btn ${url ? '' : 'disabled'}`} href={url ?? undefined} download={`buy-vs-sell-${best.trade.side}-slap.png`}>
              Download image
            </a>
          )}
          <button className="btn" disabled={!url} onClick={copy}>
            Copy image
          </button>
          <a className="btn primary" href={intent} target="_blank" rel="noopener noreferrer">
            Post on X
          </a>
        </div>
        <p className="muted tiny">{msg ||
            (canDownload
              ? 'Post on X opens the post with the text filled in; attach the image you downloaded or copied.'
              : 'To save the image, right-click or long-press it. Post on X opens the post with the text filled in; attach the image.')}</p>
      </div>
    </div>
  );
}
