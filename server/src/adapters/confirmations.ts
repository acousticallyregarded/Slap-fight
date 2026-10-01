import type { ConfirmationStatus, RawSwap } from '@bvs/shared';

// Commitment levels (https://solana.com/docs/rpc): processed = latest block,
// may roll back; confirmed = voted by a supermajority (>2/3 stake);
// finalized = maximum lockout. We slap at the admin-configured level
// (default `confirmed`) and re-check once for `finalized`; a swap that
// disappears or errors is reported as a correction.

type Status = { confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null; err: unknown } | null;

async function getSignatureStatuses(rpcUrl: string, sigs: string[]): Promise<Status[]> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [sigs, { searchTransactionHistory: true }] }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: { value: Status[] }; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result!.value;
}

/**
 * Upgrades swaps from `processed` to their real commitment level by polling the
 * Solana RPC. Emits each status change back into the pipeline.
 */
export class ConfirmationTracker {
  private waiting = new Map<string, { raw: RawSwap; since: number; finalizedCheck: boolean }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private rpcUrl: string, private emit: (raw: RawSwap) => void, private onError: (e: Error) => void) {}

  track(raw: RawSwap) {
    if (!this.rpcUrl) return;
    this.waiting.set(raw.transactionSignature + ':' + raw.swapIndex, { raw, since: Date.now(), finalizedCheck: false });
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 2_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll() {
    const items = [...this.waiting.entries()].slice(0, 256);
    if (!items.length) return this.stop();
    let statuses: Status[];
    try {
      statuses = await getSignatureStatuses(this.rpcUrl, items.map(([, v]) => v.raw.transactionSignature));
    } catch (e) {
      return this.onError(e as Error);
    }
    items.forEach(([key, item], i) => {
      const st = statuses[i];
      const age = Date.now() - item.since;
      let next: ConfirmationStatus | null = null;
      if (st?.err) next = 'failed';
      else if (st?.confirmationStatus === 'finalized') next = 'finalized';
      else if (st?.confirmationStatus === 'confirmed' && !item.finalizedCheck) next = 'confirmed';
      else if (!st && age > 90_000) next = 'dropped';
      if (!next) return;
      this.emit({ ...item.raw, confirmationStatus: next });
      if (next === 'confirmed') item.finalizedCheck = true; // keep watching until finalized
      else this.waiting.delete(key);
    });
  }
}
