import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../domain/constants';
import type { PitchRecord } from '../domain/types';
import { computePitcherEligibility } from './storage';

const rules = DEFAULT_SETTINGS.pitchRules;
// Default rules: <=20 pitches -> 0 rest, <=35 -> 1, <=50 -> 2, <=65 -> 3, above -> 4

function record(date: string, pitches: number, inningsPitched?: number): PitchRecord {
  return { id: date, playerId: 'p1', gameId: `g-${date}`, date, pitches, innings: {}, inningsPitched };
}

describe('computePitcherEligibility', () => {
  it('is eligible with no history', () => {
    const result = computePitcherEligibility([], rules, '2026-07-06');
    expect(result.eligible).toBe(true);
    expect(result.daysRest).toBeNull();
  });

  it('is eligible same day after a low pitch count (0 rest days)', () => {
    const result = computePitcherEligibility([record('2026-07-06', 15)], rules, '2026-07-06');
    expect(result.eligible).toBe(true);
  });

  it('requires 1 day rest after 21-35 pitches', () => {
    const history = [record('2026-07-05', 30)];
    expect(computePitcherEligibility(history, rules, '2026-07-05').eligible).toBe(false);
    expect(computePitcherEligibility(history, rules, '2026-07-06').eligible).toBe(true);
  });

  it('requires 2 days rest after 36-50 pitches', () => {
    const history = [record('2026-07-04', 45)];
    expect(computePitcherEligibility(history, rules, '2026-07-05').eligible).toBe(false);
    expect(computePitcherEligibility(history, rules, '2026-07-05').daysNeeded).toBe(1);
    expect(computePitcherEligibility(history, rules, '2026-07-06').eligible).toBe(true);
  });

  it('requires max rest above the highest breakpoint', () => {
    const history = [record('2026-07-01', 80)];
    // absoluteMaxRest = 4 -> eligible on 07-05
    expect(computePitcherEligibility(history, rules, '2026-07-04').eligible).toBe(false);
    expect(computePitcherEligibility(history, rules, '2026-07-05').eligible).toBe(true);
  });

  it('uses the most recent outing, not the first record', () => {
    const history = [record('2026-06-20', 10), record('2026-07-05', 45)];
    const result = computePitcherEligibility(history, rules, '2026-07-06');
    expect(result.eligible).toBe(false);
    expect(result.lastPitched).toBe(45);
  });

  it('day math is not thrown off by timezones (dates are local calendar days)', () => {
    // If dates were parsed as UTC and compared to a local "now", games logged
    // yesterday evening could look like 0 or 2 days ago. daysBetween on the
    // date strings themselves must yield exactly 1.
    const history = [record('2026-07-05', 30)];
    const result = computePitcherEligibility(history, rules, '2026-07-06');
    expect(result.daysRest).toBe(1);
  });
});

describe('computePitcherEligibility - limitType none (softball default)', () => {
  const noneRules = { ...rules, limitType: 'none' as const };

  it('is always eligible regardless of history', () => {
    const history = [record('2026-07-06', 120)];
    const result = computePitcherEligibility(history, noneRules, '2026-07-06');
    expect(result.eligible).toBe(true);
  });
});

describe('computePitcherEligibility - limitType innings (softball style)', () => {
  const inningsRules = {
    ...rules,
    limitType: 'innings' as const,
    inningsBreakpoints: [
      { maxInnings: 3, restDays: 0 },
      { maxInnings: 6, restDays: 1 }
    ]
  };

  it('short outings need no rest', () => {
    const history = [record('2026-07-06', 0, 2)];
    expect(computePitcherEligibility(history, inningsRules, '2026-07-06').eligible).toBe(true);
  });

  it('long outings require rest by innings', () => {
    const history = [record('2026-07-05', 0, 5)];
    const sameDay = computePitcherEligibility(history, inningsRules, '2026-07-05');
    expect(sameDay.eligible).toBe(false);
    expect(sameDay.daysNeeded).toBe(1);
    expect(computePitcherEligibility(history, inningsRules, '2026-07-06').eligible).toBe(true);
  });

  it('beyond the top breakpoint uses the last breakpoint rest', () => {
    const history = [record('2026-07-05', 0, 9)];
    expect(computePitcherEligibility(history, inningsRules, '2026-07-05').eligible).toBe(false);
    expect(computePitcherEligibility(history, inningsRules, '2026-07-06').eligible).toBe(true);
  });

  it('derives innings pitched from the per-inning pitch log when not stored', () => {
    const legacy: PitchRecord = {
      id: 'x', playerId: 'p1', gameId: 'g', date: '2026-07-05',
      pitches: 40, innings: { 1: 10, 2: 15, 3: 8, 4: 7 }
    };
    const result = computePitcherEligibility([legacy], inningsRules, '2026-07-05');
    expect(result.lastInningsPitched).toBe(4);
    expect(result.eligible).toBe(false); // 4 innings -> 1 rest day
  });
});
