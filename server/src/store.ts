import fs from 'node:fs';
import path from 'node:path';
import type { EngineStore, PersistedState } from '@bvs/shared';

/**
 * JSON-file persistence, one file per (mode, mint) key. Writes are debounced
 * and atomic (write temp + rename) so a crash never leaves half a file.
 * For multi-instance deployments, swap this for Redis/Postgres behind the same
 * three-method interface.
 */
export class FileStore implements EngineStore {
  private pending = new Map<string, PersistedState>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(key: string) {
    return path.join(this.dir, key.replace(/[^a-zA-Z0-9:_-]/g, '_').replace(/:/g, '__') + '.json');
  }

  load(key: string): PersistedState | null {
    const p = this.pending.get(key);
    if (p) return structuredClone(p);
    try {
      return JSON.parse(fs.readFileSync(this.file(key), 'utf8')) as PersistedState;
    } catch {
      return null;
    }
  }

  save(key: string, state: PersistedState) {
    this.pending.set(key, structuredClone(state));
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }

  remove(key: string) {
    this.pending.delete(key);
    fs.rmSync(this.file(key), { force: true });
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const [key, state] of this.pending) {
      const f = this.file(key);
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, f);
    }
    this.pending.clear();
  }
}

/** Non-secret settings (config + provider choices) edited on the admin screen. */
export class SettingsFile<T> {
  constructor(private file: string, private fallback: T) {}
  read(): T {
    try {
      return { ...this.fallback, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return structuredClone(this.fallback);
    }
  }
  write(v: T) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(v, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }
}
