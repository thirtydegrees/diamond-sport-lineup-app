import { describe, expect, it } from 'vitest';
import { DEMO_ROSTER, POSITIONS } from './constants';
import { Solver } from './solver';
import type { LineupMap, Player, Position } from './types';

/** Build a flexible test player who can play anywhere. */
function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  const positions: Player['positions'] = {};
  POSITIONS.forEach(pos => { positions[pos] = 'canPlay'; });
  return {
    id,
    name: `Player ${id}`,
    canPitch: true,
    prefersPitching: false,
    canCatch: true,
    positions,
    preferredOrder: [],
    ...overrides,
    ...(overrides.positions ? { positions: { ...positions, ...overrides.positions } } : {})
  };
}

function makeRoster(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => makePlayer(String(i + 1)));
}

/** Assert every inning has exactly the 9 positions filled once. */
function assertValidInnings(solution: LineupMap, players: Player[], innings: number) {
  for (let inning = 1; inning <= innings; inning++) {
    const filled: string[] = [];
    for (const p of players) {
      const pos = solution[`${p.id}-${inning}`];
      expect(pos, `player ${p.id} has no assignment in inning ${inning}`).toBeTruthy();
      if (pos !== 'SIT') filled.push(pos);
    }
    expect(filled.sort(), `inning ${inning} positions`).toEqual([...POSITIONS].sort());
  }
}

describe('Solver.solve - feasibility', () => {
  it('fails with fewer than 9 players', () => {
    const result = Solver.solve({ players: makeRoster(8), innings: 6 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 9/);
  });

  it('solves exactly 9 players with no sits', () => {
    const players = makeRoster(9);
    const result = Solver.solve({ players, innings: 6 });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, players, 6);
    Object.values(result.sitCounts!).forEach(sits => expect(sits).toBe(0));
  });

  it('solves the 12-player demo roster over 6 innings', () => {
    const result = Solver.solve({ players: DEMO_ROSTER, innings: 6 });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, DEMO_ROSTER, 6);
  });

  it('solves 13 players over 7 innings', () => {
    const players = makeRoster(13);
    const result = Solver.solve({ players, innings: 7, maxSitsPerGame: 3 });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, players, 7);
  });
});

describe('Solver.solve - hard constraints', () => {
  it('never assigns P to a player who cannot pitch', () => {
    const players = makeRoster(10).map((p, i) =>
      i < 8 ? { ...p, canPitch: false } : p
    );
    const result = Solver.solve({ players, innings: 6 });
    expect(result.success).toBe(true);
    for (let inning = 1; inning <= 6; inning++) {
      for (const p of players) {
        if (result.solution![`${p.id}-${inning}`] === 'P') {
          expect(p.canPitch).toBe(true);
        }
      }
    }
  });

  it('never assigns C to a player who cannot catch', () => {
    const players = makeRoster(10).map((p, i) =>
      i < 8 ? { ...p, canCatch: false } : p
    );
    const result = Solver.solve({ players, innings: 6 });
    expect(result.success).toBe(true);
    for (let inning = 1; inning <= 6; inning++) {
      for (const p of players) {
        if (result.solution![`${p.id}-${inning}`] === 'C') {
          expect(p.canCatch).toBe(true);
        }
      }
    }
  });

  it('never places a player at P and C in consecutive innings', () => {
    const players = makeRoster(10);
    const result = Solver.solve({ players, innings: 7 });
    expect(result.success).toBe(true);
    for (const p of players) {
      for (let inning = 1; inning < 7; inning++) {
        const cur = result.solution![`${p.id}-${inning}`];
        const next = result.solution![`${p.id}-${inning + 1}`];
        const battery = (cur === 'P' && next === 'C') || (cur === 'C' && next === 'P');
        expect(battery, `${p.id} plays ${cur}->${next} in innings ${inning}-${inning + 1}`).toBe(false);
      }
    }
  });

  it('keeps each player\'s pitching innings contiguous', () => {
    const players = makeRoster(11);
    const result = Solver.solve({ players, innings: 7 });
    expect(result.success).toBe(true);
    for (const p of players) {
      const pitchingInnings: number[] = [];
      for (let inning = 1; inning <= 7; inning++) {
        if (result.solution![`${p.id}-${inning}`] === 'P') pitchingInnings.push(inning);
      }
      for (let i = 1; i < pitchingInnings.length; i++) {
        expect(pitchingInnings[i] - pitchingInnings[i - 1]).toBe(1);
      }
    }
  });

  it('honors locked cells', () => {
    const players = makeRoster(10);
    const lockedCells: LineupMap = { '3-2': 'SS', '5-4': 'SIT' };
    const result = Solver.solve({ players, innings: 6, lockedCells });
    expect(result.success).toBe(true);
    expect(result.solution!['3-2']).toBe('SS');
    expect(result.solution!['5-4']).toBe('SIT');
  });

  it('honors pitcher assignments per inning', () => {
    const players = makeRoster(10);
    const result = Solver.solve({
      players,
      innings: 6,
      pitcherAssignments: { 1: '7', 2: '7', 3: '2' }
    });
    expect(result.success).toBe(true);
    expect(result.solution!['7-1']).toBe('P');
    expect(result.solution!['7-2']).toBe('P');
    expect(result.solution!['2-3']).toBe('P');
  });

  it('never assigns an avoided position without an override', () => {
    const players = makeRoster(10).map(p =>
      p.id === '1' ? { ...p, positions: { ...p.positions, SS: 'avoid' as const } } : p
    );
    const result = Solver.solve({ players, innings: 6 });
    expect(result.success).toBe(true);
    for (let inning = 1; inning <= 6; inning++) {
      expect(result.solution![`1-${inning}`]).not.toBe('SS');
    }
  });
});

describe('Solver.solve - avoid overrides', () => {
  // Only player 1 can catch, but has C marked avoid: unsolvable without override
  const players = makeRoster(9).map(p => {
    if (p.id === '1') {
      return { ...p, canCatch: true, positions: { ...p.positions, C: 'avoid' as const } };
    }
    return { ...p, canCatch: false };
  });

  it('reports the blocking avoid assignment', () => {
    const result = Solver.solve({ players, innings: 6 });
    expect(result.success).toBe(false);
    expect(result.needsOverride).toBe(true);
    expect(result.avoidBlockers![0].position).toBe('C');
    expect(result.avoidBlockers![0].players.map(p => p.id)).toContain('1');
  });

  it('solves once the override is granted', () => {
    const result = Solver.solve({
      players,
      innings: 6,
      avoidOverrides: [{ playerId: '1', position: 'C' as Position }]
    });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, players, 6);
  });
});

describe('Solver.solve - sit balancing', () => {
  it('keeps everyone within maxSitsPerGame when capacity allows', () => {
    const players = makeRoster(12);
    const result = Solver.solve({ players, innings: 6, maxSitsPerGame: 2 });
    expect(result.success).toBe(true);
    Object.values(result.sitCounts!).forEach(sits => {
      expect(sits).toBeLessThanOrEqual(2);
    });
  });

  it('spreads sits evenly (gap of at most 1)', () => {
    const players = makeRoster(12);
    const result = Solver.solve({ players, innings: 6, maxSitsPerGame: 2 });
    expect(result.success).toBe(true);
    const sits = Object.values(result.sitCounts!);
    expect(Math.max(...sits) - Math.min(...sits)).toBeLessThanOrEqual(1);
  });

  it('requests a sit override when the max is impossible (the silent-fill bug)', () => {
    // 12 players, 6 innings => 18 sits needed, but max 1 sit each = 12 capacity
    const players = makeRoster(12);
    const result = Solver.solve({ players, innings: 6, maxSitsPerGame: 1 });
    expect(result.success).toBe(false);
    expect(result.needsSitOverride).toBe(true);
    expect(result.sitOverrideNeeded!.length).toBeGreaterThan(0);
  });

  it('solves after granting sit overrides', () => {
    const players = makeRoster(12);
    const result = Solver.solve({
      players,
      innings: 6,
      maxSitsPerGame: 1,
      sitOverrides: players.map(p => p.id)
    });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, players, 6);
  });
});

describe('Solver.solve - partial re-solve', () => {
  it('preserves innings before startInning and re-solves the rest', () => {
    const players = makeRoster(10);
    const first = Solver.solve({ players, innings: 6 });
    expect(first.success).toBe(true);

    const result = Solver.solve({
      players,
      innings: 6,
      startInning: 4,
      existingPlan: first.solution!
    });
    expect(result.success).toBe(true);
    // Innings 1-3 unchanged
    for (let inning = 1; inning <= 3; inning++) {
      for (const p of players) {
        expect(result.solution![`${p.id}-${inning}`]).toBe(first.solution![`${p.id}-${inning}`]);
      }
    }
    assertValidInnings(result.solution!, players, 6);
  });
});

describe('Solver.calculateSwapChanges', () => {
  it('reports a simple move with displacement', () => {
    const players = [makePlayer('1'), makePlayer('2')];
    const solution: LineupMap = { '1-3': 'SS', '2-3': '1B' };
    const changes = Solver.calculateSwapChanges(solution, players[0], 3, '1B', players);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ playerId: '1', from: 'SS', to: '1B', type: 'manual' });
    expect(changes[1]).toMatchObject({ playerId: '2', from: '1B', to: 'SS', type: 'displaced' });
  });

  it('moving to SIT displaces nobody', () => {
    const players = [makePlayer('1'), makePlayer('2')];
    const solution: LineupMap = { '1-3': 'SS', '2-3': '1B' };
    const changes = Solver.calculateSwapChanges(solution, players[0], 3, 'SIT', players);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ playerId: '1', from: 'SS', to: 'SIT', type: 'manual' });
  });
});
