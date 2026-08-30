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

  it('a mid-import write failure rolls the device back to its prior state', () => {
    const backup = JSON.parse(JSON.stringify(buildBackup()));
    backup.data.roster = [makePlayer('z', 'Zoe')];
    const validated = validateBackup(backup);

    // Make the games write fail
    const shim = (globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage;
    const originalSet = shim.setItem;
    shim.setItem = (k: string, v: string) => {
      if (k === 'ybl_games') throw new Error('quota exceeded');
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
