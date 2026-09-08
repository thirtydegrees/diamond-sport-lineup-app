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
  maxGamesPerDay?: number;
  maxConsecutiveDays?: number;
  maxMoundReturns?: number;
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
  onboardingComplete?: boolean;
  teamType?: string;
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

/**
 * Game lifecycle. The plan (lineup grid) never becomes history by itself:
 * - draft:     setup + planning; produces no stats or workload
 * - live:      out tracking is running; actual participation accrues in `outs`
 * - completed: finalized; the ONLY status that feeds stats, workload, and rest
 */
export type GameStatus = 'draft' | 'live' | 'completed';

/**
 * One recorded defensive out: a snapshot of who was standing where when the
 * out happened. Actual participation is derived exclusively from these.
 */
export interface DefensiveOut {
  seq: number; // 1..N across the whole game
  inning: number; // 1-based
  outInInning: 1 | 2 | 3;
  /** playerId -> position or SIT for every player active at that moment. */
  assignments: Record<string, Assignment>;
  /** True when expanded from a legacy inning-level game (not tap-recorded). */
  estimated?: boolean;
}

/**
 * Per-player pitch count state for one game.
 * - live: the working in-game count (coach may miss pitches)
 * - confirmed: the authoritative total, set when the coach confirms at game
 *   completion (or corrects later from history)
 * - unknown: player pitched but no trustworthy total exists; NEVER treated
 *   as zero - eligibility becomes conservative until corrected
 */
export interface PitchCountEntry {
  /** Unallocated correction: live = sum(byInning) + adjustment. */
  adjustment?: number;
  live: number;
  byInning: Record<number, number>;
  confirmed: number | null;
  status: 'live' | 'confirmed' | 'unknown';
}

export interface LiveGameState {
  /** Current defensive inning (1-based). */
  inning: number;
  /** Outs already recorded in the current inning (0-2). */
  outsRecorded: number;
  /** The formation currently on the field: playerId -> position/SIT. */
  assignments: Record<string, Assignment>;
}

export interface Game {
  setupOrder?: string[];
  preparationStage?: 'setup' | 'lineup';
  lineupInitialized?: boolean;
  avoidOverrides?: {playerId: string; position: Position}[];
  sitOverrides?: string[];
  workloadSource?: string;
  rulesSnapshot?: PitchRules;
  rulesVersion?: string;
  sport?: Sport;
  /** Pitchers placed on the mound, including appearances with no recorded outs. */
  pitchingAppearances?: string[];
  pitchingStints?: string[];
  schemaVersion: 2;
  id: string;
  date: string; // YYYY-MM-DD (local calendar date, no time component)
  opponent: string;
  innings: number;
  /** Snapshot of the fielder count when the game was created. */
  fielderCount: FielderCount;
  battingOrder: string[];
  availability: Record<string, boolean>;
  /** PLAN: intended pitcher per inning. */
  pitcherAssignments: Record<number, string>;
  /** PLAN: coach-locked cells. */
  lockedCells: LineupMap;
  /** PLAN: the inning-level lineup grid. Never counted as participation. */
  lineup: LineupMap;
  score: { us: Record<number, number>; them: Record<number, number> };
  status: GameStatus;
  /** Live out-tracking state; null unless status is 'live'. */
  live: LiveGameState | null;
  /** ACTUAL: append-only ledger of recorded defensive outs. */
  outs: DefensiveOut[];
  /** ACTUAL: per-player pitch counts (independent of outs). */
  pitchCounts: Record<string, PitchCountEntry>;
  /** Name snapshots so history survives roster removals. */
  playerNames: Record<string, string>;
  exitedPlayers: Record<string, number>;
  completedAt?: string;
  /** 'estimated' for games migrated from the inning-level v1 model. */
  participationQuality?: 'exact' | 'estimated';
}

/** Legacy (v1) pitch record shape - only used during migration. */
export interface PitchRecord {
  id: string;
  playerId: string;
  gameId: string;
  date: string; // YYYY-MM-DD
  pitches: number;
  innings: Record<number, number>;
  inningsPitched?: number;
}

/**
 * A pitcher's workload in one completed game, derived from the game's out
 * ledger and confirmed pitch counts. Never stored - always recomputed.
 */
export interface PitchingOuting {
  gameId: string;
  playerId: string;
  date: string;
  /** Confirmed pitch total, or null when the count is unknown. */
  pitches: number | null;
  countStatus: 'confirmed' | 'unknown';
  pitchingOuts: number;
  /** True when the outs were estimated from a legacy inning-level game. */
  estimated: boolean;
}

export interface PitcherEligibility {
  eligible: boolean;
  reason: string;
  daysRest: number | null;
  daysNeeded?: number;
  lastPitched?: number | null;
  lastInningsPitched?: number;
  /** True when an unknown pitch count forced a conservative answer. */
  needsCount?: boolean;
}
