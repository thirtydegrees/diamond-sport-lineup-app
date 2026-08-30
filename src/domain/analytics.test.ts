import { describe, expect, it } from 'vitest';
import { computePitchingStats, computeSeasonStats, shiftISO } from './analytics';
import { completedOuting, confirmedCount, makeGame, makePlayer, outsFromInnings } from '../test/fixtures';
import type { Game } from './types';

const roster = [makePlayer('a', 'Ava'), makePlayer('b', 'Ben')];

function twoInningGame(id: string, date: string): Game {
  return makeGame({
    id,
    date,
    status: 'completed',
    battingOrder: ['a', 'b'],
    playerNames: { a: 'Ava', b: 'Ben' },
    outs: outsFromInnings([
      { a: 'P', b: 'SIT' },
      { a: '1B', b: 'CF' }
    ]),
    pitchCounts: { a: confirmedCount(25) }
  });
}

describe('computeSeasonStats', () => {
  it('counts recorded outs from completed games only', () => {
    const completed = twoInningGame('g1', '2026-07-01');
    const draft = makeGame({ id: 'g2', lineup: { 'a-1': 'P' }, battingOrder: ['a'] });
    const live = makeGame({
      id: 'g3',
      status: 'live',
      outs: outsFromInnings([{ a: 'C' }])
    });

    const stats = computeSeasonStats([completed, draft, live], roster);
    const ava = stats.find(s => s.playerId === 'a')!;
    expect(ava.outs).toBe(6);
    expect(ava.byGroup.P).toBe(3);
    expect(ava.byGroup.IF).toBe(3);
    expect(ava.byGroup.C).toBe(0); // the live game contributed nothing
    const ben = stats.find(s => s.playerId === 'b')!;
    expect(ben.sitOuts).toBe(3);
    expect(ben.sitShare).toBeCloseTo(0.5);
  });

  it('keeps removed players via name snapshots (M5)', () => {
    const stats = computeSeasonStats([twoInningGame('g1', '2026-07-01')], [roster[0]]);
    const ben = stats.find(s => s.playerId === 'b')!;
    expect(ben.name).toBe('Ben');
    expect(ben.onRoster).toBe(false);
    expect(ben.outs).toBe(6);
  });

  it('filters by date range', () => {
    const games = [twoInningGame('g1', '2026-07-01'), twoInningGame('g2', '2026-07-20')];
    const stats = computeSeasonStats(games, roster, { from: '2026-07-10' });
    expect(stats.find(s => s.playerId === 'a')!.outs).toBe(6);
  });

  it('flags estimated (migrated) participation', () => {
    const legacy = { ...twoInningGame('g1', '2026-07-01'), participationQuality: 'estimated' as const };
    const stats = computeSeasonStats([legacy], roster);
    expect(stats.find(s => s.playerId === 'a')!.estimated).toBe(true);
  });
});

describe('computePitchingStats', () => {
  it('derives per-game workload from completed games', () => {
    const games = [
      completedOuting('g1', '2026-07-01', 'a', 30, 2),
      completedOuting('g2', '2026-07-08', 'a', 40, 3)
    ];
    const [ava] = computePitchingStats(games, roster, '2026-07-08');
    expect(ava.games).toBe(2);
    expect(ava.totalPitches).toBe(70);
    expect(ava.totalPitchingOuts).toBe(15);
    expect(ava.avgPitches).toBe(35);
    expect(ava.last7Pitches).toBe(40);
    expect(ava.perGame.map(g => g.pitches)).toEqual([30, 40]);
  });

  it('unknown counts are flagged, excluded from totals, never zeroed', () => {
    const games = [
      completedOuting('g1', '2026-07-01', 'a', 30),
      completedOuting('g2', '2026-07-05', 'a', null, 2)
    ];
    const [ava] = computePitchingStats(games, roster, '2026-07-05');
    expect(ava.games).toBe(2);
    expect(ava.unknownCountGames).toBe(1);
    expect(ava.totalPitches).toBe(30);
    expect(ava.avgPitches).toBe(30); // averaged over confirmed outings only
    expect(ava.perGame[1].pitches).toBeNull();
  });

  it('deleting a game removes its workload (no stored records to orphan)', () => {
    const games = [completedOuting('g1', '2026-07-01', 'a', 30)];
    expect(computePitchingStats(games, roster, '2026-07-02')).toHaveLength(1);
    expect(computePitchingStats([], roster, '2026-07-02')).toHaveLength(0);
  });
});

describe('shiftISO', () => {
  it('shifts calendar days across month boundaries', () => {
    expect(shiftISO('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftISO('2026-07-06', -6)).toBe('2026-06-30');
  });
});
