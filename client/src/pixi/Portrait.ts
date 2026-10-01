import { Application, Container } from 'pixi.js';
import { makeRig } from './Arena';
import { CLIPS, type StateName } from './pose';

/**
 * Art preview (#portrait): both rigs large on a plain backdrop, for artists
 * and for checking drawn or replaced parts. `#portrait/face` zooms on heads,
 * `#portrait/<state>` holds a pose (e.g. #portrait/peace).
 */
export async function mountPortrait(host: HTMLElement, arg: string) {
  const app = new Application();
  await app.init({ resizeTo: host, background: '#2a2238', antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio || 1, 2) });
  host.appendChild(app.canvas);
  const world = new Container();
  app.stage.addChild(world);
  const buy = makeRig('buy');
  const sell = makeRig('sell');
  buy.position.set(-200, 0);
  sell.position.set(200, 0);
  sell.scale.x = -1;
  const stage = Number(new URLSearchParams(location.search).get('stage') ?? 0);
  buy.setOutfitStage(stage);
  sell.setOutfitStage(stage);
  world.addChild(buy, sell);
  const face = arg === 'face';
  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    const [top, bottom, width] = face ? [-560, -270, 760] : [-560, 360, 1000];
    const s = Math.min(w / width, h / (bottom - top));
    world.scale.set(s);
    world.position.set(w / 2, -top * s + (h - (bottom - top) * s) / 2);
  };
  layout();
  app.renderer.on('resize', layout);
  app.ticker.add((t) => {
    buy.update(t.deltaMS, false);
    sell.update(t.deltaMS, false);
  });
  if (arg && arg !== 'face' && arg in CLIPS) {
    const hold = () => void Promise.all([buy.play(arg as StateName, 0.0001), sell.play(arg as StateName, 0.0001)]);
    // Advance to the clip's main key and freeze there.
    buy.play(arg as StateName, 1);
    sell.play(arg as StateName, 1);
    setTimeout(hold, 700);
  }
}
