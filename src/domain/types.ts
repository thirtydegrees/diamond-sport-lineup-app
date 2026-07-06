/* Core domain types shared across the app. */

/**
 * Fielding positions. 'SC' (short center, a.k.a. rover / 4th outfielder)
 * only exists in 10-fielder configurations, common in youth softball and
 * some 8-10U baseball divisions.
 */
export type Position = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'SC';

/** A position assignment in the lineup grid: a fielding position or the bench. */
export type Assignment = Position | 'SIT';

export type PositionTier = 'preferred' | 'canPlay' | 'avoid';

export type Sport = 'baseball' | 'softball';

export type FielderCount = 9 | 10;

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

export interface InningsRuleBreakpoint {
  maxInnings: number;
  restDays: number;
}

/**
 * Pitching workload rules. `limitType` selects which scheme applies:
 * - 'pitches': pitch-count breakpoints -> rest days (baseball style)
 * - 'innings': innings-pitched breakpoints -> rest days (softball style)
 * - 'none': no workload restrictions (common in rec softball)
 */
export interface PitchRules {
  limitType: 'pitches' | 'innings' | 'none';
  breakpoints: PitchRuleBreakpoint[];
  absoluteMax: number;
  absoluteMaxRest: number;
  inningsBreakpoints: InningsRuleBreakpoint[];
  /** Cap on innings a pitcher may throw in one game (null = no cap). */
  maxInningsPerGame: number | null;
}

/** Toggleable lineup fairness rules, enforced by the solver. */
export interface FairnessSettings {
  /** Max innings a player may sit back-to-back (null = off). */
  maxConsecutiveSits: number | null;
  /** Every player must play a non-outfield position at least once per game. */
  everyoneInfield: boolean;
}

export interface Settings {
  sport: Sport;
  fielderCount: FielderCount;
  innings: number;
  maxSitsPerGame: number;
  fairness: FairnessSettings;
  /** Id of the league preset the pitch rules came from ('custom' if edited). */
  pitchRulePreset: string;
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
  /** Snapshot of the fielder count when the game was created. */
  fielderCount: FielderCount;
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
  /** Pitch counts per inning (from the pitch counter, if used). */
  innings: Record<number, number>;
  /** Innings pitched in the game (derived from the lineup on save). */
  inningsPitched?: number;
}

export interface PitcherEligibility {
  eligible: boolean;
  reason: string;
  daysRest: number | null;
  daysNeeded?: number;
  lastPitched?: number;
  lastInningsPitched?: number;
}
