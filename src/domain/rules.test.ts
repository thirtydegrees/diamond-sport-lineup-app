import { describe, expect, it } from 'vitest';
import { getFieldingPositions, POSITIONS, POSITIONS_10 } from './constants';
import { CUSTOM_PRESET_ID, getPreset, getPresetsForSport, PITCH_RULE_PRESETS } from './presets';
import { Solver } from './solver';
import type { LineupMap, Player, Position } from './types';

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  const positions: Player['positions'] = {};
  POSITIONS_10.forEach(pos => { positions[pos] = 'canPlay'; });
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

function assertValidInnings(
  solution: LineupMap,
  players: Player[],
  innings: number,
  fieldingPositions: Position[] = POSITIONS
) {
  for (let inning = 1; inning <= innings; inning++) {
    const filled: string[] = [];
    for (const p of players) {
      const pos = solution[`${p.id}-${inning}`];
      expect(pos, `player ${p.id} has no assignment in inning ${inning}`).toBeTruthy();
      if (pos !== 'SIT') filled.push(pos);
    }
    expect(filled.sort(), `inning ${inning} positions`).toEqual([...fieldingPositions].sort());
  }
}

describe('10-fielder configuration', () => {
  it('getFieldingPositions returns 9 or 10 positions', () => {
    expect(getFieldingPositions(9)).toHaveLength(9);
    expect(getFieldingPositions(10)).toHaveLength(10);
    expect(getFieldingPositions(10)).toContain('SC');
    expect(getFieldingPositions(undefined)).toHaveLength(9);
  });

  it('solves a 10-fielder game, filling SC every inning', () => {
    const players = makeRoster(12);
    const result = Solver.solve({
      players,
      innings: 6,
      fieldingPositions: POSITIONS_10,
      maxSitsPerGame: 2
    });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, players, 6, POSITIONS_10);
  });

  it('requires 10 players for a 10-fielder game', () => {
    const result = Solver.solve({
      players: makeRoster(9),
      innings: 6,
      fieldingPositions: POSITIONS_10
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 10/);
  });

  it('players without an SC rating (legacy rosters) can still be placed there', () => {
    const players = makeRoster(10).map(p => {
      const { SC, ...rest } = p.positions;
      return { ...p, positions: rest };
    });
    const result = Solver.solve({ players, innings: 6, fieldingPositions: POSITIONS_10 });
    expect(result.success).toBe(true);
    assertValidInnings(result.solution!, players, 6, POSITIONS_10);
  });
});

describe('softball rule relaxations', () => {
  it('allows P<->C in consecutive innings when the rule is off', () => {
    // Only two catch-capable players; one must catch whenever the other pitches.
    // Force pitcher assignments that would violate the baseball rule.
    const players = makeRoster(9);
    const result = Solver.solve({
      players,
      innings: 4,
      enforcePitcherCatcherRule: false,
      pitcherAssignments: { 1: '1', 2: '2' },
      lockedCells: { '1-2': 'C' } // player 1 pitches inning 1, catches inning 2
    });
    expect(result.success).toBe(true);
    expect(result.solution!['1-1']).toBe('P');
    expect(result.solution!['1-2']).toBe('C');
  });

  it('allows split pitching stints when contiguity is off', () => {
    const players = makeRoster(9);
    const result = Solver.solve({
      players,
      innings: 5,
      requireContiguousPitching: false,
      pitcherAssignments: { 1: '1', 3: '2', 5: '1' } // player 1 pitches innings 1 and 5
    });
    expect(result.success).toBe(true);
    expect(result.solution!['1-1']).toBe('P');
    expect(result.solution!['1-5']).toBe('P');
    assertValidInnings(result.solution!, players, 5);
  });
});

describe('pitcher innings cap', () => {
  it('never schedules a pitcher past maxPitcherInningsPerGame', () => {
    // Only one player can pitch, 6 innings, cap of 3: innings 4-6 have no
    // eligible pitcher, so the solve fails rather than exceeding the cap.
    const players = makeRoster(9).map(p =>
      p.id === '1' ? p : { ...p, canPitch: false }
    );
    const result = Solver.solve({
      players,
      innings: 6,
      maxPitcherInningsPerGame: 3
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot fill P/);

    // With two eligible pitchers the cap forces a handoff. The pitchers
    // don't catch, so the P<->C safety rule can't block the inning-4 takeover.
    const players2 = makeRoster(9).map(p =>
      p.id === '1' || p.id === '2'
        ? { ...p, canCatch: false }
        : { ...p, canPitch: false }
    );
    const result2 = Solver.solve({
      players: players2,
      innings: 6,
      maxPitcherInningsPerGame: 3
    });
    expect(result2.success).toBe(true);
    expect(Solver.getPitchingInningCount('1', result2.solution!)).toBeLessThanOrEqual(3);
    expect(Solver.getPitchingInningCount('2', result2.solution!)).toBeLessThanOrEqual(3);
  });
});

describe('fairness: max consecutive sits', () => {
  it('no player sits back-to-back when maxConsecutiveSits is 1', () => {
    const players = makeRoster(12);
    const result = Solver.solve({
      players,
      innings: 6,
      maxSitsPerGame: 2,
      maxConsecutiveSits: 1
    });
    expect(result.success).toBe(true);
    for (const p of players) {
      for (let inning = 1; inning < 6; inning++) {
        const consecutive =
          result.solution![`${p.id}-${inning}`] === 'SIT' &&
          result.solution![`${p.id}-${inning + 1}`] === 'SIT';
        expect(consecutive, `${p.id} sits innings ${inning} and ${inning + 1}`).toBe(false);
      }
    }
    expect(result.warnings ?? []).toEqual([]);
  });

  it('warns when consecutive sits are unavoidable', () => {
    // 18 players, 9 field: 9 sit every inning; over 2 innings someone must
    // sit twice in a row is avoidable, but with maxSits 4 and 4 innings,
    // 36 sit-slots over 18 players = 2 each; consecutive avoidable. Force it
    // with locks instead: lock player 18 to SIT in innings 1 and 2.
    const players = makeRoster(12);
    const result = Solver.solve({
      players,
      innings: 6,
      maxSitsPerGame: 3,
      maxConsecutiveSits: 1,
      lockedCells: { '12-1': 'SIT', '12-2': 'SIT' }
    });
    expect(result.success).toBe(true);
    expect((result.warnings ?? []).some(w => w.includes('in a row'))).toBe(true);
  });
});

describe('fairness: everyone plays infield', () => {
  it('gives every player at least one non-outfield inning', () => {
    const players = makeRoster(12);
    const result = Solver.solve({
      players,
      innings: 6,
      maxSitsPerGame: 2,
      everyoneInfield: true
    });
    expect(result.success).toBe(true);
    for (const p of players) {
      expect(
        Solver.hasInfieldInning(p.id, result.solution!),
        `${p.name} never plays infield`
      ).toBe(true);
    }
    expect(result.warnings ?? []).toEqual([]);
  });

  it('warns when a full infield rotation is impossible', () => {
    // 1 inning, 12 players, only 6 infield slots: at least 6 players miss out
    const players = makeRoster(12);
    const result = Solver.solve({
      players,
      innings: 1,
      maxSitsPerGame: 3,
      everyoneInfield: true
    });
    expect(result.success).toBe(true);
    expect((result.warnings ?? []).filter(w => w.includes('infield')).length).toBeGreaterThanOrEqual(1);
  });

  it('still respects position eligibility (catch/pitch restrictions)', () => {
    const players = makeRoster(12).map((p, i) =>
      i >= 2 ? { ...p, canPitch: false, canCatch: false } : p
    );
    const result = Solver.solve({
      players,
      innings: 6,
      maxSitsPerGame: 2,
      everyoneInfield: true
    });
    expect(result.success).toBe(true);
    for (let inning = 1; inning <= 6; inning++) {
      for (const p of players) {
        const pos = result.solution![`${p.id}-${inning}`];
        if (pos === 'P') expect(p.canPitch).toBe(true);
        if (pos === 'C') expect(p.canCatch).toBe(true);
      }
    }
  });
});

describe('pitch rule presets', () => {
  it('has presets for both sports plus custom lookup', () => {
    expect(getPresetsForSport('baseball').length).toBeGreaterThanOrEqual(3);
    expect(getPresetsForSport('softball').length).toBeGreaterThanOrEqual(2);
    expect(getPreset(CUSTOM_PRESET_ID)).toBeUndefined();
  });

  it('every preset has coherent rules for its limit type', () => {
    for (const preset of PITCH_RULE_PRESETS) {
      if (preset.rules.limitType === 'pitches') {
        expect(preset.rules.breakpoints.length).toBeGreaterThan(0);
        expect(preset.rules.absoluteMax).toBeGreaterThan(0);
        // Breakpoints ascend
        const maxes = preset.rules.breakpoints.map(bp => bp.maxPitches);
        expect([...maxes].sort((a, b) => a - b)).toEqual(maxes);
      }
      if (preset.rules.limitType === 'innings') {
        expect(preset.rules.inningsBreakpoints.length).toBeGreaterThan(0);
      }
    }
  });

  it('pitch smart age bands escalate the daily max', () => {
    const max = (id: string) => getPreset(id)!.rules.absoluteMax;
    expect(max('pitch-smart-7-8')).toBeLessThan(max('pitch-smart-9-10'));
    expect(max('pitch-smart-9-10')).toBeLessThan(max('pitch-smart-11-12'));
    expect(max('pitch-smart-11-12')).toBeLessThan(max('pitch-smart-13-14'));
  });
});
