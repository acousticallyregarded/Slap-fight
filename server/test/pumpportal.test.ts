import { describe, expect, it } from 'vitest';
import { parseMarketCapSol, parsePumpPortal } from '../src/adapters/pumpportal';

const MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

describe('PumpPortal trade messages', () => {
  const msg = { signature: 'sig1', mint: MINT, traderPublicKey: 'T', txType: 'buy', solAmount: 0.75, marketCapSol: 312.4567 };
  it('reads the trade and the market cap in SOL it carries', () => {
    expect(parsePumpPortal(msg, MINT)).toMatchObject({ side: 'buy', quoteAmount: '0.75', quoteAsset: 'SOL' });
    expect(parseMarketCapSol(msg, MINT)?.toString()).toBe('312.4567');
  });
  it('ignores other tokens and missing or invalid values', () => {
    expect(parseMarketCapSol({ ...msg, mint: 'other' }, MINT)).toBeNull();
    expect(parseMarketCapSol({ ...msg, marketCapSol: undefined }, MINT)).toBeNull();
    expect(parseMarketCapSol({ ...msg, marketCapSol: 'NaN' }, MINT)).toBeNull();
    expect(parseMarketCapSol({ ...msg, marketCapSol: 0 }, MINT)).toBeNull();
  });
});
