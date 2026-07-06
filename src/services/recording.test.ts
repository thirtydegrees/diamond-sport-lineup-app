import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../domain/ids';
import { Storage } from './storage';
import type { Game } from '../domain/types';

// Minimal localStorage shim for node
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }
};

function gameWithPitchers(): Game {
  return {
    id: 'g1', date: '2026-07-06', opponent: 'Tigers',
    innings: 6, fielderCount: 9,
    battingOrder: [], availability: {}, pitcherAssignments: {}, lockedCells: {},
    lineup: { 'a-1': 'P', 'b-2': 'P', 'b-3': 'P', 'c-4': 'P' } as Game['lineup'],
    score: { us: {}, them: {} },
    pitchLog: { a: { 1: 12 } },
    currentInning: 1, exitedPlayers: {}
  };
}

describe('newId', () => {
  it('never collides, even generated in a tight loop', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
  });
});

describe('recordGamePitching', () => {
  beforeEach(() => store.clear());

  it('writes one record per pitcher with unique ids', () => {
    Storage.recordGamePitching(gameWithPitchers());
    const history = Storage.getPitchHistory();
    expect(history).toHaveLength(3);
    expect(new Set(history.map(r => r.id)).size).toBe(3);
    const b = history.find(r => r.playerId === 'b')!;
    expect(b.inningsPitched).toBe(2);
    const a = history.find(r => r.playerId === 'a')!;
    expect(a.pitches).toBe(12);
  });

  it('a later pitch-count update touches only the target pitcher (id-collision regression)', () => {
    // The original bug: all records created in one save shared a Date.now()
    // id, so updating "by id" in the UI overwrote every pitcher's workload.
    Storage.recordGamePitching(gameWithPitchers());
    Storage.addPitchRecord({
      playerId: 'a', gameId: 'g1', date: '2026-07-06',
      pitches: 25, innings: { 1: 25 }
    });
    const history = Storage.getPitchHistory();
    expect(history.find(r => r.playerId === 'a')!.pitches).toBe(25);
    expect(history.find(r => r.playerId === 'b')!.pitches).toBe(0);
    expect(history.find(r => r.playerId === 'c')!.pitches).toBe(0);
  });

  it('re-saving the same game updates records instead of duplicating them', () => {
    const game = gameWithPitchers();
    Storage.recordGamePitching(game);
    Storage.recordGamePitching(game);
    expect(Storage.getPitchHistory()).toHaveLength(3);
  });
});
