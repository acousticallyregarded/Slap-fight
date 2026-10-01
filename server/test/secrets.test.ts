import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bvs-secrets-'));

describe('admin-entered keys', () => {
  let mod: typeof import('../src/env');
  beforeAll(async () => {
    vi.stubEnv('DATA_DIR', dir);
    vi.stubEnv('BIRDEYE_API_KEY', 'from-env');
    vi.stubEnv('PUMPPORTAL_API_KEY', '');
    vi.stubEnv('ADMIN_PASSWORD', 'pw');
    mod = await import('../src/env');
    mod.loadStoredSecrets();
  });

  it('stores a key server-side, reports only where it came from, and overrides .env', () => {
    expect(mod.secretSources().PUMPPORTAL_API_KEY).toBe('unset');
    expect(mod.updateStoredSecrets({ PUMPPORTAL_API_KEY: '  pp-key  ', BIRDEYE_API_KEY: 'typed' })).toEqual(['PUMPPORTAL_API_KEY', 'BIRDEYE_API_KEY']);
    expect(mod.env.pumpPortalApiKey).toBe('pp-key');
    expect(mod.env.birdeyeApiKey).toBe('typed');
    expect(mod.secretSources()).toMatchObject({ PUMPPORTAL_API_KEY: 'admin', BIRDEYE_API_KEY: 'admin' });
    expect(JSON.stringify(mod.secretSources())).not.toContain('pp-key');
    const file = path.join(dir, 'secrets.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).PUMPPORTAL_API_KEY).toBe('pp-key');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  it('clearing a key falls back to .env', () => {
    mod.updateStoredSecrets({ BIRDEYE_API_KEY: '' });
    expect(mod.env.birdeyeApiKey).toBe('from-env');
    expect(mod.secretSources().BIRDEYE_API_KEY).toBe('env');
  });

  it('ignores the admin password and unknown names', () => {
    expect(mod.updateStoredSecrets({ ADMIN_PASSWORD: 'x', NOPE: 'y', HELIUS_API_KEY: 5 })).toEqual([]);
    expect(mod.env.adminPassword).toBe('pw');
  });

  it('keeps saved keys across a restart', () => {
    mod.loadStoredSecrets();
    expect(mod.env.pumpPortalApiKey).toBe('pp-key');
  });
});
