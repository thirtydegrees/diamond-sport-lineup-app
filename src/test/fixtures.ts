/* Shared test fixtures for the v2 game model. */

import type { Assignment, DefensiveOut, Game, PitchCountEntry, Player } from '../domain/types';

export function makePlayer(id: string, name = `Player ${id}`, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name,
    canPitch: true,
    prefersPitching: false,
    canCatch: true,
    positions: {},
    preferredOrder: [],
    ...overrides
  };
}

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    schemaVersion: 2,
    id: overrides.id || 'g1',
    date: '2026-07-06',
    opponent: 'Tigers',
    innings: 6,
    fielderCount: 9,
    battingOrder: [],
    availability: {},
    pitcherAssignments: {},
    lockedCells: {},
    lineup: {},
    score: { us: {}, them: {} },
    status: 'draft',
    live: null,
    outs: [],
    pitchCounts: {},
    playerNames: {},
    exitedPlayers: {},
    ...overrides
  };
}

/** Build an out ledger from per-inning formations (3 outs per inning). */
export function outsFromInnings(
  formations: Record<string, Assignment>[]
): DefensiveOut[] {
  const outs: DefensiveOut[] = [];
  let seq = 1;
  formations.forEach((assignments, i) => {
    for (let o = 1; o <= 3; o++) {
      outs.push({ seq: seq++, inning: i + 1, outInInning: o as 1 | 2 | 3, assignments: { ...assignments } });
    }
  });
  return outs;
}

export function confirmedCount(pitches: number): PitchCountEntry {
  return { live: pitches, byInning: {}, confirmed: pitches, status: 'confirmed' };
}

export function unknownCount(live = 0): PitchCountEntry {
  return { live, byInning: {}, confirmed: null, status: 'unknown' };
}

/** A completed game where `pitcherId` threw `pitches` over `inningsPitched` innings. */
export function completedOuting(
  gameId: string,
  date: string,
  pitcherId: string,
  pitches: number | null,
  inningsPitched = 1
): Game {
  const formation: Record<string, Assignment> = { [pitcherId]: 'P' };
  const formations = Array.from({ length: inningsPitched }, () => formation);
  return makeGame({
    id: gameId,
    date,
    status: 'completed',
    battingOrder: [pitcherId],
    outs: outsFromInnings(formations),
    pitchCounts: {
      [pitcherId]: pitches === null ? unknownCount() : confirmedCount(pitches)
    }
  });
}
