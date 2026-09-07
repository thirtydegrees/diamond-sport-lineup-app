import { describe, expect, it } from 'vitest';
import { migrateCurrentGameV1, migrateSavedGameV1 } from './migrate';
import { deriveOutings, assessPitcherRest } from '../domain/pitching';
import { participationByPlayer } from '../domain/games';
import { DEFAULT_SETTINGS } from '../domain/constants';
import { makePlayer } from '../test/fixtures';
import type { PitchRecord } from '../domain/types';

const roster = [makePlayer('a', 'Ava'), makePlayer('b', 'Ben'), makePlayer('c', 'Cy')];

/** A v1 saved game: a pitched innings 1-2, b caught, c sat inning 1 then played 1B. */
const v1Game = {
  id: 'g1',
  date: '2026-05-10',
  opponent: 'Hawks',
  innings: 2,
  fielderCount: 9 as const,
  battingOrder: ['a', 'b', 'c'],
  availability: {},
  pitcherAssignments: { 1: 'a', 2: 'a' },
  lockedCells: {},
  lineup: {
    'a-1': 'P', 'a-2': 'P',
    'b-1': 'C', 'b-2': 'C',
    'c-1': 'SIT', 'c-2': '1B'
  },
  score: { us: { 1: 3 }, them: { 1: 1 } },
  pitchLog: { a: { 1: 12, 2: 15 } },
  currentInning: 2,
  exitedPlayers: {}
};

const v1Records: PitchRecord[] = [
  { id: 'r1', playerId: 'a', gameId: 'g1', date: '2026-05-10', pitches: 27, innings: { 1: 12, 2: 15 }, inningsPitched: 2 }
];

describe('migrateSavedGameV1', () => {
  it('expands each planned inning into three estimated outs, preserving totals', () => {
    const g = migrateSavedGameV1(v1Game, v1Records, roster);
    expect(g.status).toBe('completed');
    expect(g.participationQuality).toBe('estimated');
    expect(g.outs).toHaveLength(6); // 2 innings x 3 outs
    expect(g.outs.every(o => o.estimated)).toBe(true);

    const parts = participationByPlayer(g);
    expect(parts.a.P).toBe(6);
    expect(parts.c.SIT).toBe(3);
    expect(parts.c['1B']).toBe(3);
  });

  it('carries pitch totals over as CONFIRMED counts', () => {
    const g = migrateSavedGameV1(v1Game, v1Records, roster);
    expect(g.pitchCounts.a).toMatchObject({ confirmed: 27, status: 'confirmed' });
    const outings = deriveOutings([g]);
    expect(outings).toHaveLength(1);
    expect(outings[0]).toMatchObject({ pitches: 27, pitchingOuts: 6, estimated: true });
  });

  it('migrated workload drives eligibility exactly like new data', () => {
    const g = migrateSavedGameV1(v1Game, v1Records, roster);
    // 27 pitches -> 1 rest day under default rules
    expect(assessPitcherRest('a', '2026-05-10', [g], DEFAULT_SETTINGS.pitchRules).eligible).toBe(false);
    expect(assessPitcherRest('a', '2026-05-12', [g], DEFAULT_SETTINGS.pitchRules).eligible).toBe(true);
  });

  it('snapshots player names from the roster', () => {
    const g = migrateSavedGameV1(v1Game, v1Records, roster);
    expect(g.playerNames.a).toBe('Ava');
  });

  it('respects exited players (no estimated outs after the exit inning)', () => {
    const withExit = { ...v1Game, exitedPlayers: { c: 2 }, lineup: { ...v1Game.lineup } };
    delete (withExit.lineup as Record<string, string>)['c-2'];
    const g = migrateSavedGameV1(withExit, v1Records, roster);
    const parts = participationByPlayer(g);
    expect(parts.c['1B']).toBeUndefined();
    expect(parts.c.SIT).toBe(3); // inning 1 only
  });

  it('passes a v2 game through untouched', () => {
    const g = migrateSavedGameV1(v1Game, v1Records, roster);
    expect(migrateSavedGameV1(g, [], roster)).toBe(g);
  });
});

describe('migrateCurrentGameV1', () => {
  it('the active v1 game becomes a DRAFT plan with zero migrated outs (H8)', () => {
    const g = migrateCurrentGameV1(v1Game, roster);
    expect(g.status).toBe('draft');
    expect(g.outs).toHaveLength(0);
    // The lineup survives as the plan
    expect(g.lineup['a-1']).toBe('P');
    // Working pitch counts survive as unconfirmed
    expect(g.pitchCounts.a).toMatchObject({ live: 27, status: 'live', confirmed: null });
    // currentInning is NOT trusted as a completion marker
    expect(deriveOutings([g])).toHaveLength(0);
  });
});
