import { externalPitchingGame, isOutsideWorkload } from '../domain/games';
import { deriveOutings } from '../domain/pitching';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackupError, buildBackup, validateBackup, restoreBackup } from './backup';
import { Storage } from './storage';
import { completedOuting, makePlayer } from '../test/fixtures';

// Minimal localStorage shim for node
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }
};

function seedDevice() {
  store.clear();
  Storage.saveRoster([makePlayer('a', 'Ava')]);
  Storage.saveGames([completedOuting('g1', '2026-07-01', 'a', 20)]);
}

describe('validateBackup', () => {
  it('accepts a round-tripped v2 backup', () => {
    seedDevice();
    const backup = JSON.parse(JSON.stringify(buildBackup()));
    const validated = validateBackup(backup);
    expect(validated.fromVersion).toBe(2);
    expect(validated.data.roster).toHaveLength(1);
    expect(validated.data.games).toHaveLength(1);
  });

  it('accepts a v1 flat backup and migrates its games', () => {
    const v1 = {
      roster: [makePlayer('a', 'Ava')],
      settings: {},
      currentGame: null,
      games: [{
        id: 'g1', date: '2026-05-10', opponent: '', innings: 1, fielderCount: 9,
        battingOrder: ['a'], availability: {}, pitcherAssignments: {}, lockedCells: {},
        lineup: { 'a-1': 'P' }, score: { us: {}, them: {} },
        pitchLog: { a: { 1: 9 } }, currentInning: 1, exitedPlayers: {}
      }],
      pitchHistory: [{ id: 'r', playerId: 'a', gameId: 'g1', date: '2026-05-10', pitches: 9, innings: { 1: 9 } }],
      defaultBattingOrder: null,
      exportDate: '2026-05-11T00:00:00Z'
    };
    const validated = validateBackup(v1);
    expect(validated.fromVersion).toBe(1);
    expect(validated.data.games[0].status).toBe('completed');
    expect(validated.data.games[0].participationQuality).toBe('estimated');
    expect(validated.data.games[0].pitchCounts.a.confirmed).toBe(9);
  });

  const bad = (v: unknown) => () => validateBackup(v);

  it('rejects non-backups and malformed pieces without touching storage', () => {
    expect(bad(null)).toThrow(BackupError);
    expect(bad('hello')).toThrow(BackupError);
    expect(bad({ foo: 1 })).toThrow(BackupError);
    expect(bad({ roster: 'nope' })).toThrow(BackupError);
    expect(bad({ roster: [{ noId: true }] })).toThrow(BackupError);
    expect(bad({ roster: [], games: 'nope' })).toThrow(BackupError);
    expect(bad({ roster: [], games: [{ id: 1 }] })).toThrow(BackupError);
    expect(bad({ roster: [], defaultBattingOrder: 42 })).toThrow(BackupError);
    expect(bad({ app: 'diamond-lineup', version: 99, data: { roster: [] } })).toThrow(/newer/);
  });

  it('explicit nulls survive validation as clears (H2/H11)', () => {
    seedDevice();
    const backup = JSON.parse(JSON.stringify(buildBackup()));
    backup.data.currentGame = null;
    backup.data.defaultBattingOrder = null;
    const validated = validateBackup(backup);
    expect(validated.data.currentGame).toBeNull();
    expect(validated.data.defaultBattingOrder).toBeNull();
  });
});

describe('restoreBackup atomicity (H11)', () => {
  beforeEach(seedDevice);

  it('a successful restore replaces the dataset including clears', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup()));
    backup.data.roster = [makePlayer('z', 'Zoe')];
    backup.data.games = [];
    const ok = restoreBackup(validateBackup(backup));
    expect(ok).toBe(true);
    expect(Storage.getRoster()[0].name).toBe('Zoe');
    expect(Storage.getGames()).toEqual([]);
  });

  it('an atomic snapshot write failure leaves the prior dataset intact', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup()));
    backup.data.roster = [makePlayer('z', 'Zoe')];
    const validated = validateBackup(backup);

    // Make the games write fail
    const shim = (globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage;
    const originalSet = shim.setItem;
    shim.setItem = (k: string, v: string) => {
      if (k === 'ybl_state_v3') throw new Error('quota exceeded');
      originalSet(k, v);
    };
    const ok = restoreBackup(validated);
    shim.setItem = originalSet;

    expect(ok).toBe(false);
    // Prior data intact - no hybrid state
    expect(Storage.getRoster()[0].name).toBe('Ava');
    expect(Storage.getGames()).toHaveLength(1);
  });
});

describe('deep v2 validation (malformed nested structures)', () => {
  function v2With(gamePatch: Record<string, unknown>) {
    seedDevice();
    const backup = JSON.parse(JSON.stringify(buildBackup()));
    backup.data.games[0] = { ...backup.data.games[0], ...gamePatch };
    return backup;
  }

  it('rejects null out entries', () => {
    expect(() => validateBackup(v2With({ outs: [null] }))).toThrow(BackupError);
  });

  it('rejects an out without assignments', () => {
    expect(() => validateBackup(v2With({ outs: [{ seq: 1, inning: 1, outInInning: 1 }] }))).toThrow(/assignments/);
  });

  it('rejects invalid assignment values inside an out', () => {
    expect(() => validateBackup(v2With({
      outs: [{ seq: 1, inning: 1, outInInning: 1, assignments: { a: 'QB' } }]
    }))).toThrow(/invalid assignment/);
  });

  it('rejects invalid out numbers and innings', () => {
    expect(() => validateBackup(v2With({
      outs: [{ seq: 1, inning: 0, outInInning: 1, assignments: { a: 'P' } }]
    }))).toThrow(/invalid inning/);
    expect(() => validateBackup(v2With({
      outs: [{ seq: 1, inning: 1, outInInning: 7, assignments: { a: 'P' } }]
    }))).toThrow(/invalid out number/);
  });

  it('rejects malformed pitch-count entries', () => {
    expect(() => validateBackup(v2With({ pitchCounts: { a: { live: 'many' } } }))).toThrow(BackupError);
    expect(() => validateBackup(v2With({
      pitchCounts: { a: { live: 5, byInning: {}, confirmed: -3, status: 'confirmed' } }
    }))).toThrow(/invalid confirmed/);
    expect(() => validateBackup(v2With({
      pitchCounts: { a: { live: 5, byInning: {}, confirmed: null, status: 'maybe' } }
    }))).toThrow(/status/);
  });

  it('rejects malformed live state', () => {
    expect(() => validateBackup(v2With({ status: 'live', live: { inning: 'one' } }))).toThrow(/live state/);
  });
});


describe('outside workload classification', () => {
  it('survives backup hydration and counts as workload without replacing the last game', () => {
    seedDevice();
    const outside = externalPitchingGame('outside', '2026-07-02', makePlayer('a', 'Ava'), 25, 'Summer camp');
    Storage.saveGames([...Storage.getGames(), outside]);
    const restored = validateBackup(JSON.parse(JSON.stringify(buildBackup()))).data.games;
    expect(isOutsideWorkload(restored[1])).toBe(true);
    expect(deriveOutings(restored).find(o => o.gameId === 'outside')?.pitches).toBe(25);
    expect(Storage.getLastGame()?.id).toBe('g1');
    Storage.saveGames([outside]);
    expect(Storage.getLastGame()).toBeNull();
  });
});
