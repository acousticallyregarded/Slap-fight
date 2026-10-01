import Decimal from 'decimal.js';
import type { GameConfig } from './config';
import type { MarketCapSample, MarketState } from './types';

/** Persisted per (mode, mint). Unlocks are all-time and never relock. */
export interface MilestoneState {
  unlockedStage: number;
  /** Candidate confirmation run for the next threshold(s). */
  run: { stageReached: number; firstAt: number; count: number } | null;
}

export const initialMilestoneState = (): MilestoneState => ({ unlockedStage: 0, run: null });

export interface MilestoneUpdate {
  market: MarketState;
  /** New stages to celebrate, ascending. Each is exactly previous + 1. */
  unlocked: { stage: number; threshold: number }[];
}

export function nextMilestone(cfg: GameConfig, unlockedStage: number): number | null {
  return cfg.milestones.thresholdsUsd[unlockedStage] ?? null;
}

/** Why a sample cannot be used for unlocks, or null when it is usable. */
export function sampleProblem(cfg: GameConfig, s: MarketCapSample | null, now: number): string | null {
  if (!s) return 'no market-cap data';
  let v: Decimal;
  try {
    v = new Decimal(s.value);
  } catch {
    return 'unreadable value';
  }
  if (!v.isFinite() || v.lte(0)) return 'invalid value';
  if (s.observedAt > now + 5_000) return 'timestamp in the future';
  if (now - s.observedAt > cfg.milestones.staleAfterMs) return 'stale';
  if (s.kind === 'fdv' && !cfg.milestones.allowFdv) return 'only FDV available';
  return null;
}

/**
 * Applies a market-cap sample. A threshold unlocks once `confirmSamples`
 * consecutive valid samples at or above it span `confirmDurationMs`. Stale or
 * invalid data suspends unlocks and breaks the confirmation run. Crossing
 * several thresholds unlocks each stage in sequence.
 */
export function applySample(cfg: GameConfig, state: MilestoneState, s: MarketCapSample | null, now: number): MilestoneUpdate {
  const problem = sampleProblem(cfg, s, now);
  const market: MarketState = { sample: s, stale: problem === 'stale', invalidReason: problem && problem !== 'stale' ? problem : null };
  if (problem) {
    // FDV-only is displayed but does not count; everything else also resets the run.
    state.run = null;
    return { market, unlocked: [] };
  }
  const thresholds = cfg.milestones.thresholdsUsd;
  const v = new Decimal(s!.value);
  let reached = 0;
  for (let i = 0; i < thresholds.length; i++) if (v.gte(thresholds[i])) reached = i + 1;

  if (reached <= state.unlockedStage) {
    state.run = null;
    return { market, unlocked: [] };
  }
  if (!state.run) state.run = { stageReached: reached, firstAt: s!.observedAt, count: 1 };
  else {
    state.run.count += 1;
    // The run confirms the lowest level seen during it; a dip shrinks what it can unlock.
    state.run.stageReached = Math.min(state.run.stageReached, reached);
  }
  const confirmed =
    state.run.count >= cfg.milestones.confirmSamples && s!.observedAt - state.run.firstAt >= cfg.milestones.confirmDurationMs;
  if (!confirmed) return { market, unlocked: [] };

  const unlocked: { stage: number; threshold: number }[] = [];
  for (let st = state.unlockedStage + 1; st <= state.run.stageReached; st++) unlocked.push({ stage: st, threshold: thresholds[st - 1] });
  state.unlockedStage = Math.max(state.unlockedStage, state.run.stageReached);
  state.run = null;
  return { market, unlocked };
}

/** Re-evaluates staleness without a new sample (called on a timer). */
export function marketStatus(cfg: GameConfig, s: MarketCapSample | null, now: number): MarketState {
  const problem = sampleProblem(cfg, s, now);
  return { sample: s, stale: problem === 'stale', invalidReason: problem && problem !== 'stale' ? problem : null };
}
