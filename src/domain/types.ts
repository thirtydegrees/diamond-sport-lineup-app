/* Core domain types shared across the app. */

export type Position = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';

/** A position assignment in the lineup grid: a fielding position or the bench. */
export type Assignment = Position | 'SIT';

export type PositionTier = 'preferred' | 'canPlay' | 'avoid';

export interface Player {
  id: string;
  name: string;
  canPitch: boolean;
  prefersPitching: boolean;
  canCatch: boolean;
  positions: Partial<Record<Position, PositionTier>>;
  preferredOrder: Position[];
}

export interface PitchRuleBreakpoint {
  maxPitches: number;
  restDays: number;
}

export interface PitchRules {
  breakpoints: PitchRuleBreakpoint[];
  absoluteMax: number;
  absoluteMaxRest: number;
}

export interface Settings {
  innings: number;
  maxSitsPerGame: number;
  pitchRules: PitchRules;
  darkMode: boolean;
}

/** Keys are `${playerId}-${inning}`. */
export type LineupMap = Record<string, Assignment>;

export interface Game {
  id: string;
  date: string; // YYYY-MM-DD (local calendar date, no time component)
  opponent: string;
  innings: number;
  battingOrder: string[];
  availability: Record<string, boolean>;
  pitcherAssignments: Record<number, string>;
  lockedCells: LineupMap;
  lineup: LineupMap;
  score: { us: Record<number, number>; them: Record<number, number> };
  pitchLog: Record<string, Record<number, number>>;
  currentInning: number;
  exitedPlayers: Record<string, number>;
}

export interface PitchRecord {
  id: string;
  playerId: string;
  gameId: string;
  date: string; // YYYY-MM-DD
  pitches: number;
  innings: Record<number, number>;
}

export interface PitcherEligibility {
  eligible: boolean;
  reason: string;
  daysRest: number | null;
  daysNeeded?: number;
  lastPitched?: number;
}
