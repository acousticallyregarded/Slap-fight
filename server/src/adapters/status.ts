import type { ConnectionState } from '@bvs/shared';

/** Tracks an adapter's real state so the UI never shows a connection that does not exist. */
export class AdapterStatus {
  state = 'disabled';
  detail = '';
  constructor(public name: string, private onChange: (name: string, c: ConnectionState) => void) {}
  set(state: 'disabled' | 'unavailable' | 'connecting' | 'connected' | 'error' | 'stale', detail = '') {
    this.state = state;
    this.detail = detail;
    const map: Record<string, ConnectionState> = {
      disabled: 'unconfigured',
      unavailable: 'unconfigured',
      connecting: 'connecting',
      connected: 'connected',
      error: 'disconnected',
      stale: 'disconnected',
    };
    this.onChange(this.name, map[state]);
  }
  view() {
    return { state: this.state, detail: this.detail };
  }
}
