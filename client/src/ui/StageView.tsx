import { useEffect, useRef } from 'react';
import { Arena } from '../pixi/Arena';
import { Director, type DirectorHooks } from '../game/Director';
import type { Sfx } from '../game/sfx';

/** Mounts the Pixi arena and hands the Director to the parent once ready. */
export function StageView(props: { hooks: DirectorHooks; sfx: Sfx; onReady: (d: Director, a: Arena) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const hooksRef = useRef(props.hooks);
  hooksRef.current = props.hooks;

  useEffect(() => {
    let arena: Arena | null = null;
    let director: Director | null = null;
    let disposed = false;
    Arena.create(host.current!).then((a) => {
      if (disposed) return a.destroy();
      arena = a;
      // Indirection so hooks always reach the latest React callbacks.
      director = new Director(
        a,
        {
          announce: (...x) => hooksRef.current.announce(...x),
          landed: (...x) => hooksRef.current.landed(...x),
          pending: (...x) => hooksRef.current.pending(...x),
          stageShown: (...x) => hooksRef.current.stageShown(...x),
          combo: (...x) => hooksRef.current.combo(...x),
          callout: (...x) => hooksRef.current.callout(...x),
          leader: () => hooksRef.current.leader(),
        },
        props.sfx,
      );
      props.onReady(director, a);
    });
    return () => {
      disposed = true;
      director?.stop();
      arena?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="stage-canvas" ref={host} />;
}
