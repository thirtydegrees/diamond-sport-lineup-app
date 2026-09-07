import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import {
  assessPitcherAssignment,
  assessPitcherRest,
  dailyPitchTotal,
  deriveOutings,
  normalizePitchRules
} from './pitching';
import { completedOuting, confirmedCount, makeGame, makePlayer, outsFromInnings, unknownCount } from '../test/fixtures';

const rules = DEFAULT_SETTINGS.pitchRules;
// Default rules: <=20 pitches -> 0 rest, <=35 -> 1, <=50 -> 2, <=65 -> 3, above -> 4 (absoluteMaxRest)

describe('deriveOutings', () => {
  it('derives workload from completed games only (H8)', () => {
    const completed = completedOuting('g1', '2026-07-01', 'p1', 30, 2);
    const draft = makeGame({ id: 'g2', date: '2026-07-02', lineup: { 'p1-1': 'P' } });
    const live = makeGame({
      id: 'g3',
      date: '2026-07-03',
      status: 'live',
      outs: outsFromInnings([{ p1: 'P' }]),
      pitchCounts: { p1: confirmedCount(40) }
    });
    const outings = deriveOutings([completed, draft, live]);
    expect(outings).toHaveLength(1);
    expect(outings[0]).toMatchObject({ gameId: 'g1', playerId: 'p1', pitches: 30, pitchingOuts: 6 });
  });

  it('a deleted game leaves no workload behind - outings are always re-derived', () => {
    const games = [completedOuting('g1', '2026-07-01', 'p1', 30)];
    expect(deriveOutings(games)).toHaveLength(1);
    expect(deriveOutings(games.filter(g => g.id !== 'g1'))).toHaveLength(0);
  });

  it('an unknown count is an outing with pitches null, never zero', () => {
    const outings = deriveOutings([completedOuting('g1', '2026-07-01', 'p1', null, 2)]);
    expect(outings[0].pitches).toBeNull();
    expect(outings[0].countStatus).toBe('unknown');
  });
});

describe('assessPitcherRest', () => {
  it('is eligible with no history', () => {
    const r = assessPitcherRest('p1', '2026-07-06', [], rules);
    expect(r.eligible).toBe(true);
    expect(r.daysRest).toBeNull();
  });

  it('applies the breakpoint table to confirmed counts', () => {
    const games = [completedOuting('g1', '2026-07-05', 'p1', 30)];
    expect(assessPitcherRest('p1', '2026-07-05', games, rules).eligible).toBe(false);
    expect(assessPitcherRest('p1', '2026-07-07', games, rules).eligible).toBe(true);
  });

  it('requires max rest above the highest breakpoint', () => {
    const games = [completedOuting('g1', '2026-07-01', 'p1', 80)];
    expect(assessPitcherRest('p1', '2026-07-04', games, rules).eligible).toBe(false);
    expect(assessPitcherRest('p1', '2026-07-06', games, rules).eligible).toBe(true);
  });

  it('EXCLUDES the current game so a game cannot block its own pitcher (H7)', () => {
    const games = [completedOuting('current', '2026-07-06', 'p1', 30, 2)];
    const blockedWithout = assessPitcherRest('p1', '2026-07-06', games, rules);
    const currentExcluded = assessPitcherRest('p1', '2026-07-06', games, rules, 'current');
    // Same-day 30-pitch outing would demand a rest day...
    expect(blockedWithout.eligible).toBe(false);
    // ...but not when it IS the game being played
    expect(currentExcluded.eligible).toBe(true);
  });

  it('aggregates same-day outings (doubleheader) instead of using only the latest row', () => {
    // Two 15-pitch outings earlier the same day = 30 pitches -> 1 rest day,
    // so the pitcher cannot take the mound again TODAY. The old code looked
    // only at the "latest" record (15 -> 0 rest -> wrongly eligible).
    const games = [
      completedOuting('g1', '2026-07-05', 'p1', 15),
      completedOuting('g2', '2026-07-05', 'p1', 15)
    ];
    expect(assessPitcherRest('p1', '2026-07-05', games, rules).eligible).toBe(false);
    // After the required rest day they are eligible again
    expect(assessPitcherRest('p1', '2026-07-07', games, rules).eligible).toBe(true);
  });

  it('an earlier heavy outing still binds even after a later light one', () => {
    // 60 pitches on 07-03 requires 3 rest days (eligible 07-06). A 5-pitch
    // outing on 07-05 must not shadow it: on 07-06 the heavy outing is clear.
    const games = [
      completedOuting('g1', '2026-07-03', 'p1', 60, 3),
      completedOuting('g2', '2026-07-05', 'p1', 5)
    ];
    const day6 = assessPitcherRest('p1', '2026-07-06', games, rules);
    expect(day6.eligible).toBe(false);
    expect(assessPitcherRest('p1', '2026-07-07', games, rules).eligible).toBe(true);
    // But on 07-05 (same day as light outing, 2 days after heavy) heavy binds
    expect(assessPitcherRest('p1', '2026-07-05', games, rules).eligible).toBe(false);
  });

  it('unknown counts are conservative and flagged, never treated as zero', () => {
    const games = [completedOuting('g1', '2026-07-05', 'p1', null, 2)];
    const r = assessPitcherRest('p1', '2026-07-06', games, rules);
    expect(r.eligible).toBe(false);
    expect(r.needsCount).toBe(true);
    // absoluteMaxRest = 4 -> eligible on 07-09
    expect(assessPitcherRest('p1', '2026-07-10', games, rules).eligible).toBe(true);
  });

  it('correcting a historical count re-derives eligibility from the new value', () => {
    // 37 recorded live but the real total was 40 - both sides of the
    // 35-pitch breakpoint boundary matter here (<=35 -> 1 day, <=50 -> 2)
    const at34 = [completedOuting('g1', '2026-07-05', 'p1', 34)];
    const at40 = [completedOuting('g1', '2026-07-05', 'p1', 40)];
    expect(assessPitcherRest('p1', '2026-07-07', at34, rules).eligible).toBe(true);
    expect(assessPitcherRest('p1', '2026-07-06', at40, rules).eligible).toBe(false);
    expect(assessPitcherRest('p1', '2026-07-08', at40, rules).eligible).toBe(true);
  });

  it('innings-based rules count actual pitching outs', () => {
    const inningsRules = {
      ...rules,
      limitType: 'innings' as const,
      inningsBreakpoints: [
        { maxInnings: 3, restDays: 0 },
        { maxInnings: 6, restDays: 1 }
      ]
    };
    const short = [completedOuting('g1', '2026-07-06', 'p1', 0, 2)];
    const long = [completedOuting('g2', '2026-07-05', 'p1', 0, 5)];
    expect(assessPitcherRest('p1', '2026-07-06', short, inningsRules).eligible).toBe(true);
    expect(assessPitcherRest('p1', '2026-07-05', long, inningsRules).eligible).toBe(false);
    expect(assessPitcherRest('p1', '2026-07-07', long, inningsRules).eligible).toBe(true);
  });

  it('limitType none is always eligible', () => {
    const games = [completedOuting('g1', '2026-07-06', 'p1', 120)];
    expect(assessPitcherRest('p1', '2026-07-06', games, { ...rules, limitType: 'none' }).eligible).toBe(true);
  });
});

describe('normalizePitchRules', () => {
  it('sorts unsorted breakpoints so eligibility scanning is valid (H6)', () => {
    const messy = normalizePitchRules({
      ...rules,
      breakpoints: [
        { maxPitches: 50, restDays: 2 },
        { maxPitches: 20, restDays: 0 },
        { maxPitches: 35, restDays: 1 }
      ]
    });
    expect(messy.breakpoints.map(b => b.maxPitches)).toEqual([20, 35, 50]);
  });

  it('coerces negative and malformed values to non-negative numbers', () => {
    const cleaned = normalizePitchRules({
      ...rules,
      absoluteMax: -5,
      absoluteMaxRest: NaN as unknown as number,
      maxInningsPerGame: -2
    });
    expect(cleaned.absoluteMax).toBe(0);
    expect(cleaned.absoluteMaxRest).toBe(0);
    expect(cleaned.maxInningsPerGame).toBeNull();
  });

  it('an unsorted table still yields correct rest via assessPitcherRest', () => {
    const messy = {
      ...rules,
      breakpoints: [
        { maxPitches: 65, restDays: 3 },
        { maxPitches: 20, restDays: 0 }
      ]
    };
    // 18 pitches must match the 20 tier (0 rest), not the 65 tier
    const games = [completedOuting('g1', '2026-07-06', 'p1', 18)];
    expect(assessPitcherRest('p1', '2026-07-06', games, messy).eligible).toBe(true);
  });
});

describe('assessPitcherAssignment (the H6 single checkpoint)', () => {
  const player = makePlayer('p1', 'Sam');

  it('blocks players not marked as able to pitch', () => {
    const noPitch = makePlayer('p2', 'Ben', { canPitch: false });
    const d = assessPitcherAssignment(noPitch, makeGame(), [], rules);
    expect(d.allowed).toBe(false);
  });

  it('warns (not blocks) when pregame rest is unmet - override records reality', () => {
    const games = [completedOuting('prior', '2026-07-05', 'p1', 45, 3)];
    const game = makeGame({ id: 'today', date: '2026-07-06' });
    const d = assessPitcherAssignment(player, game, games, rules);
    expect(d.allowed).toBe(true);
    expect(d.warnings.length).toBeGreaterThan(0);
    expect(d.warnings[0].short).toContain('rest');
  });

  it('warns at the configured daily pitch max, counting this game plus same-day games', () => {
    const otherGameToday = completedOuting('dh1', '2026-07-06', 'p1', 60, 3);
    const game = makeGame({
      id: 'dh2',
      date: '2026-07-06',
      pitchCounts: { p1: { live: 25, byInning: { 1: 25 }, confirmed: null, status: 'live' } }
    });
    expect(dailyPitchTotal('p1', game, [otherGameToday]).total).toBe(85);
    const d = assessPitcherAssignment(player, game, [otherGameToday], rules);
    expect(d.warnings.some(w => w.short === 'At daily max')).toBe(true);
  });

  it('warns when the per-game innings cap is reached, in outs', () => {
    const capRules = { ...rules, limitType: 'innings' as const, maxInningsPerGame: 2 };
    const game = makeGame({
      id: 'g',
      status: 'live',
      outs: outsFromInnings([{ p1: 'P' }, { p1: 'P' }]) // 6 pitching outs = 2 innings
    });
    const d = assessPitcherAssignment(player, game, [], capRules);
    expect(d.warnings.some(w => w.short === 'At game cap')).toBe(true);
  });

  it('no warnings for a clean assignment', () => {
    const d = assessPitcherAssignment(player, makeGame(), [], rules);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toHaveLength(0);
  });

  it('a prior unknown count warns with "Count needed"', () => {
    const games = [completedOuting('prior', '2026-07-05', 'p1', null, 2)];
    const game = makeGame({ id: 'today', date: '2026-07-06' });
    const d = assessPitcherAssignment(player, game, games, rules);
    expect(d.warnings.some(w => w.short === 'Count needed')).toBe(true);
  });
});

describe('unknown/zero distinction', () => {
  it('a confirmed zero is eligible immediately; unknown is not', () => {
    const zero = [completedOuting('g1', '2026-07-05', 'p1', 0)];
    const unknown = [completedOuting('g2', '2026-07-05', 'p1', null)];
    expect(assessPitcherRest('p1', '2026-07-06', zero, rules).eligible).toBe(true);
    expect(assessPitcherRest('p1', '2026-07-06', unknown, rules).eligible).toBe(false);
  });
});

describe('unknownCount fixture sanity', () => {
  it('unknown entries carry status unknown', () => {
    expect(unknownCount().status).toBe('unknown');
  });
});

import {
  assessPositionChange,
  capCrossingWarnings,
  pcTransitionWarnings
} from './pitching';
import { endInningOuts, startLiveGame } from './games';
import type { Game } from './types';

describe('P/C transition rules from actual participation', () => {
  const catcher = makePlayer('c1', 'Cal', { canCatch: true, canPitch: true });

  function gameWhereC1Caught(): Game {
    return makeGame({
      status: 'live',
      battingOrder: ['c1'],
      outs: outsFromInnings([{ c1: 'C' }]),
      live: { inning: 2, outsRecorded: 0, assignments: { c1: 'SIT' } }
    });
  }

  it('warns when a player who caught takes the mound (baseball)', () => {
    const w = pcTransitionWarnings(catcher, 'P', gameWhereC1Caught(), true);
    expect(w.some(x => x.short === 'Caught this game')).toBe(true);
  });

  it('warns when a player who pitched moves behind the plate', () => {
    const g = makeGame({
      status: 'live',
      battingOrder: ['c1'],
      outs: outsFromInnings([{ c1: 'P' }]),
      live: { inning: 2, outsRecorded: 0, assignments: { c1: 'SIT' } }
    });
    expect(pcTransitionWarnings(catcher, 'C', g, true).some(x => x.short === 'Pitched this game')).toBe(true);
  });

  it('softball (enforce=false) has no P/C restriction', () => {
    expect(pcTransitionWarnings(catcher, 'P', gameWhereC1Caught(), false)).toEqual([]);
  });

  it('the live formation counts too, not just recorded outs', () => {
    const g = makeGame({
      status: 'live',
      battingOrder: ['c1'],
      outs: [],
      live: { inning: 1, outsRecorded: 0, assignments: { c1: 'C' } }
    });
    expect(pcTransitionWarnings(catcher, 'P', g, true).length).toBe(1);
  });
});

describe('assessPositionChange (the single gate for every path)', () => {
  const rules = DEFAULT_SETTINGS.pitchRules;

  it('bench-to-P goes through the full pitching policy', () => {
    const p = makePlayer('p9', 'Ben');
    const prior = [completedOuting('y', '2026-07-05', 'p9', 45, 3)];
    const g = makeGame({ id: 'today', date: '2026-07-06', status: 'live', live: { inning: 1, outsRecorded: 0, assignments: {} } });
    const w = assessPositionChange(p, 'P', g, prior, rules, { enforcePitcherCatcherRule: true, live: true });
    expect(w.some(x => x.short.includes('rest'))).toBe(true);
  });

  it('planning blocks a non-catcher at C; live only warns', () => {
    const p = makePlayer('nc', 'Ned', { canCatch: false });
    const g = makeGame({});
    const plan = assessPositionChange(p, 'C', g, [], rules, { enforcePitcherCatcherRule: true, live: false });
    const live = assessPositionChange(p, 'C', g, [], rules, { enforcePitcherCatcherRule: true, live: true });
    expect(plan[0].severity).toBe('block');
    expect(live[0].severity).toBe('warn');
  });

  it('avoided positions warn; SIT never warns', () => {
    const p = makePlayer('av', 'Ava', { positions: { '1B': 'avoid' } });
    const g = makeGame({});
    expect(assessPositionChange(p, '1B', g, [], rules, { enforcePitcherCatcherRule: true, live: false })[0].short).toBe('Avoided position');
    expect(assessPositionChange(p, 'SIT', g, [], rules, { enforcePitcherCatcherRule: true, live: false })).toEqual([]);
  });
});

describe('capCrossingWarnings (continuation checkpoint)', () => {
  it('warns exactly when the next out crosses the per-game innings cap', () => {
    const capRules = { ...DEFAULT_SETTINGS.pitchRules, limitType: 'innings' as const, maxInningsPerGame: 1 };
    // Pitcher a has thrown 2 outs and stays on the mound
    let g = makeGame({
      innings: 2,
      status: 'live',
      battingOrder: ['a'],
      outs: outsFromInnings([{ a: 'P' }]).slice(0, 2),
      live: { inning: 1, outsRecorded: 2, assignments: { a: 'P' } }
    });
    // Recording the 3rd out reaches exactly the cap (3 outs = 1 inning): no crossing
    expect(capCrossingWarnings(g, [], capRules, 1)).toEqual([]);
    // At the cap, the NEXT out crosses it
    g = { ...g, outs: outsFromInnings([{ a: 'P' }]), live: { inning: 2, outsRecorded: 0, assignments: { a: 'P' } } };
    expect(capCrossingWarnings(g, [], capRules, 1).some(w => w.short === 'Crosses game cap')).toBe(true);
  });

  it('warns when the current pitcher is at the daily pitch max', () => {
    const g = makeGame({
      status: 'live',
      battingOrder: ['a'],
      pitchCounts: { a: { live: 85, byInning: {}, confirmed: null, status: 'live' } },
      live: { inning: 1, outsRecorded: 0, assignments: { a: 'P' } }
    });
    expect(capCrossingWarnings(g, [], DEFAULT_SETTINGS.pitchRules, 1).some(w => w.short === 'Over daily max')).toBe(true);
  });

  it('no pitcher on the mound -> nothing to warn about', () => {
    const g = startLiveGame(makeGame({ battingOrder: ['a'] }));
    expect(capCrossingWarnings(endInningOuts(g), [], DEFAULT_SETTINGS.pitchRules, 1)).toEqual([]);
  });
});
