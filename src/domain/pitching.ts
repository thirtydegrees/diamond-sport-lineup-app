/* ============================================
   Diamond Lineup - Pitching policy

   The single authority for pitching workload and eligibility.

   Sources of truth:
   - Prior workload comes ONLY from completed games (their out
     ledgers + confirmed pitch counts). Draft/live plans never
     count (H8), and the game being played never restricts its
     own pitcher through "rest" rules (H7).
   - An unknown pitch count is never zero: it produces the most
     conservative rest requirement and a "count needed" flag.

   Every UI path that assigns or continues a pitcher asks this
   module (H6): the solver's pregame list, the pitcher picker,
   manual position changes, live mid-inning changes, and the
   pitch counter's over-max warning.
   ============================================ */

import { compareDatesDesc, daysBetween } from './dates';
import { participationByPlayer, pitchingOutsByPlayer, getPitchCountEntry, formatOutsAsInnings, OUTS_PER_INNING } from './games';
import type { Assignment, Game, PitchRules, PitcherEligibility, PitchingOuting, Player } from './types';

/** Derive pitching outings from completed games. Never stored (H8). */
export function deriveOutings(games: Game[]): PitchingOuting[] {
  const outings: PitchingOuting[] = [];
  for (const game of games) {
    if (game.status !== 'completed') continue;
    const outsByPlayer = pitchingOutsByPlayer(game);
    const playerIds = new Set([
      ...Object.keys(outsByPlayer),
      // A confirmed count with no recorded P outs still counts as an outing
      ...Object.entries(game.pitchCounts || {})
        .filter(([, e]) => (e.status === 'confirmed' && (e.confirmed || 0) > 0) || e.status === 'unknown')
        .map(([pid]) => pid)
    ]);
    for (const pid of playerIds) {
      const entry = game.pitchCounts?.[pid];
      const confirmed = entry?.status === 'confirmed';
      outings.push({
        gameId: game.id,
        playerId: pid,
        date: game.date,
        pitches: confirmed ? (entry!.confirmed ?? 0) : null,
        countStatus: confirmed ? 'confirmed' : 'unknown',
        pitchingOuts: outsByPlayer[pid] || 0,
        estimated: game.participationQuality === 'estimated'
      });
    }
  }
  return outings;
}

/**
 * Sanitize coach-entered custom rules: numbers coerced to non-negative,
 * breakpoints sorted ascending so eligibility's first-match scan is valid.
 */
export function normalizePitchRules(rules: PitchRules): PitchRules {
  const num = (v: unknown, fallback = 0) => {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    limitType: rules.limitType === 'innings' || rules.limitType === 'none' ? rules.limitType : 'pitches',
    breakpoints: (rules.breakpoints || [])
      .map(bp => ({ maxPitches: num(bp.maxPitches), restDays: num(bp.restDays) }))
      .sort((a, b) => a.maxPitches - b.maxPitches),
    absoluteMax: num(rules.absoluteMax),
    absoluteMaxRest: num(rules.absoluteMaxRest),
    inningsBreakpoints: (rules.inningsBreakpoints || [])
      .map(bp => ({ maxInnings: num(bp.maxInnings), restDays: num(bp.restDays) }))
      .sort((a, b) => a.maxInnings - b.maxInnings),
    maxInningsPerGame:
      rules.maxInningsPerGame == null ? null : Math.max(0, num(rules.maxInningsPerGame)) || null
  };
}

/** Rest days required after throwing `pitches` in one day. */
export function restDaysForPitches(pitches: number, rules: PitchRules): number {
  for (const bp of rules.breakpoints) {
    if (pitches <= bp.maxPitches) return bp.restDays;
  }
  return rules.absoluteMaxRest;
}

/** Rest days required after `outs` pitching outs in one day. */
export function restDaysForOuts(outs: number, rules: PitchRules): number {
  const innings = outs / OUTS_PER_INNING;
  for (const bp of rules.inningsBreakpoints) {
    if (innings <= bp.maxInnings) return bp.restDays;
  }
  const last = rules.inningsBreakpoints[rules.inningsBreakpoints.length - 1];
  return last ? last.restDays : 0;
}

/**
 * Pregame rest eligibility for a pitcher on `gameDate`.
 *
 * Evaluates EVERY prior day's aggregated workload (not just the latest row):
 * each day with outings imposes rest through `restDays` after it, and the
 * pitcher must be clear of all of them. Outings from `excludeGameId` (the
 * game being played) are ignored so a game never blocks its own pitcher.
 * Unknown pitch counts use the most conservative tier and set `needsCount`.
 */
export function assessPitcherRest(
  playerId: string,
  gameDate: string,
  games: Game[],
  rawRules: PitchRules,
  excludeGameId?: string
): PitcherEligibility {
  const rules = normalizePitchRules(rawRules);
  if (rules.limitType === 'none') {
    return { eligible: true, reason: 'Eligible', daysRest: null };
  }

  // Same-day outings count too: a doubleheader's first game can require
  // rest that rules out pitching in the second one.
  const outings = deriveOutings(games).filter(
    o => o.playerId === playerId && o.gameId !== excludeGameId && o.date <= gameDate
  );
  if (outings.length === 0) {
    return { eligible: true, reason: 'Eligible', daysRest: null };
  }

  // Aggregate same-day outings (doubleheaders) before applying rest tiers
  const byDate = new Map<string, { pitches: number; outs: number; unknown: boolean }>();
  for (const o of outings) {
    const day = byDate.get(o.date) || { pitches: 0, outs: 0, unknown: false };
    day.outs += o.pitchingOuts;
    if (o.pitches === null) day.unknown = true;
    else day.pitches += o.pitches;
    byDate.set(o.date, day);
  }

  let worst: { date: string; daysNeeded: number; unknown: boolean; pitches: number; outs: number } | null = null;
  for (const [date, day] of byDate) {
    let required: number;
    let unknownUsed = false;
    if (rules.limitType === 'innings') {
      required = restDaysForOuts(day.outs, rules);
    } else if (day.unknown) {
      // Unknown count -> most conservative tier until corrected
      required = Math.max(rules.absoluteMaxRest, ...rules.breakpoints.map(bp => bp.restDays));
      unknownUsed = true;
    } else {
      required = restDaysForPitches(day.pitches, rules);
    }
    const rested = daysBetween(date, gameDate);
    const daysNeeded = required - rested;
    if (daysNeeded > 0 && (!worst || daysNeeded > worst.daysNeeded)) {
      worst = { date, daysNeeded, unknown: unknownUsed, pitches: day.pitches, outs: day.outs };
    }
  }

  const lastDate = [...byDate.keys()].sort(compareDatesDesc)[0];
  const last = byDate.get(lastDate)!;
  const daysRest = daysBetween(lastDate, gameDate);
  const lastInnings = Math.floor(last.outs / OUTS_PER_INNING);

  if (!worst) {
    return {
      eligible: true,
      reason: 'Eligible',
      daysRest,
      lastPitched: last.unknown ? null : last.pitches,
      lastInningsPitched: lastInnings
    };
  }
  return {
    eligible: false,
    reason: worst.unknown ? `Count needed (${worst.daysNeeded}d rest assumed)` : `${worst.daysNeeded}d rest`,
    daysRest,
    daysNeeded: worst.daysNeeded,
    lastPitched: last.unknown ? null : last.pitches,
    lastInningsPitched: lastInnings,
    needsCount: worst.unknown
  };
}

export interface AssignmentWarning {
  severity: 'block' | 'warn';
  message: string;
  /** Compact label for list rows, e.g. "2d rest", "At daily max". */
  short: string;
}

export interface AssignmentDecision {
  /** False only when the player physically can't take the spot (can't pitch). */
  allowed: boolean;
  /** Non-empty warnings require an explicit coach override to proceed. */
  warnings: AssignmentWarning[];
}

/**
 * Full decision for putting `player` on the mound in the CURRENT game
 * (live change, pitcher picker, or manual plan assignment).
 *
 * Real events must stay recordable, so nothing here hard-refuses a
 * violation - it warns and the UI requires an explicit override (H6).
 */
export function assessPitcherAssignment(
  player: Player,
  game: Game,
  games: Game[],
  rawRules: PitchRules
): AssignmentDecision {
  if (!player.canPitch) {
    return {
      allowed: false,
      warnings: [{ severity: 'block', message: `${player.name} is not marked as able to pitch`, short: 'Cannot pitch' }]
    };
  }
  const rules = normalizePitchRules(rawRules);
  const warnings: AssignmentWarning[] = [];

  // 1. Pregame rest from prior completed games (this game excluded)
  const rest = assessPitcherRest(player.id, game.date, games, rules, game.id);
  if (!rest.eligible) {
    warnings.push({
      severity: 'warn',
      message: rest.needsCount
        ? `${player.name} has a prior outing with no confirmed pitch count - fix it in History (treated as needing ${rest.daysNeeded} more rest day${rest.daysNeeded === 1 ? '' : 's'})`
        : `${player.name} needs ${rest.daysNeeded} more rest day${rest.daysNeeded === 1 ? '' : 's'} (last outing ${rest.daysRest}d ago)`,
      short: rest.needsCount ? 'Count needed' : `${rest.daysNeeded}d rest`
    });
  }

  // 2. Daily pitch total vs the configured absolute max
  if (rules.limitType === 'pitches' && rules.absoluteMax > 0) {
    const today = dailyPitchTotal(player.id, game, games);
    if (today.total >= rules.absoluteMax) {
      warnings.push({
        severity: 'warn',
        message: `${player.name} is at ${today.total} pitches today (max ${rules.absoluteMax})`,
        short: 'At daily max'
      });
    }
  }

  // 3. Per-game pitching cap, in outs
  if (rules.maxInningsPerGame != null) {
    const capOuts = rules.maxInningsPerGame * OUTS_PER_INNING;
    const outs = pitchingOutsByPlayer(game)[player.id] || 0;
    if (outs >= capOuts) {
      warnings.push({
        severity: 'warn',
        message: `${player.name} has pitched ${formatOutsAsInnings(outs)} innings this game (cap ${rules.maxInningsPerGame})`,
        short: 'At game cap'
      });
    }
  }

  return { allowed: true, warnings };
}

/**
 * P/C safety-rule warnings for putting `player` at `position`, based on what
 * ACTUALLY happened in this game (recorded outs + the live formation), not
 * just the plan's inning adjacency. Baseball only (softball passes `false`).
 *
 * Simplified conservatively from Pitch Smart: a player who has pitched in
 * this game should not move behind the plate, and a player who has caught
 * should not take the mound.
 */
export function pcTransitionWarnings(
  player: Player,
  position: Assignment,
  game: Game,
  enforce: boolean
): AssignmentWarning[] {
  if (!enforce || (position !== 'P' && position !== 'C')) return [];
  const parts = participationByPlayer(game)[player.id] || {};
  const liveNow = game.live?.assignments?.[player.id];
  const pitched = (parts.P || 0) > 0 || liveNow === 'P';
  const caught = (parts.C || 0) > 0 || liveNow === 'C';
  if (position === 'C' && pitched) {
    return [{
      severity: 'warn',
      message: `${player.name} has pitched in this game - moving to catcher violates the pitcher/catcher safety rule`,
      short: 'Pitched this game'
    }];
  }
  if (position === 'P' && caught) {
    return [{
      severity: 'warn',
      message: `${player.name} has caught in this game - taking the mound violates the pitcher/catcher safety rule`,
      short: 'Caught this game'
    }];
  }
  return [];
}

export interface PositionChangeContext {
  /** Baseball P/C safety rule applies (false for softball). */
  enforcePitcherCatcherRule: boolean;
  /** True for live-formation changes: reality stays recordable, so even a
      capability problem is a warning, never a hard block. */
  live: boolean;
}

/**
 * THE single gate for putting `player` at `position` in this game - used by
 * the pitcher picker, plan swaps (mover AND displaced player), bench entry,
 * and live formation chips. Returns every applicable warning; an empty list
 * means no override is needed.
 */
export function assessPositionChange(
  player: Player,
  position: Assignment,
  game: Game,
  games: Game[],
  rules: PitchRules,
  ctx: PositionChangeContext
): AssignmentWarning[] {
  if (position === 'SIT') return [];
  const warnings: AssignmentWarning[] = [];

  if (position === 'P') {
    const decision = assessPitcherAssignment(player, game, games, rules);
    for (const w of decision.warnings) {
      warnings.push(ctx.live ? { ...w, severity: 'warn' } : w);
    }
  } else if (position === 'C' && !player.canCatch) {
    warnings.push({
      severity: ctx.live ? 'warn' : 'block',
      message: `${player.name} is not marked as able to catch`,
      short: 'Not a catcher'
    });
  }

  if (position !== 'P' && position !== 'C' && player.positions?.[position] === 'avoid') {
    warnings.push({
      severity: 'warn',
      message: `${player.name} has ${position} marked as Avoid`,
      short: 'Avoided position'
    });
  }

  warnings.push(...pcTransitionWarnings(player, position, game, ctx.enforcePitcherCatcherRule));
  return warnings;
}

/**
 * Continuation checkpoint: warnings that recording `outsToRecord` more outs
 * with the CURRENT pitcher would cross (or has crossed) a workload boundary.
 * The out is always recordable - the app warns once at the boundary so the
 * coach makes the pitching change knowingly, not accidentally.
 */
export function capCrossingWarnings(
  game: Game,
  games: Game[],
  rawRules: PitchRules,
  outsToRecord: number
): AssignmentWarning[] {
  const rules = normalizePitchRules(rawRules);
  const pitcherId = game.live
    ? Object.keys(game.live.assignments).find(id => game.live!.assignments[id] === 'P')
    : undefined;
  if (!pitcherId) return [];
  const warnings: AssignmentWarning[] = [];

  if (rules.maxInningsPerGame != null) {
    const capOuts = rules.maxInningsPerGame * OUTS_PER_INNING;
    const current = pitchingOutsByPlayer(game)[pitcherId] || 0;
    // Reaching the cap exactly is legal; going past it (from at or below)
    // is what needs the coach's explicit go-ahead
    if (current + outsToRecord > capOuts) {
      warnings.push({
        severity: 'warn',
        message: `This out puts the current pitcher past the ${rules.maxInningsPerGame}-inning game cap (${formatOutsAsInnings(current)} pitched so far)`,
        short: 'Crosses game cap'
      });
    }
  }

  if (rules.limitType === 'pitches' && rules.absoluteMax > 0) {
    const today = dailyPitchTotal(pitcherId, game, games);
    if (today.total >= rules.absoluteMax) {
      warnings.push({
        severity: 'warn',
        message: `The current pitcher is at ${today.total} pitches today (max ${rules.absoluteMax}) - consider a pitching change`,
        short: 'Over daily max'
      });
    }
  }

  return warnings;
}

/**
 * Pitches this player has thrown today: this game's working/confirmed count
 * plus any other completed game on the same date (doubleheaders).
 */
export function dailyPitchTotal(
  playerId: string,
  game: Game,
  games: Game[]
): { total: number; unknown: boolean } {
  const entry = getPitchCountEntry(game, playerId);
  let total = entry.status === 'confirmed' ? entry.confirmed ?? 0 : entry.live;
  let unknown = false;
  for (const o of deriveOutings(games)) {
    if (o.playerId !== playerId || o.date !== game.date || o.gameId === game.id) continue;
    if (o.pitches === null) unknown = true;
    else total += o.pitches;
  }
  return { total, unknown };
}
