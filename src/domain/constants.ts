/* ============================================
   Diamond Lineup - Constants
   ============================================ */

import type { FielderCount, Game, Player, Position, PositionTier, Settings } from './types';
import { todayISO } from './dates';
import { newId } from './ids';

export const POSITIONS: Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** 10-fielder configuration adds SC (short center / rover, the 4th outfielder). */
export const POSITIONS_10: Position[] = [...POSITIONS, 'SC'];

export function getFieldingPositions(fielderCount: FielderCount | undefined): Position[] {
  return fielderCount === 10 ? POSITIONS_10 : POSITIONS;
}

export const POSITION_LABELS: Record<Position, string> = {
  P: 'Pitcher',
  C: 'Catcher',
  '1B': 'First Base',
  '2B': 'Second Base',
  '3B': 'Third Base',
  SS: 'Shortstop',
  LF: 'Left Field',
  CF: 'Center Field',
  RF: 'Right Field',
  SC: 'Short Center (4th OF)'
};

export const POSITION_GROUPS = {
  BATTERY: ['P', 'C'] as Position[],
  INFIELD: ['1B', '2B', '3B', 'SS'] as Position[],
  OUTFIELD: ['LF', 'CF', 'RF', 'SC'] as Position[]
};

export const POSITION_TIERS = {
  PREFERRED: 'preferred',
  CAN_PLAY: 'canPlay',
  AVOID: 'avoid'
} as const satisfies Record<string, PositionTier>;

export function getPositionGroup(pos: Position | 'SIT'): 'battery' | 'infield' | 'outfield' | 'sit' {
  if (POSITION_GROUPS.BATTERY.includes(pos as Position)) return 'battery';
  if (POSITION_GROUPS.INFIELD.includes(pos as Position)) return 'infield';
  if (POSITION_GROUPS.OUTFIELD.includes(pos as Position)) return 'outfield';
  return 'sit';
}

export function getPositionColorClass(pos: Position | 'SIT' | null | undefined): string {
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  if (POSITION_GROUPS.INFIELD.includes(pos as Position)) return 'IF';
  if (POSITION_GROUPS.OUTFIELD.includes(pos as Position)) return 'OF';
  return 'SIT';
}

export const DEFAULT_SETTINGS: Settings = {
  sport: 'baseball',
  fielderCount: 9,
  innings: 6,
  maxSitsPerGame: 2,
  fairness: {
    maxConsecutiveSits: null,
    everyoneInfield: false
  },
  pitchRulePreset: 'pitch-smart-11-12',
  pitchRules: {
    limitType: 'pitches',
    breakpoints: [
      { maxPitches: 20, restDays: 0 },
      { maxPitches: 35, restDays: 1 },
      { maxPitches: 50, restDays: 2 },
      { maxPitches: 65, restDays: 3 }
    ],
    absoluteMax: 85,
    absoluteMaxRest: 4,
    inningsBreakpoints: [
      { maxInnings: 2, restDays: 0 },
      { maxInnings: 4, restDays: 1 }
    ],
    maxInningsPerGame: null
  },
  darkMode: false
};

function demoPlayer(
  id: string,
  name: string,
  canPitch: boolean,
  prefersPitching: boolean,
  canCatch: boolean,
  tiers: Partial<Record<Position, PositionTier>>,
  preferredOrder: Position[]
): Player {
  const positions: Partial<Record<Position, PositionTier>> = {};
  POSITIONS_10.forEach(pos => {
    positions[pos] = tiers[pos] ?? POSITION_TIERS.CAN_PLAY;
  });
  return { id, name, canPitch, prefersPitching, canCatch, positions, preferredOrder };
}

export const DEMO_ROSTER: Player[] = [
  demoPlayer('1', 'Joe B.', true, true, true,
    { C: 'preferred', '3B': 'preferred', SS: 'preferred' }, ['C', 'SS', '3B']),
  demoPlayer('2', 'Max C.', true, true, false,
    { P: 'preferred', C: 'avoid', '1B': 'preferred', LF: 'preferred' }, ['P', '1B', 'LF']),
  demoPlayer('3', 'Liam D.', true, false, true,
    { C: 'preferred', '2B': 'preferred', CF: 'preferred' }, ['C', '2B', 'CF']),
  demoPlayer('4', 'Noah F.', false, false, false,
    { P: 'avoid', C: 'avoid', '1B': 'preferred', LF: 'preferred', RF: 'preferred' }, ['RF', 'LF', '1B']),
  demoPlayer('5', 'Owen G.', true, true, false,
    { C: 'avoid', '3B': 'preferred', SS: 'preferred', CF: 'preferred' }, ['SS', '3B', 'CF']),
  demoPlayer('6', 'Jack H.', true, true, false,
    { P: 'preferred', C: 'avoid', '2B': 'preferred', SS: 'preferred' }, ['P', 'SS', '2B']),
  demoPlayer('7', 'Aiden J.', false, false, false,
    { P: 'avoid', C: 'avoid', '1B': 'preferred', LF: 'preferred', RF: 'preferred' }, ['LF', 'RF', '1B']),
  demoPlayer('8', 'Ben K.', true, false, true,
    { C: 'preferred', '1B': 'preferred', RF: 'preferred' }, ['C', '1B', 'RF']),
  demoPlayer('9', 'Caleb L.', false, false, false,
    { P: 'avoid', C: 'avoid', '2B': 'preferred', LF: 'preferred', CF: 'preferred' }, ['CF', 'LF', '2B']),
  demoPlayer('10', 'Ethan M.', true, true, false,
    { P: 'preferred', C: 'avoid', '3B': 'preferred', SS: 'preferred' }, ['3B', 'SS', 'P']),
  demoPlayer('11', 'Ryan P.', false, false, false,
    { P: 'avoid', C: 'avoid', '2B': 'preferred', CF: 'preferred', RF: 'preferred' }, ['2B', 'RF', 'CF']),
  demoPlayer('12', 'Sam R.', true, false, false,
    { C: 'avoid', '1B': 'preferred', '3B': 'preferred', LF: 'preferred' }, ['1B', 'LF', '3B'])
];

export function createBlankPlayer(): Player {
  const positions: Partial<Record<Position, PositionTier>> = {};
  POSITIONS_10.forEach(pos => {
    positions[pos] = POSITION_TIERS.CAN_PLAY;
  });

  return {
    id: newId(),
    name: '',
    canPitch: false,
    prefersPitching: false,
    canCatch: false,
    positions,
    preferredOrder: []
  };
}

export function createBlankGame(settings?: Settings): Game {
  return {
    id: newId(),
    date: todayISO(),
    opponent: '',
    innings: settings?.innings || DEFAULT_SETTINGS.innings,
    fielderCount: settings?.fielderCount || DEFAULT_SETTINGS.fielderCount,
    battingOrder: [],
    availability: {},
    pitcherAssignments: {},
    lockedCells: {},
    lineup: {},
    score: { us: {}, them: {} },
    pitchLog: {},
    currentInning: 1,
    exitedPlayers: {}
  };
}
