import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { LocalTransport } from './transport/LocalTransport';
import { ServerTransport } from './transport/ServerTransport';
import type { Transport } from './transport/types';
import './styles.css';

async function pickTransport(): Promise<Transport> {
  // The standalone build is a self-contained demo with no server and no live mode.
  if (import.meta.env.MODE === 'standalone') return new LocalTransport();
  const q = new URLSearchParams(location.search).get('mode');
  if (q === 'demo' || q === 'live') return new ServerTransport(q);
  try {
    const pub = await (await fetch('/api/public')).json();
    return new ServerTransport(pub.defaultMode === 'live' ? 'live' : 'demo');
  } catch {
    return new ServerTransport('demo');
  }
}

if (location.hash.startsWith('#portrait')) {
  import('./pixi/Portrait').then((m) => m.mountPortrait(document.getElementById('root')!, location.hash.split('/')[1] ?? ''));
} else pickTransport().then((t) => createRoot(document.getElementById('root')!).render(<App transport={t} />));
