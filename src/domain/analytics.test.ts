import { describe, expect, it } from 'vitest';
import { computePitchingStats, computeSeasonStats, shiftISO } from './analytics';
import type { Game, PitchRecord, Player } from './types';

function player(id: string, name: string): Player {
  return {
    id, name,
    canPitch: true, prefersPitching: false, canCatch: true,
    positions: {}, preferredOrder: []
  };
}

function game(id: string, date: string, lineup: Record<string, string>, opponent = ''): Game {
  return {
    id, date, opponent,
    innings: 6, fielderCount: 9,
    battingOrder: [], availability: {},
    pitcherAssignments: {}, lockedCells: {},
    lineup: lineup as Game['lineup'],
    score: { us: {}, them: {} },
    pitchLog: {}, currentInning: 1, exitedPlayers: {}
  };
}

const roster = [player('a', 'Ann'), player('b', 'Ben'), player('c', 'Cal')];

describe('computeSeasonStats', () => {
  const games = [
    game('g1', '2026-06-01', {
      'a-1': 'P', 'a-2': 'P', 'a-3': 'SS', 'a-4': 'SIT',
      'b-1': 'C', 'b-2': 'LF', 'b-3': 'LF', 'b-4': 'CF'
    }),
    game('g2', '2026-06-08', {
      'a-1': '1B', 'a-2': 'SIT',
      'b-1': 'SIT', 'b-2': 'SIT'
    })
  ];

  it('aggregates innings by position group across games', () => {
    const [ann, ben, cal] = computeSeasonStats(games, roster);
    expect(ann.byGroup).toEqual({ P: 2, C: 0, IF: 2, OF: 0, SIT: 2 });
    expect(ann.innings).toBe(6);
    expect(ann.gamesPlayed).toBe(2);
    expect(ann.byPosition.SS).toBe(1);

    expect(ben.byGroup).toEqual({ P: 0, C: 1, IF: 0, OF: 3, SIT: 2 });
    expect(ben.sits).toBe(2);
    expect(ben.sitShare).toBeCloseTo(2 / 6);

    // Cal never played but still appears with zeros
    expect(cal.innings).toBe(0);
    expect(cal.gamesPlayed).toBe(0);
  });

  it('counts SC as outfield', () => {
    const [ann] = computeSeasonStats([game('g', '2026-06-01', { 'a-1': 'SC' })], roster);
    expect(ann.byGroup.OF).toBe(1);
  });

  it('filters by date range', () => {
    const [ann] = computeSeasonStats(games, roster, { from: '2026-06-05' });
    expect(ann.innings).toBe(2); // only g2
    expect(ann.gamesPlayed).toBe(1);
  });

  it('ignores players no longer on the roster', () => {
    const stats = computeSeasonStats([game('g', '2026-06-01', { 'ghost-1': 'P' })], roster);
    expect(stats.every(s => s.innings === 0)).toBe(true);
  });
});

describe('computePitchingStats', () => {
  const rec = (playerId: string, gameId: string, date: string, pitches: number, inningsPitched?: number): PitchRecord =>
    ({ id: `${playerId}-${gameId}`, playerId, gameId, date, pitches, innings: {}, inningsPitched });

  const games = [game('g1', '2026-06-29', {}, 'Tigers'), game('g2', '2026-07-04', {}, 'Bears')];
  const history = [
    rec('a', 'g2', '2026-07-04', 45, 3),
    rec('a', 'g1', '2026-06-29', 30, 2),
    rec('b', 'g1', '2026-06-29', 12, 1)
  ];

  it('totals workload and sorts heaviest first', () => {
    const stats = computePitchingStats(history, roster, games, '2026-07-06');
    expect(stats[0].name).toBe('Ann');
    expect(stats[0].totalPitches).toBe(75);
    expect(stats[0].totalInnings).toBe(5);
    expect(stats[0].avgPitches).toBe(38);
    expect(stats[1].totalPitches).toBe(12);
  });

  it('orders per-game loads chronologically and attaches opponents', () => {
    const [ann] = computePitchingStats(history, roster, games, '2026-07-06');
    expect(ann.perGame.map(g => g.date)).toEqual(['2026-06-29', '2026-07-04']);
    expect(ann.perGame[1].opponent).toBe('Bears');
  });

  it('computes a 7-day window inclusive of today', () => {
    const [ann] = computePitchingStats(history, roster, games, '2026-07-06');
    // window = 06-30..07-06: only the 45-pitch outing counts
    expect(ann.last7Pitches).toBe(45);
    const later = computePitchingStats(history, roster, games, '2026-07-12');
    expect(later[0].last7Pitches).toBe(0);
  });

  it('derives innings pitched from the pitch log when not stored', () => {
    const legacy: PitchRecord = {
      id: 'x', playerId: 'b', gameId: 'g2', date: '2026-07-04',
      pitches: 20, innings: { 3: 12, 4: 8 }
    };
    const stats = computePitchingStats([legacy], roster, games, '2026-07-06');
    expect(stats[0].totalInnings).toBe(2);
  });
});

describe('shiftISO', () => {
  it('shifts across month boundaries', () => {
    expect(shiftISO('2026-07-03', -6)).toBe('2026-06-27');
    expect(shiftISO('2026-06-27', 6)).toBe('2026-07-03');
  });
});
