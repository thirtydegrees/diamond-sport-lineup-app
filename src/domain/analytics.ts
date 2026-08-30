/* ============================================
   Diamond Lineup - Season Analytics

   Pure computations over COMPLETED games' recorded-out ledgers.
   Planned lineups, drafts, and live games contribute nothing:
   if it isn't a recorded out in a completed game, it never
   happened as far as stats are concerned (H8).

   Units are defensive OUTS (the actual grain of participation);
   use formatOutsAsInnings for inning-equivalent display.
   Players removed from the roster keep their identity through
   each game's name snapshots (M5).
   ============================================ */

import { getPositionGroup } from './constants';
import { deriveOutings } from './pitching';
import type { Assignment, Game, Player } from './types';

export type PositionGroupKey = 'P' | 'C' | 'IF' | 'OF' | 'SIT';

export interface PlayerSeasonStats {
  playerId: string;
  name: string;
  onRoster: boolean;
  gamesPlayed: number;
  /** Recorded outs with any assignment, bench included. */
  outs: number;
  byGroup: Record<PositionGroupKey, number>;
  byPosition: Partial<Record<Assignment, number>>;
  sitOuts: number;
  /** Share of recorded outs spent on the bench (0-1). */
  sitShare: number;
  /** True when any counted game has estimated (legacy) participation. */
  estimated: boolean;
}

export interface PitcherGameLoad {
  gameId: string;
  date: string;
  opponent: string;
  /** Confirmed pitches, or null when the count is unknown. */
  pitches: number | null;
  pitchingOuts: number;
  estimated: boolean;
}

export interface PitcherSeasonStats {
  playerId: string;
  name: string;
  games: number;
  /** Sum of confirmed counts (unknown outings excluded, flagged below). */
  totalPitches: number;
  totalPitchingOuts: number;
  avgPitches: number;
  /** Pitches thrown in the 7 calendar days ending at `today` (inclusive). */
  last7Pitches: number;
  /** Outings whose final count is still unknown. */
  unknownCountGames: number;
  /** Chronological, oldest first. */
  perGame: PitcherGameLoad[];
}

export interface DateRange {
  from?: string; // YYYY-MM-DD inclusive
  to?: string;   // YYYY-MM-DD inclusive
}

function inRange(date: string, range?: DateRange): boolean {
  if (!range) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function groupOf(pos: Assignment): PositionGroupKey {
  if (pos === 'SIT') return 'SIT';
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  return getPositionGroup(pos) === 'infield' ? 'IF' : 'OF';
}

/** Order segments render in the stacked chart. Fixed - never resorted. */
export const GROUP_ORDER: PositionGroupKey[] = ['P', 'C', 'IF', 'OF', 'SIT'];

export const GROUP_LABELS: Record<PositionGroupKey, string> = {
  P: 'Pitcher',
  C: 'Catcher',
  IF: 'Infield',
  OF: 'Outfield',
  SIT: 'Bench'
};

function blankStats(playerId: string, name: string, onRoster: boolean): PlayerSeasonStats {
  return {
    playerId,
    name,
    onRoster,
    gamesPlayed: 0,
    outs: 0,
    byGroup: { P: 0, C: 0, IF: 0, OF: 0, SIT: 0 },
    byPosition: {},
    sitOuts: 0,
    sitShare: 0,
    estimated: false
  };
}

/**
 * Per-player participation across completed games' out ledgers.
 * Roster players come first (zeros included, honestly); players since
 * removed from the roster follow, named from game snapshots.
 */
export function computeSeasonStats(
  games: Game[],
  roster: Player[],
  range?: DateRange
): PlayerSeasonStats[] {
  const byPlayer = new Map<string, PlayerSeasonStats>();
  roster.forEach(p => byPlayer.set(p.id, blankStats(p.id, p.name, true)));

  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (!inRange(game.date, range)) continue;
    const estimated = game.participationQuality === 'estimated';
    const playedThisGame = new Set<string>();

    for (const out of game.outs || []) {
      for (const [playerId, pos] of Object.entries(out.assignments)) {
        let stats = byPlayer.get(playerId);
        if (!stats) {
          stats = blankStats(playerId, game.playerNames?.[playerId] || '(removed)', false);
          byPlayer.set(playerId, stats);
        }
        stats.outs++;
        stats.byGroup[groupOf(pos)]++;
        stats.byPosition[pos] = (stats.byPosition[pos] || 0) + 1;
        if (pos === 'SIT') stats.sitOuts++;
        if (estimated) stats.estimated = true;
        playedThisGame.add(playerId);
      }
    }

    playedThisGame.forEach(id => {
      const stats = byPlayer.get(id);
      if (stats) stats.gamesPlayed++;
    });
  }

  for (const stats of byPlayer.values()) {
    stats.sitShare = stats.outs > 0 ? stats.sitOuts / stats.outs : 0;
  }

  const rosterRows = roster.map(p => byPlayer.get(p.id)!);
  const removedRows = [...byPlayer.values()]
    .filter(s => !s.onRoster)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...rosterRows, ...removedRows];
}

/**
 * Per-pitcher workload derived from completed games. Sorted by total
 * confirmed pitches, heaviest first; unknown-count outings are counted
 * as games and flagged, never silently zeroed.
 */
export function computePitchingStats(
  games: Game[],
  roster: Player[],
  today: string,
  range?: DateRange
): PitcherSeasonStats[] {
  const opponentByGame = new Map<string, string>();
  const nameByPlayer = new Map<string, string>();
  games.forEach(g => {
    opponentByGame.set(g.id, g.opponent || '');
    Object.entries(g.playerNames || {}).forEach(([id, name]) => nameByPlayer.set(id, name));
  });
  roster.forEach(p => nameByPlayer.set(p.id, p.name));

  const byPlayer = new Map<string, PitcherSeasonStats>();

  for (const outing of deriveOutings(games)) {
    if (!inRange(outing.date, range)) continue;

    let stats = byPlayer.get(outing.playerId);
    if (!stats) {
      stats = {
        playerId: outing.playerId,
        name: nameByPlayer.get(outing.playerId) || '(removed)',
        games: 0,
        totalPitches: 0,
        totalPitchingOuts: 0,
        avgPitches: 0,
        last7Pitches: 0,
        unknownCountGames: 0,
        perGame: []
      };
      byPlayer.set(outing.playerId, stats);
    }

    stats.games++;
    stats.totalPitchingOuts += outing.pitchingOuts;
    if (outing.pitches === null) stats.unknownCountGames++;
    else stats.totalPitches += outing.pitches;
    stats.perGame.push({
      gameId: outing.gameId,
      date: outing.date,
      opponent: opponentByGame.get(outing.gameId) || '',
      pitches: outing.pitches,
      pitchingOuts: outing.pitchingOuts,
      estimated: outing.estimated
    });
  }

  // last-7-days window: [today - 6, today], compared as date strings
  const sevenDaysAgo = shiftISO(today, -6);

  for (const stats of byPlayer.values()) {
    stats.perGame.sort((a, b) => a.date.localeCompare(b.date));
    const confirmedGames = stats.games - stats.unknownCountGames;
    stats.avgPitches = confirmedGames > 0 ? Math.round(stats.totalPitches / confirmedGames) : 0;
    stats.last7Pitches = stats.perGame
      .filter(g => g.date >= sevenDaysAgo && g.date <= today)
      .reduce((sum, g) => sum + (g.pitches || 0), 0);
  }

  return [...byPlayer.values()].sort((a, b) => b.totalPitches - a.totalPitches);
}

/** Shift a YYYY-MM-DD string by whole days (local calendar). */
export function shiftISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
