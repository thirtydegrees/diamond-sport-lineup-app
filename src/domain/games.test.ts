import { describe, expect, it } from 'vitest';
import {
  addScheduledInning,
  firstSolvableInning,
  hydratePreparedInning,
  updateInningRuns,
  deleteOutAt,
  editOutAssignments,
  insertOutAfter,
  applyLiveSwap,
  applyPlanSwap,
  completeGame,
  correctConfirmedPitches,
  endInningOuts,
  formatOutsAsInnings,
  normalizeGamePlan,
  participationByPlayer,
  pitchingOutsByPlayer,
  playersNeedingPitchConfirmation,
  recordOut,
  setInningPitches,
  setLivePitchTotal,
  startLiveGame,
  undoOut,
  validateFormation,
  validateGamePlan
} from './games';
import { makeGame, makePlayer } from '../test/fixtures';
import type { Game } from './types';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const roster = ids.map(id => makePlayer(id, id.toUpperCase()));

/** A 10-player game with a full 2-inning plan (9 field + 1 sit). */
function plannedGame(): Game {
  const lineup: Game['lineup'] = {};
  const positions: Game['lineup'][string][] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SIT'];
  for (let inning = 1; inning <= 2; inning++) {
    ids.forEach((id, i) => {
      // Rotate one step in inning 2 so the plans differ
      const pos = positions[(i + (inning - 1)) % 10];
      lineup[`${id}-${inning}`] = pos;
    });
  }
  return makeGame({ innings: 2, battingOrder: [...ids], lineup });
}

describe('formatOutsAsInnings', () => {
  it('renders thirds', () => {
    expect(formatOutsAsInnings(0)).toBe('0');
    expect(formatOutsAsInnings(1)).toBe('⅓');
    expect(formatOutsAsInnings(2)).toBe('⅔');
    expect(formatOutsAsInnings(3)).toBe('1');
    expect(formatOutsAsInnings(7)).toBe('2⅓');
  });
});

describe('live out tracking', () => {
  it('startLiveGame seeds the formation from the inning-1 plan', () => {
    const live = startLiveGame(plannedGame());
    expect(live.status).toBe('live');
    expect(live.live?.inning).toBe(1);
    expect(live.live?.assignments.a).toBe('P');
    expect(live.live?.assignments.j).toBe('SIT');
  });

  it('recordOut snapshots the formation and rolls the inning after 3 outs', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(g);
    expect(g.outs).toHaveLength(1);
    expect(g.outs[0]).toMatchObject({ inning: 1, outInInning: 1 });
    expect(g.live?.outsRecorded).toBe(1);

    g = recordOut(recordOut(g));
    expect(g.outs).toHaveLength(3);
    expect(g.live?.inning).toBe(2);
    expect(g.live?.outsRecorded).toBe(0);
    // Inning-2 plan takes the field (rotated by one)
    expect(g.live?.assignments.a).toBe('C');
    expect(g.live?.assignments.j).toBe('P');
  });

  it('the requirement example: P for 1 out then 1B for 2 records ⅓ and ⅔', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(g); // out 1: a at P
    // a moves to 1B; current 1B (c) takes the mound? No - swap puts c at P
    g = applyLiveSwap(g, 'a', '1B');
    expect(g.live?.assignments.a).toBe('1B');
    expect(g.live?.assignments.c).toBe('P'); // displaced into a's old spot
    g = recordOut(recordOut(g)); // outs 2, 3

    const byPlayer = participationByPlayer(g);
    expect(byPlayer.a.P).toBe(1);
    expect(byPlayer.a['1B']).toBe(2);
    expect(formatOutsAsInnings(byPlayer.a.P!)).toBe('⅓');
    expect(formatOutsAsInnings(byPlayer.a['1B']!)).toBe('⅔');
  });

  it('mid-inning changes never rewrite recorded outs', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(g);
    const before = g.outs[0].assignments;
    g = applyLiveSwap(g, 'j', 'P');
    expect(g.outs[0].assignments).toEqual(before);
    expect(g.outs[0].assignments.a).toBe('P');
  });

  it('endInningOuts records the remaining outs with the same defense', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(g);
    g = endInningOuts(g);
    expect(g.outs).toHaveLength(3);
    expect(g.live?.inning).toBe(2);
    // All three outs of inning 1 share the same defense
    expect(g.outs.every(o => o.inning === 1 && o.assignments.a === 'P')).toBe(true);
  });

  it('undoOut removes the latest snapshot and restores its formation, across inning boundaries', () => {
    let g = startLiveGame(plannedGame());
    g = endInningOuts(g); // 3 outs, now inning 2
    expect(g.live?.inning).toBe(2);
    g = undoOut(g);
    expect(g.outs).toHaveLength(2);
    expect(g.live?.inning).toBe(1);
    expect(g.live?.outsRecorded).toBe(2);
    expect(g.live?.assignments.a).toBe('P'); // inning-1 defense restored
  });

  it('double-tap then undo leaves the ledger exactly one out shorter', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(recordOut(g)); // accidental double tap
    g = undoOut(g);
    expect(g.outs).toHaveLength(1);
    expect(g.live?.outsRecorded).toBe(1);
  });

  it('pitch counting is independent of outs in both directions', () => {
    let g = startLiveGame(plannedGame());
    g = setInningPitches(g, 'a', 1, 12);
    expect(g.outs).toHaveLength(0); // pitches never create outs
    g = recordOut(g);
    expect(g.pitchCounts.a.live).toBe(12); // outs never change pitches
  });
});

describe('validateFormation', () => {
  it('flags duplicates, vacancies, and unassigned actives', () => {
    const issues = validateFormation(
      { a: 'P', b: 'P', c: 'C' },
      ['a', 'b', 'c', 'd'],
      9
    );
    expect(issues.some(i => i.type === 'duplicate')).toBe(true);
    expect(issues.some(i => i.type === 'vacant')).toBe(true);
    expect(issues.some(i => i.type === 'unassigned')).toBe(true);
  });

  it('passes a complete 9-player formation with a bench', () => {
    const g = startLiveGame(plannedGame());
    const issues = validateFormation(g.live!.assignments, ids, 9);
    expect(issues).toEqual([]);
  });
});

describe('completion and pitch confirmation', () => {
  function liveGameWithPitching(): Game {
    let g = startLiveGame(plannedGame());
    g = setInningPitches(g, 'a', 1, 14);
    g = endInningOuts(g); // a pitched inning 1
    return g;
  }

  it('lists everyone with pitching outs or counter activity for confirmation', () => {
    let g = liveGameWithPitching();
    g = setInningPitches(g, 'x-counter-only', 2, 5);
    const need = playersNeedingPitchConfirmation(g);
    expect(need).toContain('a');
    expect(need).toContain('x-counter-only');
  });

  it('completeGame stores confirmed totals and only recorded outs become history', () => {
    const g = liveGameWithPitching();
    // Coach reconciles against GameChanger: real total was 17, not 14
    const done = completeGame(g, [{ playerId: 'a', pitches: 17 }, {playerId:'j',pitches:0}], roster);
    expect(done.status).toBe('completed');
    expect(done.live).toBeNull();
    expect(done.pitchCounts.a).toMatchObject({ confirmed: 17, status: 'confirmed' });
    expect(done.outs).toHaveLength(3); // one real inning, not the 2-inning plan
    expect(pitchingOutsByPlayer(done).a).toBe(3);
  });

  it('marking unknown stores null, not zero', () => {
    const done = completeGame(liveGameWithPitching(), [{ playerId: 'a', pitches: null }, {playerId:'j',pitches:0}], roster);
    expect(done.pitchCounts.a.status).toBe('unknown');
    expect(done.pitchCounts.a.confirmed).toBeNull();
  });

  it('snapshots player names so history survives roster removal (M5)', () => {
    const done = completeGame(liveGameWithPitching(), [{ playerId: 'a', pitches: 14 }, {playerId:'j',pitches:0}], roster);
    expect(done.playerNames.a).toBe('A');
    expect(done.playerNames.j).toBe('J');
  });

  it('correctConfirmedPitches updates a completed game in place', () => {
    const done = completeGame(liveGameWithPitching(), [{ playerId: 'a', pitches: 37 }, {playerId:'j',pitches:0}], roster);
    const fixed = correctConfirmedPitches(done, 'a', 40);
    expect(fixed.pitchCounts.a.confirmed).toBe(40);
    const unknowned = correctConfirmedPitches(done, 'a', null);
    expect(unknowned.pitchCounts.a.status).toBe('unknown');
  });

  it('a direct total correction supersedes per-inning tallies', () => {
    let g = liveGameWithPitching();
    g = setLivePitchTotal(g, 'a', 22);
    expect(g.pitchCounts.a.live).toBe(22);
  });
});

describe('normalizeGamePlan (H9)', () => {
  it('prunes assignments, locks, pitchers, and scores that no longer apply', () => {
    const g = plannedGame();
    const messy: Game = {
      ...g,
      innings: 1, // shortened from 2
      battingOrder: ids.filter(id => id !== 'a'), // a became unavailable
      lockedCells: { 'a-1': 'P', 'b-1': 'C', 'b-2': '1B' },
      pitcherAssignments: { 1: 'a', 2: 'b' },
      score: { us: { 1: 2, 2: 3 }, them: { 1: 0 } }
    };
    const clean = normalizeGamePlan(messy);
    // No trace of the unavailable player or the removed inning
    expect(Object.keys(clean.lineup).some(k => k.startsWith('a-'))).toBe(false);
    expect(Object.keys(clean.lineup).some(k => k.endsWith('-2'))).toBe(false);
    expect(clean.lockedCells).toEqual({ 'b-1': 'C' });
    expect(clean.pitcherAssignments).toEqual({});
    expect(clean.score.us).toEqual({ 1: 2 });
  });

  it('removes dropped players from a live formation but leaves recorded outs alone', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(g);
    const clean = normalizeGamePlan({ ...g, battingOrder: ids.filter(id => id !== 'a') });
    expect(clean.live?.assignments.a).toBeUndefined();
    expect(clean.outs[0].assignments.a).toBe('P');
  });
});

describe('applyPlanSwap (H10)', () => {
  it('keeps lineup, locks, and pitcher assignments consistent through a displacement', () => {
    const g = plannedGame();
    const withLocks: Game = {
      ...g,
      lockedCells: { 'a-1': 'P' },
      pitcherAssignments: { 1: 'a' }
    };
    // b takes P in inning 1; a (locked at P) is displaced to b's old spot (C)
    const { game: swapped, changes } = applyPlanSwap(withLocks, roster[1], 1, 'P', roster);
    expect(swapped.lineup['b-1']).toBe('P');
    expect(swapped.lineup['a-1']).toBe('C');
    // The displaced lock followed the player - no lock still claiming P for a
    expect(swapped.lockedCells['a-1']).toBe('C');
    expect(swapped.lockedCells['b-1']).toBe('P');
    // Pitcher map points at the actual pitcher
    expect(swapped.pitcherAssignments[1]).toBe('b');
    expect(changes).toHaveLength(2);
    // The invariant checker agrees
    expect(validateGamePlan(swapped)).toEqual([]);
  });

  it('validateGamePlan catches duplicate positions', () => {
    const g = plannedGame();
    const broken: Game = { ...g, lineup: { ...g.lineup, 'b-1': 'P' } }; // a AND b at P
    expect(validateGamePlan(broken).some(i => i.includes('2 players at P'))).toBe(true);
  });
});

describe('completion contract enforcement (domain-level)', () => {
  it('completeGame throws when a pitcher has no reviewed confirmation', () => {
    let g = startLiveGame(plannedGame());
    g = endInningOuts(g); // player a pitched inning 1
    expect(() => completeGame(g, [], roster)).toThrow(/without a reviewed pitch count/);
    // Partial confirmation lists are rejected the same way
    let g2 = startLiveGame(plannedGame());
    g2 = setInningPitches(g2, 'x-counter-only', 1, 4);
    g2 = endInningOuts(g2);
    expect(() => completeGame(g2, [{ playerId: 'a', pitches: 10 }], roster)).toThrow();
    // The full list completes fine
    expect(
      completeGame(g2, [
        { playerId: 'a', pitches: 10 },
        { playerId: 'x-counter-only', pitches: 4 }, {playerId:'j',pitches:0}
      ], roster).status
    ).toBe('completed');
  });
});

describe('participation corrections (out ledger editor)', () => {
  function completedTwoInnings(): Game {
    let g = startLiveGame(plannedGame());
    g = endInningOuts(g);
    g = endInningOuts(g);
    return completeGame(g, [{ playerId: 'a', pitches: 20 }, { playerId: 'j', pitches: 15 }], roster);
  }

  it('editOutAssignments replaces one snapshot and clears its estimated flag', () => {
    const g = completedTwoInnings();
    const fixed = editOutAssignments(g, 2, { ...g.outs[1].assignments, a: '1B', c: 'P' });
    expect(fixed.outs[1].assignments.a).toBe('1B');
    expect(fixed.outs[1].assignments.c).toBe('P');
    expect(fixed.outs[0].assignments.a).toBe('P'); // neighbors untouched
    // Derived pitching outs follow the correction
    expect(pitchingOutsByPlayer(fixed).a).toBe(2);
    expect(pitchingOutsByPlayer(fixed).c).toBe(1);
  });

  it('insertOutAfter adds a missed out and renumbers into 3-out innings', () => {
    const g = completedTwoInnings();
    const withInsert = insertOutAfter(g, 3);
    expect(withInsert.outs).toHaveLength(7);
    expect(withInsert.outs.map(o => o.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(withInsert.outs[3].inning).toBe(2);
    expect(withInsert.outs[3].outInInning).toBe(1);
    // The inserted out clones the adjacent formation for easy correction
    expect(withInsert.outs[3].assignments).toEqual(g.outs[2].assignments);
  });

  it('deleteOutAt removes an out and shifts the ledger up', () => {
    const g = completedTwoInnings();
    const without = deleteOutAt(g, 1);
    expect(without.outs).toHaveLength(5);
    expect(without.outs[0].seq).toBe(1);
    // a pitched inning 1 (3 outs) originally; now 2 outs remain in inning 1
    expect(pitchingOutsByPlayer(without).a).toBe(2);
  });
});

describe('exit interactions with undo (formation hygiene)', () => {
  it('undoOut does not resurrect a player who exited after the out', () => {
    let g = startLiveGame(plannedGame());
    g = recordOut(g);
    // player d exits during inning 1
    g = { ...g, exitedPlayers: { d: 1 } };
    const assignments = { ...g.live!.assignments };
    delete assignments.d;
    g = { ...g, live: { ...g.live!, assignments } };
    g = undoOut(g);
    expect(g.live?.assignments.d).toBeUndefined();
    expect(g.outs).toHaveLength(0);
  });

  it('validateFormation flags exited players still in the formation', () => {
    const issues = validateFormation({ a: 'P', gone: 'C' }, ['a'], 9);
    expect(issues.some(i => i.type === 'inactive')).toBe(true);
  });
});


describe('explicit end of scheduled innings', () => {
  function finished() {
    let game = startLiveGame(makeGame({innings:6, battingOrder:['p'], lineup:Object.fromEntries(Array.from({length:6},(_,i)=>[`p-${i+1}`,'P']))}));
    for (let i=0;i<18;i++) game=recordOut(game);
    return game;
  }
  it('stops at three outs in six, persists, and refuses a nineteenth out', () => {
    const game=finished();
    expect(game.innings).toBe(6);
    expect(game.live).toMatchObject({inning:6,outsRecorded:3});
    expect(recordOut(JSON.parse(JSON.stringify(game))).outs).toHaveLength(18);
    expect(endInningOuts(game)).toEqual(game);
    expect(undoOut(game).live).toMatchObject({inning:6,outsRecorded:2});
  });
  it('extends defense and pitcher plan explicitly and allows resolving until activity', () => {
    const before=finished(), game=addScheduledInning(before);
    expect(game.live).toMatchObject({inning:7,outsRecorded:0,preparing:true});
    expect(game.lineup['p-7']).toBe('P');
    expect(game.pitcherAssignments[7]).toBe('p');
    expect(game.outs).toEqual(before.outs);
    expect(firstSolvableInning(game)).toBe(7);
    expect(hydratePreparedInning(game).live?.assignments).toEqual({p:'P'});
    expect(firstSolvableInning(recordOut(game))).toBe(8);
    expect(firstSolvableInning(setInningPitches(game,'p',7,1))).toBe(8);
    expect(firstSolvableInning(updateInningRuns(game,'us',7,1))).toBe(8);
  });
});
