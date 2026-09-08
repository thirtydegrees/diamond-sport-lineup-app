import { updateInningRuns, firstSolvableInning } from './games';
import { describe, it, expect } from 'vitest';
import { PITCH_RULE_PRESETS } from './presets';
import { assessPitcherRest, assessPitcherAssignment } from './pitching';
import {
  setInningPitches,
  setLivePitchTotal,
  startLiveGame,
  applyLiveSwap,
  playersNeedingPitchConfirmation,
  insertOutAfter,
  completeGame,
} from './games';
import { completedOuting, makeGame, makePlayer } from '../test/fixtures';
import { Solver } from './solver';

const baseball = PITCH_RULE_PRESETS.filter((p) => p.sport === 'baseball');
describe.each(baseball)('$label calendar boundaries', (preset) => {
  it.each([
    [20, 0],
    [21, 1],
    [35, 1],
    [36, 2],
    [50, 2],
    [51, 3],
    [65, 3],
    [66, 4],
    [95, 4],
  ])('%i pitches requires %i full rest days', (count, rest) => {
    if (count > preset.rules.absoluteMax) return;
    const history = [completedOuting('prior', '2026-09-06', 'p', count)];
    if (rest > 0)
      expect(
        assessPitcherRest(
          'p',
          `2026-09-${String(6 + rest).padStart(2, '0')}`,
          history,
          preset.rules,
        ).eligible,
      ).toBe(false);
    expect(
      assessPitcherRest(
        'p',
        `2026-09-${String(7 + rest).padStart(2, '0')}`,
        history,
        preset.rules,
      ).eligible,
    ).toBe(true);
  });
  it('blocks a second game even after a light first outing', () => {
    expect(
      assessPitcherRest(
        'p',
        '2026-09-06',
        [completedOuting('a', '2026-09-06', 'p', 5)],
        preset.rules,
      ).reason,
    ).toContain('appearance');
  });
  it('blocks the third consecutive pitching day after light outings', () => {
    const games = [
      completedOuting('a', '2026-09-04', 'p', 5),
      completedOuting('b', '2026-09-05', 'p', 5),
    ];
    expect(
      assessPitcherRest('p', '2026-09-06', games, preset.rules).reason,
    ).toContain('Consecutive');
  });
});
it('corrects 18 to 21, then increments to 22 without losing the inning count', () => {
  let game = setInningPitches(makeGame(), 'p', 1, 18);
  game = setLivePitchTotal(game, 'p', 21);
  expect(game.pitchCounts.p.byInning[1]).toBe(18);
  game = setInningPitches(game, 'p', 1, 19);
  expect(game.pitchCounts.p.live).toBe(22);
  expect(game.pitchCounts.p.adjustment).toBe(3);
  game = setInningPitches(game, 'p', 2, 1);
  expect(game.pitchCounts.p.live).toBe(23);
});
it('rejects fractional and negative pitch counts', () => {
  expect(() => setLivePitchTotal(makeGame(), 'p', -1)).toThrow();
  expect(() => setInningPitches(makeGame(), 'p', 1, 1.5)).toThrow();
});
it('requires review for a zero-out pitcher who was replaced before counter use', () => {
  const game = applyLiveSwap(
    startLiveGame(
      makeGame({
        battingOrder: ['a', 'b'],
        lineup: { 'a-1': 'P', 'b-1': '1B' },
      }),
    ),
    'b',
    'P',
  );
  expect(playersNeedingPitchConfirmation(game)).toEqual(['a', 'b']);
  expect(() =>
    completeGame(game, [{ playerId: 'b', pitches: 12 }], []),
  ).toThrow();
});
it('checks mound returns by age band', () => {
  const p = makePlayer('a', 'A');
  let game = startLiveGame(
    makeGame({ battingOrder: ['a', 'b'], lineup: { 'a-1': 'P', 'b-1': '1B' } }),
  );
  game = applyLiveSwap(game, 'b', 'P');
  expect(
    assessPitcherAssignment(p, game, [], baseball[0].rules).warnings.some(
      (w) => w.short === 'Mound return limit',
    ),
  ).toBe(true);
  expect(
    assessPitcherAssignment(p, game, [], baseball[3].rules).warnings.some(
      (w) => w.short === 'Mound return limit',
    ),
  ).toBe(false);
  game = applyLiveSwap(applyLiveSwap(game, 'a', 'P'), 'b', 'P');
  expect(
    assessPitcherAssignment(p, game, [], baseball[3].rules).warnings.some(
      (w) => w.short === 'Mound return limit',
    ),
  ).toBe(true);
});
it('allows first-out correction when no outs were recorded', () => {
  const game = insertOutAfter(
    makeGame({ lineup: { 'a-1': 'P' }, battingOrder: ['a'] }),
    0,
  );
  expect(game.outs[0].assignments.a).toBe('P');
});
it('rejects nonadjacent pitcher/catcher assignments in a baseball plan', () => {
  expect(
    Solver.checkPitcherCatcherRule(
      makePlayer('a', 'A'),
      'P',
      1,
      { 'a-3': 'C' },
      9,
    ),
  ).toBe(false);
});


describe('inning scoring', () => {
  it('adds rapid runs to the latest total and preserves all unrelated game state', () => {
    const original = makeGame();
    const first = updateInningRuns(original, 'us', 1, 1, true);
    const second = updateInningRuns(first, 'us', 1, 1, true);
    const extra = updateInningRuns(second, 'them', 10, 3);
    const corrected = updateInningRuns(extra, 'us', 1, -1, true);
    expect(corrected.score).toEqual({us:{1:1},them:{10:3}});
    expect(corrected.outs).toBe(original.outs);
    expect(corrected.pitchCounts).toBe(original.pitchCounts);
    expect(original.score).toEqual({us:{},them:{}});
  });
  it('rejects invalid inning totals', () => {
    expect(() => updateInningRuns(makeGame(), 'us', 1, -1, true)).toThrow();
    expect(() => updateInningRuns(makeGame(), 'us', 0, 1)).toThrow();
    expect(() => updateInningRuns(makeGame(), 'us', 1, 1.5)).toThrow();
  });
});


describe('live automated planning boundary', () => {
  it('preserves played and current innings, including holes and exited players', () => {
    const game = makeGame({status: 'live', live: {inning: 3, outsRecorded: 1, assignments: {a: 'P'}}, lineup: {'a-1': 'P', 'departed-2': 'SIT', 'a-3': 'P'}});
    const result = Solver.solve({players: [makePlayer('a')], innings: 4, startInning: firstSolvableInning(game), existingPlan: game.lineup, lockedCells: {'ghost-1': 'C'}, fieldingPositions: ['P'], requireContiguousPitching: false});
    expect(result.success).toBe(true);
    expect(result.solution).toEqual({...game.lineup, 'a-4': 'P'});
    expect(game.live?.inning).toBe(3);
  });
  it('keeps explicit later starts and draft first-inning solving', () => {
    expect(firstSolvableInning(makeGame())).toBe(1);
    const game = makeGame({status:'live', live:{inning:3, outsRecorded:0, assignments:{}}});
    expect(firstSolvableInning(game, 1)).toBe(4);
    expect(firstSolvableInning(game, 7)).toBe(7);
  });
});


describe('scheduled preparation is not actual activity', () => {
  it('ignores a draft in rest calculations, and starts actual activity empty', () => {
    const draft = {...completedOuting('draft','2026-09-06','p',80), status:'draft' as const};
    expect(assessPitcherRest('p','2026-09-07',[draft],baseball[0].rules).eligible).toBe(true);
    const live = startLiveGame(draft);
    expect(live.outs).toEqual([]);
    expect(live.pitchCounts).toEqual({});
    expect(live.score).toEqual({us:{},them:{}});
    expect(live.date).toBe(draft.date);
  });
  it('uses the selected date while preserving future-outing exclusion for today', () => {
    const history = [completedOuting('future','2026-09-08','p',25)];
    expect(assessPitcherRest('p','2026-09-07',history,baseball[0].rules).eligible).toBe(true);
    expect(assessPitcherRest('p','2026-09-09',history,baseball[0].rules).eligible).toBe(false);
    expect(assessPitcherRest('p','2026-09-10',history,baseball[0].rules).eligible).toBe(true);
  });
});
